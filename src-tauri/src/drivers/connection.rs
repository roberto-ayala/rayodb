//! Opening a connection, whatever the engine.
//!
//! `connect` is the one place that turns stored credentials into a live
//! `Arc<dyn Driver>`. Everything downstream only ever sees the trait object.

use std::sync::Arc;

use crate::AppState;
use crate::common::enums::AppError;
use crate::drivers::kind::DriverKind;
use crate::drivers::traits::Driver;

/// Credentials for one project, as stored in `projects`.
#[derive(Clone, Debug, Default)]
pub struct ConnectionParams {
    pub username: String,
    pub password: String,
    pub database: String,
    pub host: String,
    pub port: String,
    pub use_ssl: bool,
}

impl ConnectionParams {
    /// Build from the 6-element key the frontend sends for an unsaved project.
    pub fn from_key(key: &[&str; 6]) -> Self {
        Self {
            username: key[0].to_string(),
            password: key[1].to_string(),
            database: key[2].to_string(),
            host: key[3].to_string(),
            port: key[4].to_string(),
            use_ssl: key[5] == "true",
        }
    }
}

/// Load a project's stored credentials and driver kind.
pub async fn load_project_params(
    app_state: &AppState,
    project_id: &str,
) -> Result<(DriverKind, ConnectionParams), AppError> {
    let conn = app_state
        .local_db
        .connect()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let mut rows = conn
        .query(
            "SELECT driver, username, password, database, host, port, ssl FROM projects WHERE id = ?1",
            libsql::params![project_id],
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let row = rows
        .next()
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?
        .ok_or_else(|| AppError::ProjectNotFound(project_id.to_string()))?;

    let kind = DriverKind::parse(&row.get::<String>(0).unwrap_or_default())?;
    let params = ConnectionParams {
        username: row.get::<String>(1).unwrap_or_default(),
        password: row.get::<String>(2).unwrap_or_default(),
        database: row.get::<String>(3).unwrap_or_default(),
        host: row.get::<String>(4).unwrap_or_default(),
        port: row.get::<String>(5).unwrap_or_default(),
        use_ssl: row.get::<String>(6).map(|s| s == "true").unwrap_or(false),
    };

    Ok((kind, params))
}

/// The project's driver kind, for commands that need to dispatch before a
/// connection exists.
pub async fn project_driver_kind(
    app_state: &AppState,
    project_id: &str,
) -> Result<DriverKind, AppError> {
    Ok(load_project_params(app_state, project_id).await?.0)
}

/// Open a connection for `kind` against `params`, already routed through any
/// SSH tunnel the caller set up.
pub async fn connect(
    kind: DriverKind,
    params: &ConnectionParams,
) -> Result<Arc<dyn Driver>, AppError> {
    match kind {
        DriverKind::Pgsql => {
            let driver = crate::drivers::pgsql::connect(params).await?;
            Ok(Arc::new(driver))
        }
    }
}

/// Verify credentials without registering a connection. Returns the server
/// version banner.
pub async fn test_connection(
    kind: DriverKind,
    params: &ConnectionParams,
) -> Result<String, AppError> {
    match kind {
        DriverKind::Pgsql => crate::drivers::pgsql::test_connection(params).await,
    }
}
