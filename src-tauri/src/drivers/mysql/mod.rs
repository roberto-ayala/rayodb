pub mod driver;
pub mod introspection;

#[cfg(test)]
mod tests;

pub use driver::MysqlDriver;

use mysql_async::{Opts, OptsBuilder, Pool, PoolConstraints, PoolOpts};

use crate::common::enums::AppError;
use crate::drivers::connection::ConnectionParams;

/// Build connection options. The SSH tunnel, if any, has already rewritten
/// host and port by the time this runs, exactly as for PostgreSQL.
fn opts_from(params: &ConnectionParams) -> Result<Opts, AppError> {
    let constraints = PoolConstraints::new(1, 16)
        .ok_or_else(|| AppError::ConnectionFailed("Invalid pool bounds".to_string()))?;

    let mut builder = OptsBuilder::default()
        .ip_or_hostname(params.host.clone())
        .tcp_port(params.port.parse().unwrap_or(3306))
        .user(Some(params.username.clone()))
        .pass(Some(params.password.clone()))
        .pool_opts(PoolOpts::default().with_constraints(constraints));

    // MySQL can connect without naming a database; the sidebar then lists them
    // all and the user picks.
    if !params.database.is_empty() {
        builder = builder.db_name(Some(params.database.clone()));
    }

    if !params.use_ssl {
        builder = builder.ssl_opts(None);
    }

    Ok(Opts::from(builder))
}

pub async fn connect(params: &ConnectionParams) -> Result<MysqlDriver, AppError> {
    let opts = opts_from(params)?;
    let pool = Pool::new(opts.clone());

    // Validate eagerly so a bad password fails here rather than on the first
    // sidebar refresh.
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;
    introspection::fetch_grid(&mut conn, "SELECT 1").await?;
    drop(conn);

    Ok(MysqlDriver::new(pool, opts, params.database.clone()))
}

/// Report the server version, matching the PostgreSQL connection test.
pub async fn test_connection(params: &ConnectionParams) -> Result<String, AppError> {
    let pool = Pool::new(opts_from(params)?);
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;

    let (_, rows) = introspection::fetch_grid(&mut conn, "SELECT VERSION()").await?;
    let version = rows
        .first()
        .and_then(|r| r.first())
        .cloned()
        .unwrap_or_default();

    drop(conn);
    pool.disconnect()
        .await
        .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;

    Ok(format!("MySQL {version}"))
}
