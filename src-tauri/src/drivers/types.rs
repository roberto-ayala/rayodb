//! Wire types shared by every driver.
//!
//! These are the shapes the frontend already expects, so they live here rather
//! than inside a single engine's module. `drivers::pgsql` re-exports them so
//! existing paths keep working.

/// Schema list.
pub type SchemaList = Vec<String>;

/// (name, size, parent, partition_bound, partition_key) — parent and bound are
/// empty unless the table is a partition, key unless it is partitioned itself.
/// Engines without partitioning leave the last three empty.
pub type TableList = Vec<(String, String, String, String, String)>;

/// Column name list.
pub type ColumnList = Vec<String>;

/// Column detail info: (name, data_type, nullable, default_value)
pub type ColumnDetail = (String, String, bool, Option<String>);

/// Index info: (index_name, column_name, is_unique, is_primary)
pub type IndexDetail = (String, String, bool, bool);

/// Trigger info: (trigger_name, event, timing)
pub type TriggerDetail = (String, String, String);

/// Rule info: (rule_name, event)
pub type RuleDetail = (String, String);

/// Policy info: (policy_name, permissive, command)
pub type PolicyDetail = (String, String, String);

/// Function info: (name, return_type, arguments)
pub type FunctionInfo = (String, String, String);

/// Foreign table info: (name, server)
pub type ForeignTableInfo = (String, String);

/// Event trigger info: (name, event, enabled, function)
pub type EventTriggerInfo = (String, String, String, String);

/// Data type info: (name, kind, detail)
pub type DataTypeInfo = (String, String, String);

/// Trigger function info: (name, arguments, kind) — kind is trigger or event_trigger
pub type TriggerFunctionInfo = (String, String, String);

/// Procedure info: (name, arguments)
pub type ProcedureInfo = (String, String);

/// Sequence info: (name, last_value)
pub type SequenceInfo = (String, String);

/// Database stats: (stat_name, stat_value)
pub type DbStat = (String, String);

/// Constraint info: (constraint_name, constraint_type, column_name)
pub type ConstraintDetail = (String, String, String);

/// FK relation: (source_table, source_column, target_table, target_column)
pub type ForeignKeyInfo = (String, String, String, String);

/// Tablespace info: (name, owner, location, size)
pub type TablespaceInfo = (String, String, String, String);

/// Object statistics: Vec of (key, value) pairs
pub type ObjectStats = Vec<(String, String)>;

/// FK detail: (constraint_name, source_schema, source_table, source_column, target_schema, target_table, target_column, on_update, on_delete)
pub type FKDetail = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);

/// A query result as (columns, rows, elapsed_ms).
pub type QueryResult = (Vec<String>, Vec<Vec<String>>, f32);

/// A packed query result as (packed_payload, elapsed_ms).
pub type PackedResult = (String, f32);

/// A virtual query result as (packed_columns, total_rows, first_page, elapsed_ms).
pub type VirtualResult = (String, usize, String, f32);

/// Untyped grid used by the monitoring panels.
pub type Grid = Vec<Vec<String>>;
