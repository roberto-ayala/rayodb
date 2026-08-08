//! Reading a MySQL server's shape.
//!
//! Everything comes from `information_schema`, which is standard enough that
//! the queries read like the PostgreSQL ones — the difference is what a schema
//! *is*. In MySQL a database is the schema, so the sidebar's schema level lists
//! databases and `TABLE_SCHEMA` is what every query filters on.

use mysql_async::prelude::*;
use mysql_async::{Conn, Row, Value};

use crate::common::enums::AppError;
use crate::drivers::types::*;

pub fn failed(e: mysql_async::Error) -> AppError {
    AppError::QueryFailed(e.to_string())
}

/// Render a cell for the grid. MySQL hands back bytes for text columns, so
/// anything not valid UTF-8 is reported by size rather than mangled.
pub fn value_to_string(value: &Value) -> String {
    match value {
        Value::NULL => "null".to_string(),
        Value::Bytes(b) => match std::str::from_utf8(b) {
            Ok(s) => s.to_string(),
            Err(_) => format!("[{} bytes]", b.len()),
        },
        Value::Int(i) => i.to_string(),
        Value::UInt(u) => u.to_string(),
        Value::Float(f) => f.to_string(),
        Value::Double(d) => d.to_string(),
        Value::Date(y, m, d, h, mi, s, us) => {
            if *h == 0 && *mi == 0 && *s == 0 && *us == 0 {
                format!("{y:04}-{m:02}-{d:02}")
            } else if *us == 0 {
                format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}")
            } else {
                format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}.{us:06}")
            }
        }
        Value::Time(neg, days, h, m, s, us) => {
            let sign = if *neg { "-" } else { "" };
            let hours = *days * 24 + *h as u32;
            if *us == 0 {
                format!("{sign}{hours:02}:{m:02}:{s:02}")
            } else {
                format!("{sign}{hours:02}:{m:02}:{s:02}.{us:06}")
            }
        }
    }
}

/// Column names and stringified rows for an arbitrary statement.
pub async fn fetch_grid(
    conn: &mut Conn,
    sql: &str,
) -> Result<(Vec<String>, Vec<Vec<String>>), AppError> {
    let mut result = conn.query_iter(sql).await.map_err(failed)?;

    // A multi-statement script yields several sets; take the first that has
    // columns, matching how the PostgreSQL driver reports the last row set.
    let columns: Vec<String> = result
        .columns()
        .map(|cols| cols.iter().map(|c| c.name_str().to_string()).collect())
        .unwrap_or_default();

    let rows: Vec<Row> = result.collect().await.map_err(failed)?;
    let out = rows
        .into_iter()
        .map(|row| {
            (0..row.len())
                .map(|i| row.as_ref(i).map(value_to_string).unwrap_or_default())
                .collect()
        })
        .collect();

    Ok((columns, out))
}

/// The first column of every row.
async fn fetch_column(conn: &mut Conn, sql: &str) -> Result<Vec<String>, AppError> {
    let (_, rows) = fetch_grid(conn, sql).await?;
    Ok(rows
        .into_iter()
        .filter_map(|mut r| {
            if r.is_empty() {
                None
            } else {
                Some(r.remove(0))
            }
        })
        .collect())
}

/// Databases a user would browse — the server's own four are noise here.
pub async fn load_schemas(conn: &mut Conn) -> Result<SchemaList, AppError> {
    fetch_column(
        conn,
        "SELECT schema_name FROM information_schema.schemata
         WHERE schema_name NOT IN ('mysql', 'information_schema',
                                   'performance_schema', 'sys')
         ORDER BY schema_name",
    )
    .await
}

pub async fn load_tables(conn: &mut Conn, schema: &str) -> Result<TableList, AppError> {
    let sql = format!(
        // DATA_LENGTH + INDEX_LENGTH is an estimate for InnoDB, which is what
        // SHOW TABLE STATUS reports too; there is no exact cheap answer.
        "SELECT table_name,
                COALESCE(
                    CASE
                        WHEN (data_length + index_length) >= 1073741824
                            THEN CONCAT(ROUND((data_length + index_length) / 1073741824, 1), ' GB')
                        WHEN (data_length + index_length) >= 1048576
                            THEN CONCAT(ROUND((data_length + index_length) / 1048576, 1), ' MB')
                        WHEN (data_length + index_length) >= 1024
                            THEN CONCAT(ROUND((data_length + index_length) / 1024, 1), ' kB')
                        ELSE CONCAT(COALESCE(data_length + index_length, 0), ' bytes')
                    END, '')
         FROM information_schema.tables
         WHERE table_schema = {} AND table_type = 'BASE TABLE'
         ORDER BY table_name",
        quote_literal(schema)
    );
    let (_, rows) = fetch_grid(conn, &sql).await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.first().cloned().unwrap_or_default(),
                r.get(1).cloned().unwrap_or_default(),
                // MySQL partitions exist but are not modelled as child tables
                // the way the sidebar expects, so leave the partition fields
                // empty rather than half-fill them.
                String::new(),
                String::new(),
                String::new(),
            )
        })
        .collect())
}

