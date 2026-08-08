//! The MySQL implementation of `Driver`.
//!
//! The structural half maps cleanly onto the trait; what differs is the shape
//! of a schema. In MySQL a database *is* a schema, so the sidebar's schema
//! level lists databases and the connection's default database is simply the
//! one it opens on. Everything PostgreSQL-specific — materialized views, rules,
//! policies, extensions, LISTEN/NOTIFY — stays on the trait's defaults.

use std::time::Instant;

use async_trait::async_trait;
use mysql_async::{Conn, Opts, Pool};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::common::enums::AppError;
use crate::drivers::cache::{CELL_SEP, CachedQuery, VirtualCache};
use crate::drivers::kind::DriverKind;
use crate::drivers::packing::{
    MAX_STREAM_ROWS, QueryStreamEvent, join_sep, pack_result, pack_rows_vec,
};
use crate::drivers::traits::{Driver, PoolGauge, PoolStats};
use crate::drivers::types::*;

use super::introspection as intro;

pub struct MysqlDriver {
    pool: Pool,
    /// The database the connection opened on, which is also the schema the UI
    /// starts in.
    database: String,
    /// The id of the connection running the current statement, so KILL QUERY
    /// can reach it — MySQL has no cancel token.
    running_connection: Mutex<Option<u32>>,
    opts: Opts,
}

impl MysqlDriver {
    pub fn new(pool: Pool, opts: Opts, database: String) -> Self {
        Self {
            pool,
            database,
            running_connection: Mutex::new(None),
            opts,
        }
    }

    async fn conn(&self) -> Result<Conn, AppError> {
        self.pool
            .get_conn()
            .await
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))
    }

    /// A connection whose id is recorded, so a long statement can be killed.
    async fn tracked_conn(&self) -> Result<Conn, AppError> {
        let conn = self.conn().await?;
        *self.running_connection.lock().await = Some(conn.id());
        Ok(conn)
    }

    /// The schema to query when the caller passed an empty one — the sidebar
    /// always names a schema, but the object-detail paths do not always.
    fn schema_or_default<'a>(&'a self, schema: &'a str) -> &'a str {
        if schema.is_empty() {
            &self.database
        } else {
            schema
        }
    }
}

