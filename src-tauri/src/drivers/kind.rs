//! Which engine a project talks to.

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::common::enums::AppError;

/// The engines the app can drive. Persisted verbatim in `projects.driver`, so
/// the string forms are part of the on-disk format — keep them stable.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum DriverKind {
    #[default]
    #[serde(rename = "PGSQL")]
    Pgsql,
    #[serde(rename = "MYSQL")]
    Mysql,
    #[serde(rename = "SQLITE")]
    Sqlite,
}

impl DriverKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DriverKind::Pgsql => "PGSQL",
            DriverKind::Mysql => "MYSQL",
            DriverKind::Sqlite => "SQLITE",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            DriverKind::Pgsql => "PostgreSQL",
            DriverKind::Mysql => "MySQL",
            DriverKind::Sqlite => "SQLite",
        }
    }

    /// Every engine the app has a vocabulary for. Not the same as the ones it
    /// can open — see `is_implemented`.
    pub const ALL: [DriverKind; 3] = [DriverKind::Pgsql, DriverKind::Mysql, DriverKind::Sqlite];

    /// Whether a driver actually exists behind this name yet. The UI lists only
    /// these, so a half-built engine is never offered.
    pub fn is_implemented(self) -> bool {
        matches!(self, DriverKind::Pgsql | DriverKind::Sqlite)
    }

    /// Where the connection lives: a file on disk rather than a host and port.
    /// Drives which fields the connection form shows.
    pub fn is_file_based(self) -> bool {
        matches!(self, DriverKind::Sqlite)
    }

    pub fn default_port(self) -> &'static str {
        match self {
            DriverKind::Pgsql => "5432",
            DriverKind::Mysql => "3306",
            DriverKind::Sqlite => "",
        }
    }

    /// Parse the value stored in `projects.driver`. Empty falls back to the
    /// default so rows written before the column existed still load.
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value.trim().to_ascii_uppercase().as_str() {
            "" => Ok(DriverKind::default()),
            "PGSQL" | "POSTGRES" | "POSTGRESQL" => Ok(DriverKind::Pgsql),
            "MYSQL" | "MARIADB" => Ok(DriverKind::Mysql),
            "SQLITE" | "SQLITE3" => Ok(DriverKind::Sqlite),
            other => Err(AppError::UnknownDriver(other.to_string())),
        }
    }
}

impl fmt::Display for DriverKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
