pub mod driver;
pub mod introspection;

#[cfg(test)]
mod tests;

pub use driver::SqliteDriver;

use crate::common::enums::AppError;
use crate::drivers::connection::ConnectionParams;

/// Open the database file. SQLite creates a missing file on connect, which is
/// almost never what someone opening a database client wants, so an absent path
/// is an error rather than a silently empty database.
pub async fn connect(params: &ConnectionParams) -> Result<SqliteDriver, AppError> {
    let path = params.file_path();
    if path.trim().is_empty() {
        return Err(AppError::ConnectionFailed(
            "No database file was given".to_string(),
        ));
    }

    // In-memory databases are legitimate and have no file to check for.
    if path != ":memory:" && !std::path::Path::new(path).exists() {
        return Err(AppError::ConnectionFailed(format!(
            "No such database file: {path}"
        )));
    }

    let db = libsql::Builder::new_local(path)
        .build()
        .await
        .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;

    // Fail here rather than on the first sidebar refresh if the file is not
    // actually a database.
    let conn = db
        .connect()
        .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;
    conn.query("SELECT 1", ())
        .await
        .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;

    Ok(SqliteDriver::new(db, path.to_string()))
}

/// Report the engine version, matching what the connection test shows for a
/// server.
pub async fn test_connection(params: &ConnectionParams) -> Result<String, AppError> {
    let driver = connect(params).await?;
    let conn = libsql::Builder::new_local(driver.path())
        .build()
        .await
        .map_err(|e| AppError::ConnectionFailed(e.to_string()))?
        .connect()
        .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;

    let (_, rows) = introspection::fetch_grid(&conn, "SELECT sqlite_version()").await?;
    let version = rows
        .first()
        .and_then(|r| r.first())
        .cloned()
        .unwrap_or_default();

    Ok(format!("SQLite {version}"))
}