#[async_trait]
impl Driver for MysqlDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Mysql
    }

    fn pool_stats(&self) -> Option<PoolStats> {
        // mysql_async does not expose live pool occupancy, so report the
        // ceiling and leave the rest at zero rather than invent numbers.
        Some(PoolStats {
            query: PoolGauge {
                max: self.opts.pool_opts().constraints().max(),
                ..PoolGauge::default()
            },
            meta: PoolGauge::default(),
        })
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.pool
            .clone()
            .disconnect()
            .await
            .map_err(|e| AppError::DatabaseError(e.to_string()))
    }

    async fn cancel_query(&self) -> Result<bool, AppError> {
        let Some(id) = *self.running_connection.lock().await else {
            return Ok(false);
        };

        // KILL QUERY needs its own connection: the one to interrupt is busy.
        let mut conn = self.conn().await?;
        intro::fetch_grid(&mut conn, &format!("KILL QUERY {id}")).await?;
        Ok(true)
    }

    // ---- query execution -----------------------------------------------

    async fn run_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let mut conn = self.tracked_conn().await?;
        let start = Instant::now();
        let (columns, rows) = intro::fetch_grid(&mut conn, sql).await?;
        Ok((columns, rows, start.elapsed().as_millis() as f32))
    }

    async fn run_query_packed(&self, sql: &str, timeout_ms: u32) -> Result<PackedResult, AppError> {
        let mut conn = self.tracked_conn().await?;

        // MySQL's equivalent of statement_timeout only covers SELECTs, and is
        // in milliseconds like ours.
        if timeout_ms > 0 {
            intro::fetch_grid(
                &mut conn,
                &format!("SET SESSION max_execution_time = {timeout_ms}"),
            )
            .await
            .ok();
        }

        let start = Instant::now();
        let result = intro::fetch_grid(&mut conn, sql).await;

        if timeout_ms > 0 {
            intro::fetch_grid(&mut conn, "SET SESSION max_execution_time = 0")
                .await
                .ok();
        }

        let (columns, rows) = result?;
        Ok((
            pack_result(&columns, &rows),
            start.elapsed().as_millis() as f32,
        ))
    }

    async fn run_query_streamed(
        &self,
        sql: &str,
        stream_id: &str,
        app: &AppHandle,
    ) -> Result<(), AppError> {
        let mut conn = self.tracked_conn().await?;
        let start = Instant::now();
        let event_name = format!("query-stream-{}", stream_id);

        let (columns, rows) = intro::fetch_grid(&mut conn, sql).await?;

        let _ = app.emit(
            &event_name,
            QueryStreamEvent::Columns {
                columns: join_sep(&columns, CELL_SEP),
                total_rows: rows.len(),
            },
        );

        let capped = rows.len() > MAX_STREAM_ROWS;
        let rows = if capped {
            &rows[..MAX_STREAM_ROWS]
        } else {
            &rows[..]
        };

        for chunk in rows.chunks(10_000) {
            let _ = app.emit(
                &event_name,
                QueryStreamEvent::Chunk {
                    data: pack_rows_vec(chunk),
                },
            );
        }

        let _ = app.emit(
            &event_name,
            QueryStreamEvent::Done {
                elapsed: start.elapsed().as_millis() as f32,
                capped,
            },
        );
        Ok(())
    }

    async fn execute_virtual(
        &self,
        cache: &Mutex<VirtualCache>,
        sql: &str,
        query_id: &str,
        page_size: usize,
        timeout_ms: u32,
    ) -> Result<VirtualResult, AppError> {
        let mut conn = self.tracked_conn().await?;
        if timeout_ms > 0 {
            intro::fetch_grid(
                &mut conn,
                &format!("SET SESSION max_execution_time = {timeout_ms}"),
            )
            .await
            .ok();
        }

        let start = Instant::now();
        let result = intro::fetch_grid(&mut conn, sql).await;

        if timeout_ms > 0 {
            intro::fetch_grid(&mut conn, "SET SESSION max_execution_time = 0")
                .await
                .ok();
        }
        let (columns, rows) = result?;

        let page_size = page_size.max(1);
        let pages: Vec<String> = rows.chunks(page_size).map(pack_rows_vec).collect();
        let first_page = pages.first().cloned().unwrap_or_default();
        let total_rows = rows.len();

        cache
            .lock()
            .await
            .insert(query_id.to_string(), CachedQuery { pages, page_size });

        Ok((
            join_sep(&columns, CELL_SEP),
            total_rows,
            first_page,
            start.elapsed().as_millis() as f32,
        ))
    }

    // ---- schema tree ---------------------------------------------------

    async fn load_schemas(&self) -> Result<SchemaList, AppError> {
        // A database *is* the schema here, so the schema level of a connected
        // database is that database and nothing else. Returning every database
        // would repeat the server's whole list inside each one.
        //
        // With no database configured there is nothing to be inside, so the
        // server's list is the right answer: it is what the user browses.
        if self.database.is_empty() {
            return intro::load_schemas(&mut self.conn().await?).await;
        }
        Ok(vec![self.database.clone()])
    }

    async fn load_databases(&self) -> Result<Vec<String>, AppError> {
        intro::load_databases(&mut self.conn().await?).await
    }

    async fn load_tables(&self, schema: &str) -> Result<TableList, AppError> {
        intro::load_tables(&mut self.conn().await?, self.schema_or_default(schema)).await
    }

    async fn load_columns(&self, schema: &str, table: &str) -> Result<ColumnList, AppError> {
        intro::load_columns(
            &mut self.conn().await?,
            self.schema_or_default(schema),
            table,
        )
        .await
    }

    async fn load_column_details(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnDetail>, AppError> {
        intro::load_column_details(
            &mut self.conn().await?,
            self.schema_or_default(schema),
            table,
        )
        .await
    }

    async fn load_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexDetail>, AppError> {
        intro::load_indexes(
            &mut self.conn().await?,
            self.schema_or_default(schema),
            table,
        )
        .await
    }

    async fn load_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintDetail>, AppError> {
        intro::load_constraints(
            &mut self.conn().await?,
            self.schema_or_default(schema),
            table,
        )
        .await
    }

    async fn load_views(&self, schema: &str) -> Result<Vec<String>, AppError> {
        intro::load_views(&mut self.conn().await?, self.schema_or_default(schema)).await
    }

    async fn load_foreign_keys(&self, schema: &str) -> Result<Vec<ForeignKeyInfo>, AppError> {
        intro::load_foreign_keys(&mut self.conn().await?, self.schema_or_default(schema)).await
    }

    async fn load_triggers(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<TriggerDetail>, AppError> {
        intro::load_triggers(
            &mut self.conn().await?,
            self.schema_or_default(schema),
            table,
        )
        .await
    }

    async fn load_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>, AppError> {
        intro::load_functions(&mut self.conn().await?, self.schema_or_default(schema)).await
    }

    async fn load_procedures(&self, schema: &str) -> Result<Vec<ProcedureInfo>, AppError> {
        intro::load_procedures(&mut self.conn().await?, self.schema_or_default(schema)).await
    }

    // ---- object inspection ---------------------------------------------

    async fn fk_details(
        &self,
        schema: &str,
        table: &str,
        direction: &str,
    ) -> Result<Vec<FKDetail>, AppError> {
        intro::fk_details(
            &mut self.conn().await?,
            self.schema_or_default(schema),
            table,
            direction,
        )
        .await
    }

    async fn table_statistics(&self, schema: &str, table: &str) -> Result<ObjectStats, AppError> {
        intro::table_statistics(
            &mut self.conn().await?,
            self.schema_or_default(schema),
            table,
        )
        .await
    }

    async fn generate_ddl(
        &self,
        schema: &str,
        name: &str,
        object_type: &str,
    ) -> Result<String, AppError> {
        intro::generate_ddl(
            &mut self.conn().await?,
            self.schema_or_default(schema),
            name,
            object_type,
        )
        .await
    }

    // ---- monitoring ----------------------------------------------------

    async fn load_activity(&self) -> Result<Grid, AppError> {
        let (_, rows) = intro::fetch_grid(
            &mut self.conn().await?,
            "SELECT id, user, host, db, command, time, state, info
             FROM information_schema.processlist
             ORDER BY time DESC",
        )
        .await?;
        Ok(rows)
    }

    async fn load_server_settings(&self) -> Result<Grid, AppError> {
        let (_, rows) = intro::fetch_grid(
            &mut self.conn().await?,
            "SELECT variable_name, variable_value
             FROM performance_schema.global_variables
             ORDER BY variable_name",
        )
        .await?;
        Ok(rows)
    }
}
