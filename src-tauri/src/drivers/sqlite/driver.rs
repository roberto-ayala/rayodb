//! The SQLite implementation of `Driver`.
//!
//! SQLite is a file, not a server, so most of what the trait offers does not
//! apply: no roles, no extensions, no pub/sub, no server statistics. Those stay
//! on the trait's `Unsupported` defaults and the capability set turns them off
//! in the UI, so the absence shows up as a smaller tree rather than an error.
//!
//! There is one schema, always called `main`, which keeps the sidebar's
//! server → schema → object shape working without a special case.

use std::time::Instant;

use async_trait::async_trait;
use libsql::{Connection, Database};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::common::enums::AppError;
use crate::drivers::cache::{CELL_SEP, CachedQuery, VirtualCache};
use crate::drivers::kind::DriverKind;
use crate::drivers::packing::{
    MAX_STREAM_ROWS, QueryStreamEvent, join_sep, pack_result, pack_rows_vec,
};
use crate::drivers::traits::Driver;
use crate::drivers::types::*;

use super::introspection as intro;

/// The single schema SQLite exposes. Named so the tree keeps its shape.
pub const MAIN_SCHEMA: &str = "main";

pub struct SqliteDriver {
    db: Database,
    path: String,
}

impl SqliteDriver {
    pub fn new(db: Database, path: String) -> Self {
        Self { db, path }
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    /// A connection to the file. libsql hands these out cheaply, so there is
    /// no pool to manage — unlike a server, there is nothing to queue behind.
    fn conn(&self) -> Result<Connection, AppError> {
        self.db
            .connect()
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))
    }
}

#[async_trait]
impl Driver for SqliteDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Sqlite
    }

    // ---- query execution -----------------------------------------------

    async fn run_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let conn = self.conn()?;
        let start = Instant::now();
        let (columns, rows) = intro::fetch_grid(&conn, sql).await?;
        Ok((columns, rows, start.elapsed().as_millis() as f32))
    }

    async fn run_query_packed(
        &self,
        sql: &str,
        _timeout_ms: u32,
    ) -> Result<PackedResult, AppError> {
        // No statement_timeout equivalent: SQLite's busy timeout governs lock
        // waits, not how long a running statement may take.
        let conn = self.conn()?;
        let start = Instant::now();
        let (columns, rows) = intro::fetch_grid(&conn, sql).await?;
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
        let conn = self.conn()?;
        let start = Instant::now();
        let event_name = format!("query-stream-{}", stream_id);

        let mut rows = conn
            .query(sql, ())
            .await
            .map_err(|e| AppError::QueryFailed(e.to_string()))?;

        let col_count = rows.column_count();
        let mut columns = Vec::with_capacity(col_count as usize);
        for i in 0..col_count {
            columns.push(rows.column_name(i).unwrap_or("?").to_string());
        }

        // The row count is not known ahead of time here, unlike a cursor over
        // a counted result set, so report 0 and let the chunks tell the story.
        let _ = app.emit(
            &event_name,
            QueryStreamEvent::Columns {
                columns: join_sep(&columns, CELL_SEP),
                total_rows: 0,
            },
        );

        const CHUNK: usize = 10_000;
        let mut batch: Vec<Vec<String>> = Vec::with_capacity(CHUNK);
        let mut sent = 0usize;
        let mut capped = false;

        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| AppError::QueryFailed(e.to_string()))?
        {
            let mut cells = Vec::with_capacity(col_count as usize);
            for i in 0..col_count {
                cells.push(intro::value_to_string(
                    row.get_value(i)
                        .map_err(|e| AppError::QueryFailed(e.to_string()))?,
                ));
            }
            batch.push(cells);

            if batch.len() >= CHUNK {
                sent += batch.len();
                let _ = app.emit(
                    &event_name,
                    QueryStreamEvent::Chunk {
                        data: pack_rows_vec(&batch),
                    },
                );
                batch.clear();
                if sent >= MAX_STREAM_ROWS {
                    capped = true;
                    break;
                }
            }
        }

        if !batch.is_empty() {
            let _ = app.emit(
                &event_name,
                QueryStreamEvent::Chunk {
                    data: pack_rows_vec(&batch),
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
        _timeout_ms: u32,
    ) -> Result<VirtualResult, AppError> {
        let conn = self.conn()?;
        let start = Instant::now();
        let (columns, rows) = intro::fetch_grid(&conn, sql).await?;

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
        // One implicit schema, named so the tree keeps its shape.
        Ok(vec![MAIN_SCHEMA.to_string()])
    }

    async fn load_tables(&self, _schema: &str) -> Result<TableList, AppError> {
        intro::load_tables(&self.conn()?).await
    }

    async fn load_columns(&self, _schema: &str, table: &str) -> Result<ColumnList, AppError> {
        intro::load_columns(&self.conn()?, table).await
    }

    async fn load_column_details(
        &self,
        _schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnDetail>, AppError> {
        intro::load_column_details(&self.conn()?, table).await
    }

    async fn load_indexes(&self, _schema: &str, table: &str) -> Result<Vec<IndexDetail>, AppError> {
        intro::load_indexes(&self.conn()?, table).await
    }

    async fn load_constraints(
        &self,
        _schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintDetail>, AppError> {
        intro::load_constraints(&self.conn()?, table).await
    }

    async fn load_views(&self, _schema: &str) -> Result<Vec<String>, AppError> {
        intro::load_views(&self.conn()?).await
    }

    async fn load_foreign_keys(&self, _schema: &str) -> Result<Vec<ForeignKeyInfo>, AppError> {
        intro::load_foreign_keys(&self.conn()?).await
    }

    async fn load_triggers(
        &self,
        _schema: &str,
        table: &str,
    ) -> Result<Vec<TriggerDetail>, AppError> {
        intro::load_triggers(&self.conn()?, table).await
    }

    // ---- object inspection ---------------------------------------------

    async fn fk_details(
        &self,
        _schema: &str,
        table: &str,
        direction: &str,
    ) -> Result<Vec<FKDetail>, AppError> {
        intro::fk_details(&self.conn()?, table, direction).await
    }

    async fn table_statistics(&self, _schema: &str, table: &str) -> Result<ObjectStats, AppError> {
        intro::table_statistics(&self.conn()?, table).await
    }

    async fn generate_ddl(
        &self,
        _schema: &str,
        name: &str,
        _object_type: &str,
    ) -> Result<String, AppError> {
        // SQLite stores the original statement, so this is the real DDL rather
        // than something reconstructed from a catalogue.
        intro::object_ddl(&self.conn()?, name).await
    }
}
