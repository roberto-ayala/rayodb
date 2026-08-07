pub type PgsqlLoadSchemas = Vec<String>;
/// (name, size, parent, partition_bound, partition_key) — parent and bound are
/// empty unless the table is a partition, key unless it is partitioned itself
pub type PgsqlLoadTables = Vec<(String, String, String, String, String)>;
pub type PgsqlLoadColumns = Vec<String>;
