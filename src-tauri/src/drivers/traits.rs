//! The driver contract.
//!
//! One live connection to one project's database implements `Driver`. The
//! Tauri commands in `drivers::commands` never name an engine — they look up
//! the project's `Arc<dyn Driver>` and dispatch through here.
//!
//! Every method past the core set defaults to `AppError::Unsupported`, so a new
//! engine only implements what it actually has. That default is what lets
//! SQLite skip roles and MySQL skip materialized views without stubbing out
//! dozens of methods.

use async_trait::async_trait;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::common::enums::AppError;
use crate::drivers::cache::VirtualCache;
use crate::drivers::capabilities::Capabilities;
use crate::drivers::kind::DriverKind;
use crate::drivers::pgsql::roles_schema_objects::{
    DbGrant, DefaultGrant, PgRole, RoleSpec, SchemaGrant, SchemaObject, TableGrant,
};
use crate::drivers::types::*;

/// Build the "engine X has no Y" error for an unimplemented method.
macro_rules! unsupported {
    ($self:expr, $feature:literal) => {
        Err(AppError::Unsupported($feature, $self.kind().as_str()))
    };
}

type Res<T> = Result<T, AppError>;

/// Connection-pool occupancy, as reported to the resource monitor.
#[derive(Clone, Copy, Debug, Default)]
pub struct PoolGauge {
    pub open: usize,
    pub available: usize,
    pub max: usize,
    pub waiting: usize,
}

/// A driver's pools. Engines that hold a single connection (SQLite) report it
/// as a one-slot query pool and leave `meta` at zero.
#[derive(Clone, Copy, Debug, Default)]
pub struct PoolStats {
    pub query: PoolGauge,
    pub meta: PoolGauge,
}

#[async_trait]
pub trait Driver: Send + Sync {
    // ---- core ----------------------------------------------------------

    fn kind(&self) -> DriverKind;

    /// What this connection supports. Defaults to the engine's static set;
    /// override only if a driver must narrow it per server (an old version
    /// lacking a feature, say).
    fn capabilities(&self) -> Capabilities {
        self.kind().capabilities()
    }

    /// Release engine-side resources. The connection registry drops the handle
    /// afterwards, so this only needs to cover what `Drop` cannot.
    async fn disconnect(&self) -> Res<()> {
        Ok(())
    }

    /// Cancel the statement currently running on the query connection.
    async fn cancel_query(&self) -> Res<bool> {
        unsupported!(self, "query cancellation")
    }

    /// Pool occupancy for the resource monitor. `None` means the engine keeps
    /// no pool worth reporting.
    fn pool_stats(&self) -> Option<PoolStats> {
        None
    }

    // ---- query execution -----------------------------------------------

    async fn run_query(&self, sql: &str) -> Res<QueryResult>;

    async fn run_query_packed(&self, sql: &str, timeout_ms: u32) -> Res<PackedResult>;

    async fn run_query_streamed(&self, sql: &str, stream_id: &str, app: &AppHandle) -> Res<()>;

    async fn execute_virtual(
        &self,
        cache: &Mutex<VirtualCache>,
        sql: &str,
        query_id: &str,
        page_size: usize,
        timeout_ms: u32,
    ) -> Res<VirtualResult>;

    // ---- schema tree ---------------------------------------------------

    async fn load_databases(&self) -> Res<Vec<String>> {
        unsupported!(self, "database listing")
    }

    async fn load_schemas(&self) -> Res<SchemaList>;

    async fn load_tables(&self, schema: &str) -> Res<TableList>;

    async fn load_columns(&self, schema: &str, table: &str) -> Res<ColumnList>;

    async fn load_column_details(&self, schema: &str, table: &str) -> Res<Vec<ColumnDetail>>;

    async fn load_indexes(&self, schema: &str, table: &str) -> Res<Vec<IndexDetail>>;

    async fn load_constraints(&self, schema: &str, table: &str) -> Res<Vec<ConstraintDetail>>;

    async fn load_views(&self, schema: &str) -> Res<Vec<String>>;

    async fn load_foreign_keys(&self, schema: &str) -> Res<Vec<ForeignKeyInfo>>;

    async fn load_triggers(&self, _schema: &str, _table: &str) -> Res<Vec<TriggerDetail>> {
        unsupported!(self, "triggers")
    }

    async fn load_rules(&self, _schema: &str, _table: &str) -> Res<Vec<RuleDetail>> {
        unsupported!(self, "rules")
    }

    async fn load_policies(&self, _schema: &str, _table: &str) -> Res<Vec<PolicyDetail>> {
        unsupported!(self, "row-level security policies")
    }

    async fn load_materialized_views(&self, _schema: &str) -> Res<Vec<String>> {
        unsupported!(self, "materialized views")
    }

    async fn load_sequences(&self, _schema: &str) -> Res<Vec<SequenceInfo>> {
        unsupported!(self, "sequences")
    }

    async fn load_functions(&self, _schema: &str) -> Res<Vec<FunctionInfo>> {
        unsupported!(self, "functions")
    }

    async fn load_procedures(&self, _schema: &str) -> Res<Vec<ProcedureInfo>> {
        unsupported!(self, "procedures")
    }

    async fn load_trigger_functions(&self, _schema: &str) -> Res<Vec<TriggerFunctionInfo>> {
        unsupported!(self, "trigger functions")
    }

    async fn load_foreign_tables(&self, _schema: &str) -> Res<Vec<ForeignTableInfo>> {
        unsupported!(self, "foreign tables")
    }

    async fn load_data_types(&self, _schema: &str) -> Res<Vec<DataTypeInfo>> {
        unsupported!(self, "user-defined types")
    }

