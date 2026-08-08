//! Opening a connection, whatever the engine.
//!
//! `connect` is the one place that turns stored credentials into a live
//! `Arc<dyn Driver>`. Everything downstream only ever sees the trait object.

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::AppState;
use crate::common::enums::AppError;
use crate::drivers::kind::DriverKind;
use crate::drivers::traits::Driver;

/// Credentials for one project, as stored in `projects`.
///
/// The named fields cover what a networked server needs. Anything an engine
/// wants that these cannot express — a SQLite file path, a MySQL unix socket —
/// travels in `options`, which is persisted as JSON in `projects.options`.
#[derive(Clone, Debug, Default)]
pub struct ConnectionParams {
    pub username: String,
    pub password: String,
    pub database: String,
    pub host: String,
    pub port: String,
    pub use_ssl: bool,
    #[allow(dead_code)]
    pub options: BTreeMap<String, String>,
}

impl ConnectionParams {
    /// Read by whichever driver needs it. Nothing consumes these yet —
    /// PostgreSQL is fully described by the named fields — but the plumbing has
    /// to exist before a file-based engine can be added.
    #[allow(dead_code)]
    /// A driver-specific setting, if present.
    pub fn option(&self, key: &str) -> Option<&str> {
        self.options
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    }

    /// Where a file-based engine keeps its database. Falls back to `database`,
    /// which is where a path would land if it came through the generic field.
    #[allow(dead_code)]
    pub fn file_path(&self) -> &str {
        self.option("path").unwrap_or(&self.database)
    }

    /// Build from the 6-element key the frontend sends for an unsaved project.
    pub fn from_key(key: &[&str; 6]) -> Self {
        Self {
            username: key[0].to_string(),
            password: key[1].to_string(),
            database: key[2].to_string(),
            host: key[3].to_string(),
            port: key[4].to_string(),
            use_ssl: key[5] == "true",
            options: BTreeMap::new(),
        }
    }
}

/// Decode the JSON blob stored in `projects.options`. A malformed or empty
/// value yields no options rather than failing the connection outright.
fn parse_options(raw: &str) -> BTreeMap<String, String> {
    if raw.trim().is_empty() {
        return BTreeMap::new();
    }
    match sonic_rs::from_str::<BTreeMap<String, String>>(raw) {
        Ok(map) => map,
        Err(e) => {
            tracing::warn!("Ignoring unparseable project options {raw:?}: {e}");
            BTreeMap::new()
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
            "SELECT driver, username, password, database, host, port, ssl, options FROM projects WHERE id = ?1",
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
        options: parse_options(&row.get::<String>(7).unwrap_or_default()),
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
        DriverKind::Sqlite => {
            let driver = crate::drivers::sqlite::connect(params).await?;
            Ok(Arc::new(driver))
        }
        DriverKind::Mysql => {
            let driver = crate::drivers::mysql::connect(params).await?;
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
        DriverKind::Sqlite => crate::drivers::sqlite::test_connection(params).await,
        DriverKind::Mysql => crate::drivers::mysql::test_connection(params).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_round_trip_through_json() {
        let params = ConnectionParams {
            options: parse_options(r#"{"path":"/tmp/app.db","mode":"ro"}"#),
            ..Default::default()
        };
        assert_eq!(params.option("path"), Some("/tmp/app.db"));
        assert_eq!(params.option("mode"), Some("ro"));
        assert_eq!(params.option("missing"), None);
        assert_eq!(params.file_path(), "/tmp/app.db");
    }

    #[test]
    fn absent_or_broken_options_do_not_fail_the_connection() {
        assert!(parse_options("").is_empty());
        assert!(parse_options("   ").is_empty());
        assert!(parse_options("not json").is_empty());
        assert!(parse_options("[1,2]").is_empty());
    }

    #[test]
    fn a_file_path_falls_back_to_the_database_field() {
        // Older rows, and the connection-string paste path, put a SQLite path
        // in `database` because that is the only field they have.
        let params = ConnectionParams {
            database: "/var/data/app.sqlite".to_string(),
            ..Default::default()
        };
        assert_eq!(params.file_path(), "/var/data/app.sqlite");

        // An empty option must not shadow the fallback.
        let params = ConnectionParams {
            database: "/var/data/app.sqlite".to_string(),
            options: parse_options(r#"{"path":""}"#),
            ..Default::default()
        };
        assert_eq!(params.file_path(), "/var/data/app.sqlite");
    }
}
