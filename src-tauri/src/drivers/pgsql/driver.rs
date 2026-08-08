//! The PostgreSQL implementation of `Driver`.
//!
//! One instance owns everything a connected project needs: the query pool, the
//! metadata pool (kept separate so sidebar refreshes never queue behind a long
//! user query), the cancel token of the last statement, and the config needed
//! to open the side connections LISTEN requires.

use std::sync::Arc;

use async_trait::async_trait;
use deadpool_postgres::{Client, Pool};
use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio_postgres::{CancelToken, Config, NoTls};

use crate::common::enums::AppError;
use crate::drivers::cache::VirtualCache;
use crate::drivers::kind::DriverKind;
use crate::drivers::traits::{Driver, PoolGauge, PoolStats};
use crate::drivers::types::*;

use super::commands::pool_connection::{apply_statement_timeout, reset_statement_timeout};
use super::roles_schema_objects::{
    DbGrant, DefaultGrant, PgRole, RoleSpec, SchemaGrant, SchemaObject, TableGrant,
};
use super::{
    close_virtual, execute_query, execute_query_packed, execute_query_streamed, execute_virtual,
    fetch_virtual_page,
};

pub struct PgsqlDriver {
    pub query_pool: Arc<Pool>,
    pub meta_pool: Arc<Pool>,
    /// The cancel token of the most recent statement on the query pool.
    cancel_token: Mutex<Option<CancelToken>>,
    /// Kept so LISTEN can open its own dedicated connection without going back
    /// to the local project store for credentials.
    config: Config,
    use_ssl: bool,
}

impl PgsqlDriver {
    pub fn new(query_pool: Arc<Pool>, meta_pool: Arc<Pool>, config: Config, use_ssl: bool) -> Self {
        Self {
            query_pool,
            meta_pool,
            cancel_token: Mutex::new(None),
            config,
            use_ssl,
        }
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn use_ssl(&self) -> bool {
        self.use_ssl
    }

    /// A client from the metadata pool. Used by everything that feeds the
    /// sidebar and the inspector panels.
    async fn meta(&self) -> Result<Client, AppError> {
        self.meta_pool
            .get()
            .await
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))
    }

    /// A client from the query pool, recording its cancel token so an
    /// in-flight statement can be killed from the UI.
    async fn query(&self) -> Result<Client, AppError> {
        let client = self
            .query_pool
            .get()
            .await
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;
        *self.cancel_token.lock().await = Some(client.cancel_token());
        Ok(client)
    }

    /// A client from the query pool for statements the user cannot cancel
    /// (short DDL and grant changes), so they do not clobber the token of a
    /// long-running SELECT.
    async fn exec(&self) -> Result<Client, AppError> {
        self.query_pool
            .get()
            .await
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))
    }
}

