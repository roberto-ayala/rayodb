//! LISTEN/NOTIFY.
//!
//! LISTEN needs a connection of its own: it holds the socket open for the life
//! of the subscription, so it cannot come from the pool the UI is using. The
//! config comes from the connected driver rather than a re-read of the project
//! store, so a subscription always targets the server the session is on.

use futures_util::StreamExt;
use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use tauri::{AppHandle, Emitter, Manager};
use tokio_postgres::{AsyncMessage, NoTls};

use crate::AppState;
use crate::common::enums::{AppError, pg_error_message};

use super::driver::PgsqlDriver;

async fn listen_loop<S, T>(
    client: tokio_postgres::Client,
    mut connection: tokio_postgres::Connection<S, T>,
    channel: &str,
    event_name: &str,
    app: &AppHandle,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let listen_sql = format!("LISTEN \"{}\"", channel.replace('"', "\"\""));
    if let Err(e) = client.batch_execute(&listen_sql).await {
        tracing::error!("LISTEN command failed: {:?}", e);
        return;
    }
    tracing::info!("LISTEN started on channel: {}", channel);

    let mut stream = futures_util::stream::poll_fn(move |cx| connection.poll_message(cx));

    while let Some(msg) = stream.next().await {
        match msg {
            Ok(AsyncMessage::Notification(n)) => {
                let payload = serde_json::json!({
                    "channel": n.channel(),
                    "payload": n.payload(),
                });
                let _ = app.emit(event_name, payload);
            }
            Ok(_) => {}
            Err(e) => {
                tracing::error!("LISTEN stream error: {:?}", e);
                break;
            }
        }
    }
    tracing::info!("LISTEN ended on channel: {}", channel);
    drop(client);
}

pub async fn listen_start(
    driver: &PgsqlDriver,
    channel: &str,
    project_id: &str,
    app: &AppHandle,
) -> Result<bool, AppError> {
    let app_state = app.state::<AppState>();
    let listen_key = format!("{}:{}", project_id, channel);

    {
        let handles = app_state.notify_handles.lock().await;
        if handles.contains_key(&listen_key) {
            return Ok(true); // Already listening
        }
    }

    let cfg = driver.config().clone();
    let use_ssl = driver.use_ssl();
    let channel_owned = channel.to_string();
    let event_name = format!("pg-notify-{}", project_id);
    let app = app.clone();

    let handle = tokio::spawn(async move {
        if use_ssl {
            let tls_connector = match TlsConnector::builder().build() {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("LISTEN TLS error: {:?}", e);
                    return;
                }
            };
            let tls = MakeTlsConnector::new(tls_connector);
            match cfg.connect(tls).await {
                Ok((client, connection)) => {
                    listen_loop(client, connection, &channel_owned, &event_name, &app).await;
                }
                Err(e) => tracing::error!("LISTEN connect error: {:?}", e),
            }
        } else {
            match cfg.connect(NoTls).await {
                Ok((client, connection)) => {
                    listen_loop(client, connection, &channel_owned, &event_name, &app).await;
                }
                Err(e) => tracing::error!("LISTEN connect error: {:?}", e),
            }
        }
    });

    {
        let mut handles = app_state.notify_handles.lock().await;
        handles.insert(listen_key, handle);
    }

    Ok(true)
}

pub async fn listen_stop(
    channel: &str,
    project_id: &str,
    app: &AppHandle,
) -> Result<bool, AppError> {
    let app_state = app.state::<AppState>();
    let listen_key = format!("{}:{}", project_id, channel);

    let mut handles = app_state.notify_handles.lock().await;
    if let Some(handle) = handles.remove(&listen_key) {
        handle.abort();
    }

    Ok(true)
}

pub async fn notify_send(
    client: &deadpool_postgres::Client,
    channel: &str,
    payload: &str,
) -> Result<bool, AppError> {
    let sql = format!(
        "SELECT pg_notify('{}', '{}')",
        channel.replace('\'', "''"),
        payload.replace('\'', "''"),
    );
    client
        .batch_execute(&sql)
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;
    Ok(true)
}