pub async fn load_views(conn: &mut Conn, schema: &str) -> Result<Vec<String>, AppError> {
    fetch_column(
        conn,
        &format!(
            "SELECT table_name FROM information_schema.views
             WHERE table_schema = {} ORDER BY table_name",
            quote_literal(schema)
        ),
    )
    .await
}

pub async fn load_column_details(
    conn: &mut Conn,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnDetail>, AppError> {
    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT column_name, column_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = {} AND table_name = {}
             ORDER BY ordinal_position",
            quote_literal(schema),
            quote_literal(table)
        ),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let name = r.first().cloned().unwrap_or_default();
            let data_type = r.get(1).cloned().unwrap_or_default();
            let nullable = r.get(2).map(|v| v == "YES").unwrap_or(true);
            let default = r.get(3).filter(|v| *v != "null").cloned();
            (name, data_type, nullable, default)
        })
        .collect())
}

pub async fn load_columns(
    conn: &mut Conn,
    schema: &str,
    table: &str,
) -> Result<ColumnList, AppError> {
    Ok(load_column_details(conn, schema, table)
        .await?
        .into_iter()
        .map(|c| c.0)
        .collect())
}

pub async fn load_indexes(
    conn: &mut Conn,
    schema: &str,
    table: &str,
) -> Result<Vec<IndexDetail>, AppError> {
    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT index_name, column_name, non_unique
             FROM information_schema.statistics
             WHERE table_schema = {} AND table_name = {}
             ORDER BY index_name, seq_in_index",
            quote_literal(schema),
            quote_literal(table)
        ),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let index_name = r.first().cloned().unwrap_or_default();
            let column = r.get(1).cloned().unwrap_or_default();
            let is_unique = r.get(2).map(|v| v == "0").unwrap_or(false);
            // MySQL always calls the primary key's index PRIMARY.
            let is_primary = index_name == "PRIMARY";
            (index_name, column, is_unique, is_primary)
        })
        .collect())
}

pub async fn load_constraints(
    conn: &mut Conn,
    schema: &str,
    table: &str,
) -> Result<Vec<ConstraintDetail>, AppError> {
    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT tc.constraint_name, tc.constraint_type,
                    COALESCE(kcu.column_name, '')
             FROM information_schema.table_constraints tc
             LEFT JOIN information_schema.key_column_usage kcu
                    ON kcu.constraint_schema = tc.constraint_schema
                   AND kcu.constraint_name = tc.constraint_name
                   AND kcu.table_name = tc.table_name
             WHERE tc.table_schema = {} AND tc.table_name = {}
             ORDER BY tc.constraint_name, kcu.ordinal_position",
            quote_literal(schema),
            quote_literal(table)
        ),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.first().cloned().unwrap_or_default(),
                r.get(1).cloned().unwrap_or_default(),
                r.get(2).cloned().unwrap_or_default(),
            )
        })
        .collect())
}

pub async fn load_foreign_keys(
    conn: &mut Conn,
    schema: &str,
) -> Result<Vec<ForeignKeyInfo>, AppError> {
    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT table_name, column_name, referenced_table_name, referenced_column_name
             FROM information_schema.key_column_usage
             WHERE table_schema = {} AND referenced_table_name IS NOT NULL
             ORDER BY table_name, ordinal_position",
            quote_literal(schema)
        ),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.first().cloned().unwrap_or_default(),
                r.get(1).cloned().unwrap_or_default(),
                r.get(2).cloned().unwrap_or_default(),
                r.get(3).cloned().unwrap_or_default(),
            )
        })
        .collect())
}

pub async fn fk_details(
    conn: &mut Conn,
    schema: &str,
    table: &str,
    direction: &str,
) -> Result<Vec<FKDetail>, AppError> {
    // referential_constraints carries the actions; key_column_usage the columns.
    let filter = if direction == "incoming" {
        format!("kcu.referenced_table_name = {}", quote_literal(table))
    } else {
        format!("kcu.table_name = {}", quote_literal(table))
    };

    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT rc.constraint_name,
                    kcu.table_schema, kcu.table_name, kcu.column_name,
                    kcu.referenced_table_schema, kcu.referenced_table_name,
                    kcu.referenced_column_name,
                    rc.update_rule, rc.delete_rule
             FROM information_schema.referential_constraints rc
             JOIN information_schema.key_column_usage kcu
               ON kcu.constraint_schema = rc.constraint_schema
              AND kcu.constraint_name = rc.constraint_name
             WHERE rc.constraint_schema = {} AND {}
             ORDER BY rc.constraint_name, kcu.ordinal_position",
            quote_literal(schema),
            filter
        ),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let get = |i: usize| r.get(i).cloned().unwrap_or_default();
            (
                get(0),
                get(1),
                get(2),
                get(3),
                get(4),
                get(5),
                get(6),
                get(7),
                get(8),
            )
        })
        .collect())
}

