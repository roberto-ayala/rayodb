pub type PgsqlLoadSchemas = Vec<String>;
/// (name, size, parent) — parent is empty unless the table is a partition
pub type PgsqlLoadTables = Vec<(String, String, String)>;
pub type PgsqlLoadColumns = Vec<String>;