/// Quote an identifier for interpolation into DDL.
fn qi(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[async_trait]
impl Driver for PgsqlDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Pgsql
    }

    fn pool_stats(&self) -> Option<PoolStats> {
        fn gauge(pool: &Pool) -> PoolGauge {
            let status = pool.status();
            PoolGauge {
                open: status.size,
                available: status.available,
                max: status.max_size,
                waiting: status.waiting,
            }
        }

        Some(PoolStats {
            query: gauge(&self.query_pool),
            meta: gauge(&self.meta_pool),
        })
    }

    async fn cancel_query(&self) -> Result<bool, AppError> {
        let token = {
            let guard = self.cancel_token.lock().await;
            guard.clone()
        };
        let Some(token) = token else {
            return Ok(false);
        };

        if self.use_ssl {
            let tls_connector = TlsConnector::builder()
                .build()
                .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;
            token
                .cancel_query(MakeTlsConnector::new(tls_connector))
                .await
                .map_err(|e| AppError::QueryFailed(format!("Failed to cancel query: {e}")))?;
        } else {
            token
                .cancel_query(NoTls)
                .await
                .map_err(|e| AppError::QueryFailed(format!("Failed to cancel query: {e}")))?;
        }

        Ok(true)
    }

    // ---- query execution -----------------------------------------------

    async fn run_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let client = self.query().await?;
        execute_query(&client, sql).await
    }

    async fn run_query_packed(&self, sql: &str, timeout_ms: u32) -> Result<PackedResult, AppError> {
        let client = self.query().await?;
        apply_statement_timeout(&client, timeout_ms).await;
        let result = execute_query_packed(&client, sql).await;
        reset_statement_timeout(&client, timeout_ms).await;
        result
    }

    async fn run_query_streamed(
        &self,
        sql: &str,
        stream_id: &str,
        app: &AppHandle,
    ) -> Result<(), AppError> {
        let client = self.query().await?;
        execute_query_streamed(&client, sql, stream_id, app).await
    }

    async fn execute_virtual(
        &self,
        cache: &Mutex<VirtualCache>,
        sql: &str,
        query_id: &str,
        page_size: usize,
        timeout_ms: u32,
    ) -> Result<VirtualResult, AppError> {
        let client = self.query().await?;
        apply_statement_timeout(&client, timeout_ms).await;
        let result = execute_virtual(&client, cache, sql, query_id, page_size).await;
        reset_statement_timeout(&client, timeout_ms).await;
        result
    }

    // ---- schema tree ---------------------------------------------------

    async fn load_databases(&self) -> Result<Vec<String>, AppError> {
        super::load_databases(&self.meta_pool).await
    }

    async fn load_schemas(&self) -> Result<SchemaList, AppError> {
        let client = self.meta().await?;
        super::load_schemas(
            &client,
            r#"SELECT schema_name FROM information_schema.schemata
               WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
               ORDER BY schema_name"#,
        )
        .await
    }

    async fn load_tables(&self, schema: &str) -> Result<TableList, AppError> {
        let client = self.meta().await?;
        super::load_tables(
            &client,
            // pg_class rather than information_schema.tables: the standard view also
            // reports views and foreign tables, which have their own categories, and
            // sizing by oid avoids quoting the identifier back into a string.
            // 'r' = ordinary table, 'p' = partitioned table.
            //
            // A partitioned table stores nothing itself, so its own size reads as 0
            // however much its partitions hold — hence the sum over the tree. The
            // parent column is what lets the sidebar nest partitions; old-style
            // INHERITS children are not partitions and stay at the top level.
            r#"SELECT c.relname,
                      CASE WHEN c.relkind = 'p'
                           THEN (SELECT pg_size_pretty(SUM(pg_total_relation_size(pt.relid)))
                                 FROM pg_partition_tree(c.oid) pt)
                           ELSE pg_size_pretty(pg_total_relation_size(c.oid))
                      END AS size,
                      CASE WHEN c.relispartition
                           THEN (SELECT p.relname::text
                                 FROM pg_inherits i
                                 JOIN pg_class p ON p.oid = i.inhparent
                                 WHERE i.inhrelid = c.oid)
                           ELSE ''
                      END AS parent,
                      -- A partition's identity is its bound; its name only says
                      -- what someone called it
                      COALESCE(pg_get_expr(c.relpartbound, c.oid), '') AS partition_bound,
                      CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) ELSE '' END AS partition_key
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = $1
                 AND c.relkind IN ('r', 'p')
               ORDER BY c.relname"#,
            schema,
        )
        .await
    }

    async fn load_columns(&self, schema: &str, table: &str) -> Result<ColumnList, AppError> {
        let client = self.meta().await?;
        super::load_columns(&client, schema, table).await
    }

    async fn load_column_details(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnDetail>, AppError> {
        let client = self.meta().await?;
        super::load_column_details(&client, schema, table).await
    }

    async fn load_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexDetail>, AppError> {
        let client = self.meta().await?;
        super::load_indexes(&client, schema, table).await
    }

    async fn load_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintDetail>, AppError> {
        let client = self.meta().await?;
        super::load_constraints(&client, schema, table).await
    }

    async fn load_views(&self, schema: &str) -> Result<Vec<String>, AppError> {
        let client = self.meta().await?;
        super::load_views(&client, schema).await
    }

    async fn load_foreign_keys(&self, schema: &str) -> Result<Vec<ForeignKeyInfo>, AppError> {
        let client = self.meta().await?;
        super::load_foreign_keys(&client, schema).await
    }

    async fn load_triggers(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<TriggerDetail>, AppError> {
        let client = self.meta().await?;
        super::load_triggers(&client, schema, table).await
    }

    async fn load_rules(&self, schema: &str, table: &str) -> Result<Vec<RuleDetail>, AppError> {
        let client = self.meta().await?;
        super::load_rules(&client, schema, table).await
    }

    async fn load_policies(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<PolicyDetail>, AppError> {
        let client = self.meta().await?;
        super::load_policies(&client, schema, table).await
    }

    async fn load_materialized_views(&self, schema: &str) -> Result<Vec<String>, AppError> {
        let client = self.meta().await?;
        super::load_materialized_views(&client, schema).await
    }

    async fn load_sequences(&self, schema: &str) -> Result<Vec<SequenceInfo>, AppError> {
        let client = self.meta().await?;
        super::load_sequences(&client, schema).await
    }

    async fn load_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>, AppError> {
        let client = self.meta().await?;
        super::load_functions(&client, schema).await
    }

    async fn load_procedures(&self, schema: &str) -> Result<Vec<ProcedureInfo>, AppError> {
        let client = self.meta().await?;
        super::load_procedures(&client, schema).await
    }

    async fn load_trigger_functions(
        &self,
        schema: &str,
    ) -> Result<Vec<TriggerFunctionInfo>, AppError> {
        let client = self.meta().await?;
        super::load_trigger_functions(&client, schema).await
    }

    async fn load_foreign_tables(&self, schema: &str) -> Result<Vec<ForeignTableInfo>, AppError> {
        let client = self.meta().await?;
        super::load_foreign_tables(&client, schema).await
    }

    async fn load_data_types(&self, schema: &str) -> Result<Vec<DataTypeInfo>, AppError> {
        let client = self.meta().await?;
        super::load_data_types(&client, schema).await
    }

    async fn load_event_triggers(&self) -> Result<Vec<EventTriggerInfo>, AppError> {
        let client = self.meta().await?;
        super::load_event_triggers(&client).await
    }

    async fn load_tablespaces(&self) -> Result<Vec<TablespaceInfo>, AppError> {
        super::load_tablespaces(&self.meta_pool).await
    }

    // ---- object inspection ---------------------------------------------

    async fn table_statistics(&self, schema: &str, table: &str) -> Result<ObjectStats, AppError> {
        let client = self.meta().await?;
        super::load_table_statistics(&client, schema, table).await
    }

    async fn fk_details(
        &self,
        schema: &str,
        table: &str,
        direction: &str,
    ) -> Result<Vec<FKDetail>, AppError> {
        let client = self.meta().await?;
        super::load_fk_details(&client, schema, table, direction).await
    }

    async fn view_info(&self, schema: &str, view: &str) -> Result<ObjectStats, AppError> {
        let client = self.meta().await?;
        super::load_view_info(&client, schema, view).await
    }

    async fn matview_info(&self, schema: &str, matview: &str) -> Result<ObjectStats, AppError> {
        let client = self.meta().await?;
        super::load_matview_info(&client, schema, matview).await
    }

    async fn function_info(&self, schema: &str, function: &str) -> Result<ObjectStats, AppError> {
        let client = self.meta().await?;
        super::load_function_info(&client, schema, function).await
    }

    async fn generate_ddl(
        &self,
        schema: &str,
        name: &str,
        object_type: &str,
    ) -> Result<String, AppError> {
        let client = self.meta().await?;
        super::generate_full_ddl(&client, schema, name, object_type).await
    }

    async fn table_action(
        &self,
        action: &str,
        schema: &str,
        table: &str,
        object_type: &str,
    ) -> Result<String, AppError> {
        let qualified = format!("{}.{}", qi(schema), qi(table));

        let sql = match (object_type, action) {
            ("table", "ANALYZE") => format!("ANALYZE {qualified}"),
            ("table", "VACUUM") => format!("VACUUM {qualified}"),
            ("table", "VACUUM FULL") => format!("VACUUM FULL {qualified}"),
            ("table", "REINDEX") => format!("REINDEX TABLE {qualified}"),
            ("table", "TRUNCATE") => format!("TRUNCATE TABLE {qualified}"),
            ("table", "DROP TABLE") => format!("DROP TABLE {qualified}"),
            ("view", "DROP VIEW") => format!("DROP VIEW {qualified}"),
            ("view", "DROP VIEW CASCADE") => format!("DROP VIEW {qualified} CASCADE"),
            ("matview", "REFRESH") => format!("REFRESH MATERIALIZED VIEW {qualified}"),
            ("matview", "REFRESH CONCURRENTLY") => {
                format!("REFRESH MATERIALIZED VIEW CONCURRENTLY {qualified}")
            }
            ("matview", "DROP MATERIALIZED VIEW") => format!("DROP MATERIALIZED VIEW {qualified}"),
            ("function" | "trigger-function", "DROP FUNCTION") => {
                format!("DROP FUNCTION {qualified}")
            }
            ("function" | "trigger-function", "DROP FUNCTION CASCADE") => {
                format!("DROP FUNCTION {qualified} CASCADE")
            }
            _ => {
                return Err(AppError::QueryFailed(format!(
                    "Unknown action '{}' for object type '{}'",
                    action, object_type
                )));
            }
        };

        let client = self.exec().await?;
        execute_query(&client, &sql).await?;

        Ok(format!("{action} completed successfully."))
    }

    async fn extract_schema_objects(&self, schema: &str) -> Result<Vec<SchemaObject>, AppError> {
        let client = self.meta().await?;
        super::extract_schema_objects(&client, schema).await
    }

    // ---- monitoring ----------------------------------------------------

    async fn load_activity(&self) -> Result<Grid, AppError> {
        let client = self.meta().await?;
        super::load_activity(&client).await
    }

    async fn load_database_stats(&self) -> Result<Vec<DbStat>, AppError> {
        let client = self.meta().await?;
        super::load_database_stats(&client).await
    }

    async fn load_table_stats(&self) -> Result<Grid, AppError> {
        let client = self.meta().await?;
        super::load_table_stats(&client).await
    }

    async fn load_locks(&self) -> Result<Grid, AppError> {
        let client = self.meta().await?;
        super::load_active_locks(&client).await
    }

    async fn load_index_usage(&self) -> Result<Grid, AppError> {
        let client = self.meta().await?;
        super::load_index_usage(&client).await
    }

    async fn load_table_bloat(&self) -> Result<Grid, AppError> {
        let client = self.meta().await?;
        super::load_table_bloat(&client).await
    }

    async fn load_server_settings(&self) -> Result<Grid, AppError> {
        let client = self.meta().await?;
        super::load_pg_settings(&client).await
    }

    async fn load_extensions(&self) -> Result<Grid, AppError> {
        let client = self.meta().await?;
        super::load_extensions(&client).await
    }

    async fn load_available_extensions(&self) -> Result<Grid, AppError> {
        let client = self.meta().await?;
        super::load_available_extensions(&client).await
    }

    // ---- pub/sub -------------------------------------------------------

    async fn listen_start(
        &self,
        channel: &str,
        project_id: &str,
        app: &AppHandle,
    ) -> Result<bool, AppError> {
        super::pubsub::listen_start(self, channel, project_id, app).await
    }

    async fn listen_stop(
        &self,
        channel: &str,
        project_id: &str,
        app: &AppHandle,
    ) -> Result<bool, AppError> {
        super::pubsub::listen_stop(channel, project_id, app).await
    }

    async fn notify_send(&self, channel: &str, payload: &str) -> Result<bool, AppError> {
        let client = self.exec().await?;
        super::pubsub::notify_send(&client, channel, payload).await
    }

    async fn discover_channels(&self) -> Result<Vec<String>, AppError> {
        let client = self.meta().await?;
        super::discover_notify_channels(&client).await
    }

    // ---- roles and grants ----------------------------------------------

    async fn load_roles(&self) -> Result<Vec<PgRole>, AppError> {
        let client = self.meta().await?;
        super::load_roles(&client).await
    }

    async fn load_table_grants(&self, role: &str) -> Result<Vec<TableGrant>, AppError> {
        let client = self.meta().await?;
        super::load_table_grants(&client, role).await
    }

    async fn load_database_grants(&self, role: &str) -> Result<Vec<DbGrant>, AppError> {
        let client = self.meta().await?;
        super::load_database_grants(&client, role).await
    }

    async fn load_schema_table_grants(&self, role: &str) -> Result<Vec<SchemaGrant>, AppError> {
        let client = self.meta().await?;
        super::load_schema_table_grants(&client, role).await
    }

    async fn load_default_table_grants(&self, role: &str) -> Result<Vec<DefaultGrant>, AppError> {
        let client = self.meta().await?;
        super::load_default_table_grants(&client, role).await
    }

    async fn create_role(&self, spec: &RoleSpec) -> Result<String, AppError> {
        let client = self.exec().await?;
        super::create_role(&client, spec).await?;
        Ok(format!("Role \"{}\" created.", spec.name))
    }

    async fn alter_role(&self, spec: &RoleSpec) -> Result<String, AppError> {
        let client = self.exec().await?;
        super::alter_role(&client, spec).await?;
        Ok(format!("Role \"{}\" updated.", spec.name))
    }

    async fn drop_role(&self, name: &str) -> Result<String, AppError> {
        let client = self.exec().await?;
        super::drop_role(&client, name).await?;
        Ok(format!("Role \"{name}\" dropped."))
    }

    async fn set_database_privilege(
        &self,
        database: &str,
        role_name: &str,
        privilege: &str,
        granted: bool,
    ) -> Result<String, AppError> {
        let client = self.exec().await?;
        super::set_database_privilege(&client, database, role_name, privilege, granted).await?;
        Ok(format!(
            "{} {privilege} on \"{database}\" {} \"{role_name}\".",
            if granted { "Granted" } else { "Revoked" },
            if granted { "to" } else { "from" },
        ))
    }

    async fn set_schema_table_privilege(
        &self,
        schema: &str,
        role_name: &str,
        privilege: &str,
        granted: bool,
    ) -> Result<String, AppError> {
        let client = self.exec().await?;
        super::set_schema_table_privilege(&client, schema, role_name, privilege, granted).await?;
        Ok(format!(
            "{} {privilege} on every table in \"{schema}\".",
            if granted { "Granted" } else { "Revoked" }
        ))
    }

    async fn set_default_table_privilege(
        &self,
        schema: &str,
        role_name: &str,
        privilege: &str,
        granted: bool,
    ) -> Result<String, AppError> {
        let client = self.exec().await?;
        super::set_default_table_privilege(&client, schema, role_name, privilege, granted).await?;
        Ok(format!(
            "New tables in \"{schema}\" will {} {privilege}.",
            if granted { "carry" } else { "no longer carry" }
        ))
    }

    async fn revoke_table_privileges(
        &self,
        schema: &str,
        table: &str,
        role_name: &str,
    ) -> Result<String, AppError> {
        let client = self.exec().await?;
        super::revoke_table_privileges(&client, schema, table, role_name).await?;
        Ok(format!(
            "Revoked every privilege on \"{schema}\".\"{table}\"."
        ))
    }

    // ---- bulk load -----------------------------------------------------

    async fn csv_import(
        &self,
        file_path: &str,
        schema: &str,
        table: &str,
        column_mapping: Vec<(usize, String)>,
    ) -> Result<usize, AppError> {
        let client = self.exec().await?;
        super::import_csv_to_table(&client, file_path, schema, table, &column_mapping).await
    }
}

/// Cache eviction is driver-independent, but the virtual-scroll commands reach
/// it through the connected driver, so keep the thin wrappers here.
pub async fn close_cached_query(
    cache: &Mutex<VirtualCache>,
    query_id: &str,
) -> Result<(), AppError> {
    close_virtual(cache, query_id).await
}

pub async fn fetch_cached_page(
    cache: &Mutex<VirtualCache>,
    query_id: &str,
    col_count: usize,
    offset: usize,
    limit: usize,
) -> Result<String, AppError> {
    fetch_virtual_page(cache, query_id, col_count, offset, limit).await
}