    async fn load_event_triggers(&self) -> Res<Vec<EventTriggerInfo>> {
        unsupported!(self, "event triggers")
    }

    async fn load_tablespaces(&self) -> Res<Vec<TablespaceInfo>> {
        unsupported!(self, "tablespaces")
    }

    // ---- object inspection ---------------------------------------------

    async fn table_statistics(&self, _schema: &str, _table: &str) -> Res<ObjectStats> {
        unsupported!(self, "table statistics")
    }

    async fn fk_details(
        &self,
        _schema: &str,
        _table: &str,
        _direction: &str,
    ) -> Res<Vec<FKDetail>> {
        unsupported!(self, "foreign key details")
    }

    async fn view_info(&self, _schema: &str, _view: &str) -> Res<ObjectStats> {
        unsupported!(self, "view details")
    }

    async fn matview_info(&self, _schema: &str, _matview: &str) -> Res<ObjectStats> {
        unsupported!(self, "materialized view details")
    }

    async fn function_info(&self, _schema: &str, _function: &str) -> Res<ObjectStats> {
        unsupported!(self, "function details")
    }

    async fn generate_ddl(&self, _schema: &str, _name: &str, _object_type: &str) -> Res<String> {
        unsupported!(self, "DDL generation")
    }

    async fn table_action(
        &self,
        _action: &str,
        _schema: &str,
        _table: &str,
        _object_type: &str,
    ) -> Res<String> {
        unsupported!(self, "table maintenance actions")
    }

    async fn extract_schema_objects(&self, _schema: &str) -> Res<Vec<SchemaObject>> {
        unsupported!(self, "schema extraction")
    }

    // ---- monitoring ----------------------------------------------------

    async fn load_activity(&self) -> Res<Grid> {
        unsupported!(self, "server activity")
    }

    async fn load_database_stats(&self) -> Res<Vec<DbStat>> {
        unsupported!(self, "database statistics")
    }

    async fn load_table_stats(&self) -> Res<Grid> {
        unsupported!(self, "table statistics")
    }

    async fn load_locks(&self) -> Res<Grid> {
        unsupported!(self, "lock inspection")
    }

    async fn load_index_usage(&self) -> Res<Grid> {
        unsupported!(self, "index usage statistics")
    }

    async fn load_table_bloat(&self) -> Res<Grid> {
        unsupported!(self, "bloat estimation")
    }

    async fn load_server_settings(&self) -> Res<Grid> {
        unsupported!(self, "server settings")
    }

    async fn load_extensions(&self) -> Res<Grid> {
        unsupported!(self, "extensions")
    }

    async fn load_available_extensions(&self) -> Res<Grid> {
        unsupported!(self, "extensions")
    }

    // ---- pub/sub -------------------------------------------------------

    async fn listen_start(&self, _channel: &str, _project_id: &str, _app: &AppHandle) -> Res<bool> {
        unsupported!(self, "pub/sub")
    }

    async fn listen_stop(&self, _channel: &str, _project_id: &str, _app: &AppHandle) -> Res<bool> {
        unsupported!(self, "pub/sub")
    }

    async fn notify_send(&self, _channel: &str, _payload: &str) -> Res<bool> {
        unsupported!(self, "pub/sub")
    }

    async fn discover_channels(&self) -> Res<Vec<String>> {
        unsupported!(self, "pub/sub")
    }

    // ---- roles and grants ----------------------------------------------

    async fn load_roles(&self) -> Res<Vec<PgRole>> {
        unsupported!(self, "roles")
    }

    async fn load_table_grants(&self, _role: &str) -> Res<Vec<TableGrant>> {
        unsupported!(self, "grants")
    }

    async fn load_database_grants(&self, _role: &str) -> Res<Vec<DbGrant>> {
        unsupported!(self, "grants")
    }

    async fn load_schema_table_grants(&self, _role: &str) -> Res<Vec<SchemaGrant>> {
        unsupported!(self, "grants")
    }

    async fn load_default_table_grants(&self, _role: &str) -> Res<Vec<DefaultGrant>> {
        unsupported!(self, "default privileges")
    }

    async fn create_role(&self, _spec: &RoleSpec) -> Res<String> {
        unsupported!(self, "roles")
    }

    async fn alter_role(&self, _spec: &RoleSpec) -> Res<String> {
        unsupported!(self, "roles")
    }

    async fn drop_role(&self, _name: &str) -> Res<String> {
        unsupported!(self, "roles")
    }

    async fn set_database_privilege(
        &self,
        _database: &str,
        _role_name: &str,
        _privilege: &str,
        _granted: bool,
    ) -> Res<String> {
        unsupported!(self, "grants")
    }

    async fn set_schema_table_privilege(
        &self,
        _schema: &str,
        _role_name: &str,
        _privilege: &str,
        _granted: bool,
    ) -> Res<String> {
        unsupported!(self, "grants")
    }

    async fn set_default_table_privilege(
        &self,
        _schema: &str,
        _role_name: &str,
        _privilege: &str,
        _granted: bool,
    ) -> Res<String> {
        unsupported!(self, "default privileges")
    }

    async fn revoke_table_privileges(
        &self,
        _schema: &str,
        _table: &str,
        _role_name: &str,
    ) -> Res<String> {
        unsupported!(self, "grants")
    }

    // ---- bulk load -----------------------------------------------------

    async fn csv_import(
        &self,
        _file_path: &str,
        _schema: &str,
        _table: &str,
        _column_mapping: Vec<(usize, String)>,
    ) -> Res<usize> {
        unsupported!(self, "CSV import")
    }
}