pub async fn load_triggers(
    conn: &mut Conn,
    schema: &str,
    table: &str,
) -> Result<Vec<TriggerDetail>, AppError> {
    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT trigger_name, event_manipulation, action_timing
             FROM information_schema.triggers
             WHERE trigger_schema = {} AND event_object_table = {}
             ORDER BY trigger_name",
            quote_literal(schema),
            quote_literal(table)
        ),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.first().cloned().unwrap_or_default(),
                r.get(1).cloned().unwrap_or_default(),
                r.get(2).cloned().unwrap_or_default(),
            )
        })
        .collect())
}

/// Stored functions. MySQL keeps functions and procedures in one table,
/// separated by ROUTINE_TYPE.
pub async fn load_functions(conn: &mut Conn, schema: &str) -> Result<Vec<FunctionInfo>, AppError> {
    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT routine_name, COALESCE(dtd_identifier, ''), ''
             FROM information_schema.routines
             WHERE routine_schema = {} AND routine_type = 'FUNCTION'
             ORDER BY routine_name",
            quote_literal(schema)
        ),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.first().cloned().unwrap_or_default(),
                r.get(1).cloned().unwrap_or_default(),
                r.get(2).cloned().unwrap_or_default(),
            )
        })
        .collect())
}

pub async fn load_procedures(
    conn: &mut Conn,
    schema: &str,
) -> Result<Vec<ProcedureInfo>, AppError> {
    let names = fetch_column(
        conn,
        &format!(
            "SELECT routine_name FROM information_schema.routines
             WHERE routine_schema = {} AND routine_type = 'PROCEDURE'
             ORDER BY routine_name",
            quote_literal(schema)
        ),
    )
    .await?;
    Ok(names.into_iter().map(|n| (n, String::new())).collect())
}

pub async fn load_databases(conn: &mut Conn) -> Result<Vec<String>, AppError> {
    load_schemas(conn).await
}

/// `SHOW CREATE` is the only place MySQL exposes an object's DDL.
pub async fn generate_ddl(
    conn: &mut Conn,
    schema: &str,
    name: &str,
    object_type: &str,
) -> Result<String, AppError> {
    let qualified = format!("{}.{}", quote_ident(schema), quote_ident(name));
    let keyword = match object_type {
        "view" => "VIEW",
        "function" | "trigger-function" => "FUNCTION",
        "procedure" => "PROCEDURE",
        "trigger" => "TRIGGER",
        _ => "TABLE",
    };

    let (_, rows) = fetch_grid(conn, &format!("SHOW CREATE {keyword} {qualified}")).await?;
    // SHOW CREATE returns (name, statement); the statement column moves around
    // by object type, so take the longest cell rather than a fixed index.
    rows.into_iter()
        .next()
        .and_then(|r| r.into_iter().max_by_key(|c| c.len()))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::QueryFailed(format!("No DDL available for {name}")))
}

/// Quote an identifier for MySQL, which uses backticks rather than the double
/// quotes PostgreSQL uses.
pub fn quote_ident(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// Quote a value as a SQL string literal. information_schema filters take
/// these as data, so this is what keeps an object name from becoming SQL.
pub fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_use_backticks() {
        assert_eq!(quote_ident("orders"), "`orders`");
        // A backtick inside the name is doubled, so it cannot end the quote.
        assert_eq!(quote_ident("we`ird"), "`we``ird`");
    }

    #[test]
    fn literals_escape_quotes_and_backslashes() {
        assert_eq!(quote_literal("shop"), "'shop'");
        assert_eq!(quote_literal("o'brien"), "'o''brien'");
        // MySQL also treats backslash as an escape character, unlike Postgres.
        assert_eq!(quote_literal("a\\b"), "'a\\\\b'");
        assert_eq!(
            quote_literal("x'; DROP TABLE orders; --"),
            "'x''; DROP TABLE orders; --'"
        );
    }

    #[test]
    fn values_render_for_the_grid() {
        assert_eq!(value_to_string(&Value::NULL), "null");
        assert_eq!(value_to_string(&Value::Int(-7)), "-7");
        assert_eq!(value_to_string(&Value::Bytes(b"hi".to_vec())), "hi");
        assert_eq!(
            value_to_string(&Value::Date(2026, 8, 7, 0, 0, 0, 0)),
            "2026-08-07"
        );
        assert_eq!(
            value_to_string(&Value::Date(2026, 8, 7, 13, 5, 9, 0)),
            "2026-08-07 13:05:09"
        );
        // Invalid UTF-8 must not be mangled into replacement characters.
        assert_eq!(
            value_to_string(&Value::Bytes(vec![0xff, 0xfe])),
            "[2 bytes]"
        );
    }
}
