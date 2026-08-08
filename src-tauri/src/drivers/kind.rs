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
}

impl DriverKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DriverKind::Pgsql => "PGSQL",
        }
    }

    /// Parse the value stored in `projects.driver`. Empty falls back to the
    /// default so rows written before the column existed still load.
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value.trim().to_ascii_uppercase().as_str() {
            "" => Ok(DriverKind::default()),
            "PGSQL" | "POSTGRES" | "POSTGRESQL" => Ok(DriverKind::Pgsql),
            other => Err(AppError::UnknownDriver(other.to_string())),
        }
    }
}

impl fmt::Display for DriverKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
