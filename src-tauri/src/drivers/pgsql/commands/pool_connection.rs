//! Pool construction and the PostgreSQL side of connecting.

use std::sync::Arc;

use deadpool_postgres::{Manager as PgManager, ManagerConfig, Pool, RecyclingMethod};

use crate::common::enums::AppError;
use crate::drivers::connection::ConnectionParams;
use crate::drivers::pgsql::driver::PgsqlDriver;

use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use tokio_postgres::{Config, NoTls};

pub(crate) fn is_sqlite_lock_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("database is locked") || lower.contains("database busy")
}

pub(crate) fn full_error_chain(e: &dyn std::error::Error) -> String {
    let mut msg = e.to_string();
    let mut src = e.source();
    while let Some(cause) = src {
        msg.push_str(": ");
        msg.push_str(&cause.to_string());
        src = cause.source();
    }
    msg
}

pub(crate) fn create_pg_pool(
    cfg: &Config,
    use_ssl: bool,
    max_size: usize,
) -> Result<Pool, AppError> {
    let manager_config = ManagerConfig {
        recycling_method: RecyclingMethod::Custom("ROLLBACK".into()),
    };

    if use_ssl {
        let tls_connector = TlsConnector::builder()
            .build()
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;
        let tls = MakeTlsConnector::new(tls_connector);
        let manager = PgManager::from_config(cfg.clone(), tls, manager_config);
        Pool::builder(manager)
            .max_size(max_size)
            .build()
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))
    } else {
        let manager = PgManager::from_config(cfg.clone(), NoTls, manager_config);
        Pool::builder(manager)
            .max_size(max_size)
            .build()
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))
    }
}

pub(crate) async fn apply_statement_timeout(client: &deadpool_postgres::Client, timeout_ms: u32) {
    if timeout_ms > 0 {
        client
            .simple_query(&format!("SET statement_timeout = {}", timeout_ms))
            .await
            .ok();
    }
}

pub(crate) async fn reset_statement_timeout(client: &deadpool_postgres::Client, timeout_ms: u32) {
    if timeout_ms > 0 {
        client.simple_query("RESET statement_timeout").await.ok();
    }
}

fn config_from(params: &ConnectionParams) -> Config {
    let mut cfg = Config::new();
    cfg.user(&params.username)
        .password(&params.password)
        .dbname(&params.database)
        .host(&params.host)
        .port(params.port.parse().unwrap_or(5432));
    cfg
}

/// Verify credentials and report the server version.
pub async fn test_connection(params: &ConnectionParams) -> Result<String, AppError> {
    let cfg = config_from(params);
    let pool = create_pg_pool(&cfg, params.use_ssl, 1)?;
    let client = pool
        .get()
        .await
        .map_err(|e| AppError::ConnectionFailed(full_error_chain(&e)))?;

    let row = client
        .query_one("SELECT version()", &[])
        .await
        .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;

    Ok(row.get(0))
}

/// Open the query and metadata pools and validate both eagerly, so a failure
/// surfaces here rather than on the first sidebar refresh.
pub async fn connect(params: &ConnectionParams) -> Result<PgsqlDriver, AppError> {
    let cfg = config_from(params);

    let query_pool = create_pg_pool(&cfg, params.use_ssl, 16).inspect_err(|e| {
        tracing::error!("Query pool creation failed: {:?}", e);
    })?;
    let meta_pool = create_pg_pool(&cfg, params.use_ssl, 8).inspect_err(|e| {
        tracing::error!("Meta pool creation failed: {:?}", e);
    })?;

    if let Err(e) = query_pool.get().await {
        tracing::error!("Query pool initial connection failed: {:?}", e);
        return Err(AppError::ConnectionFailed(full_error_chain(&e)));
    }
    if let Err(e) = meta_pool.get().await {
        tracing::error!("Meta pool initial connection failed: {:?}", e);
        return Err(AppError::ConnectionFailed(full_error_chain(&e)));
    }

    Ok(PgsqlDriver::new(
        Arc::new(query_pool),
        Arc::new(meta_pool),
        cfg,
        params.use_ssl,
    ))
}
