//! Reading a SQLite database's shape.
//!
//! There is no information_schema here: the catalogue is `sqlite_master`, a
//! table of the DDL text itself, and everything structural comes from PRAGMA
//! functions. PRAGMA takes no bind parameters, so identifiers are interpolated
//! — `quote_literal` is what keeps that safe.

use libsql::Connection;

use crate::common::enums::AppError;
use crate::drivers::types::*;

/// Escape a value for interpolation into a SQL string literal. PRAGMA
/// arguments cannot be bound, so this is the only thing standing between an
/// object name and injection.
pub fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn failed(e: libsql::Error) -> AppError {
    AppError::QueryFailed(e.to_string())
}

/// Render a cell the way the grid expects: NULL as the literal "null", blobs
/// by size since they are not text, everything else as its value.
pub fn value_to_string(value: libsql::Value) -> String {
    match value {
        libsql::Value::Null => "null".to_string(),
        libsql::Value::Integer(i) => i.to_string(),
        libsql::Value::Real(f) => f.to_string(),
        libsql::Value::Text(s) => s,
        libsql::Value::Blob(b) => format!("[{} bytes]", b.len()),
    }
}

/// Run a query and return (columns, rows) with every cell stringified.
pub async fn fetch_grid(
    conn: &Connection,
    sql: &str,
) -> Result<(Vec<String>, Vec<Vec<String>>), AppError> {
    let mut rows = conn.query(sql, ()).await.map_err(failed)?;

    let col_count = rows.column_count();
    let mut columns = Vec::with_capacity(col_count as usize);
    for i in 0..col_count {
        columns.push(rows.column_name(i).unwrap_or("?").to_string());
    }

    let mut out = Vec::new();
    while let Some(row) = rows.next().await.map_err(failed)? {
        let mut cells = Vec::with_capacity(col_count as usize);
        for i in 0..col_count {
            cells.push(value_to_string(row.get_value(i).map_err(failed)?));
        }
        out.push(cells);
    }

    // A statement with no result set reports no columns; surface the same
    // "no rows" shape the other drivers do rather than inventing one.
    Ok((columns, out))
}

/// The first column of every row, as strings.
async fn fetch_column(conn: &Connection, sql: &str) -> Result<Vec<String>, AppError> {
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

/// Objects of one `sqlite_master` type, skipping SQLite's own bookkeeping.
async fn master_names(conn: &Connection, kind: &str) -> Result<Vec<String>, AppError> {
    fetch_column(
        conn,
        &format!(
            "SELECT name FROM sqlite_master
             WHERE type = {} AND name NOT LIKE 'sqlite_%'
             ORDER BY name",
            quote_literal(kind)
        ),
    )
    .await
}

pub async fn load_tables(conn: &Connection) -> Result<TableList, AppError> {
    let names = master_names(conn, "table").await?;
    // SQLite has no per-table size without the dbstat virtual table, which is
    // a compile-time option; leave the column blank rather than guess.
    Ok(names
        .into_iter()
        .map(|name| {
            (
                name,
                String::new(),
                String::new(),
                String::new(),
                String::new(),
            )
        })
        .collect())
}

pub async fn load_views(conn: &Connection) -> Result<Vec<String>, AppError> {
    master_names(conn, "view").await
}

pub async fn load_column_details(
    conn: &Connection,
    table: &str,
) -> Result<Vec<ColumnDetail>, AppError> {
    // table_info yields (cid, name, type, notnull, dflt_value, pk).
    let (_, rows) = fetch_grid(
        conn,
        &format!("SELECT * FROM pragma_table_info({})", quote_literal(table)),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let name = r.get(1).cloned().unwrap_or_default();
            let data_type = r.get(2).cloned().unwrap_or_default();
            // SQLite lets a column have no declared type; say so rather than
            // showing an empty cell.
            let data_type = if data_type.is_empty() {
                "BLOB".to_string()
            } else {
                data_type
            };
            let nullable = r.get(3).map(|v| v == "0").unwrap_or(true);
            let default = r.get(4).filter(|v| *v != "null").cloned();
            (name, data_type, nullable, default)
        })
        .collect())
}

pub async fn load_columns(conn: &Connection, table: &str) -> Result<ColumnList, AppError> {
    Ok(load_column_details(conn, table)
        .await?
        .into_iter()
        .map(|c| c.0)
        .collect())
}

pub async fn load_indexes(conn: &Connection, table: &str) -> Result<Vec<IndexDetail>, AppError> {
    // index_list yields (seq, name, unique, origin, partial).
    let (_, indexes) = fetch_grid(
        conn,
        &format!("SELECT * FROM pragma_index_list({})", quote_literal(table)),
    )
    .await?;

    let mut out = Vec::new();
    for idx in indexes {
        let name = idx.get(1).cloned().unwrap_or_default();
        let is_unique = idx.get(2).map(|v| v == "1").unwrap_or(false);
        // origin 'pk' marks the index behind the primary key.
        let is_primary = idx.get(3).map(|v| v == "pk").unwrap_or(false);

        // index_info yields (seqno, cid, name) — one row per indexed column.
        let (_, cols) = fetch_grid(
            conn,
            &format!("SELECT * FROM pragma_index_info({})", quote_literal(&name)),
        )
        .await?;

        for col in cols {
            // An expression index reports a NULL column name.
            let column = col
                .get(2)
                .filter(|v| *v != "null")
                .cloned()
                .unwrap_or_else(|| "(expression)".to_string());
            out.push((name.clone(), column, is_unique, is_primary));
        }
    }
    Ok(out)
}

pub async fn load_constraints(
    conn: &Connection,
    table: &str,
) -> Result<Vec<ConstraintDetail>, AppError> {
    let mut out = Vec::new();

    // SQLite has no constraint catalogue, so reconstruct what it does record:
    // primary key and NOT NULL from table_info, foreign keys from their pragma.
    let (_, cols) = fetch_grid(
        conn,
        &format!("SELECT * FROM pragma_table_info({})", quote_literal(table)),
    )
    .await?;
    for col in &cols {
        let name = col.get(1).cloned().unwrap_or_default();
        if col.get(5).map(|v| v != "0").unwrap_or(false) {
            out.push(("PRIMARY KEY".to_string(), "PRIMARY KEY".to_string(), name));
        } else if col.get(3).map(|v| v == "1").unwrap_or(false) {
            out.push(("NOT NULL".to_string(), "CHECK".to_string(), name));
        }
    }

    for fk in fk_rows(conn, table).await? {
        let column = fk.get(3).cloned().unwrap_or_default();
        let target = fk.get(2).cloned().unwrap_or_default();
        out.push((format!("FK → {target}"), "FOREIGN KEY".to_string(), column));
    }

    // A unique index is how SQLite stores a UNIQUE constraint.
    for (index_name, column, is_unique, is_primary) in load_indexes(conn, table).await? {
        if is_unique && !is_primary {
            out.push((index_name, "UNIQUE".to_string(), column));
        }
    }

    Ok(out)
}

/// foreign_key_list yields (id, seq, table, from, to, on_update, on_delete, match).
async fn fk_rows(conn: &Connection, table: &str) -> Result<Vec<Vec<String>>, AppError> {
    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT * FROM pragma_foreign_key_list({})",
            quote_literal(table)
        ),
    )
    .await?;
    Ok(rows)
}

pub async fn load_foreign_keys(conn: &Connection) -> Result<Vec<ForeignKeyInfo>, AppError> {
    let mut out = Vec::new();
    for table in master_names(conn, "table").await? {
        for fk in fk_rows(conn, &table).await? {
            let from = fk.get(3).cloned().unwrap_or_default();
            let target_table = fk.get(2).cloned().unwrap_or_default();
            // A NULL "to" means the FK points at the target's primary key.
            let to = fk
                .get(4)
                .filter(|v| *v != "null")
                .cloned()
                .unwrap_or_else(|| "rowid".to_string());
            out.push((table.clone(), from, target_table, to));
        }
    }
    Ok(out)
}

pub async fn fk_details(
    conn: &Connection,
    table: &str,
    direction: &str,
) -> Result<Vec<FKDetail>, AppError> {
    let mut out = Vec::new();

    let mut push = |source: &str, fk: &[String]| {
        let target_table = fk.get(2).cloned().unwrap_or_default();
        let from = fk.get(3).cloned().unwrap_or_default();
        let to = fk
            .get(4)
            .filter(|v| *v != "null")
            .cloned()
            .unwrap_or_else(|| "rowid".to_string());
        let on_update = fk.get(5).cloned().unwrap_or_default();
        let on_delete = fk.get(6).cloned().unwrap_or_default();
        out.push((
            format!("{source}_{from}_fkey"),
            "main".to_string(),
            source.to_string(),
            from,
            "main".to_string(),
            target_table,
            to,
            on_update,
            on_delete,
        ));
    };

    if direction == "incoming" {
        // Nothing indexes the reverse direction, so every table has to be asked
        // whether it points here.
        for other in master_names(conn, "table").await? {
            for fk in fk_rows(conn, &other).await? {
                if fk.get(2).map(|t| t == table).unwrap_or(false) {
                    push(&other, &fk);
                }
            }
        }
    } else {
        for fk in fk_rows(conn, table).await? {
            push(table, &fk);
        }
    }

    Ok(out)
}

pub async fn load_triggers(conn: &Connection, table: &str) -> Result<Vec<TriggerDetail>, AppError> {
    // sqlite_master stores the trigger's DDL, not its timing and event as
    // fields, so read them back out of the statement text.
    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT name, COALESCE(sql, '') FROM sqlite_master
             WHERE type = 'trigger' AND tbl_name = {}
             ORDER BY name",
            quote_literal(table)
        ),
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let name = r.first().cloned().unwrap_or_default();
            let sql = r.get(1).cloned().unwrap_or_default().to_uppercase();
            let event = ["INSERT", "UPDATE", "DELETE"]
                .into_iter()
                .find(|e| sql.contains(e))
                .unwrap_or("")
                .to_string();
            let timing = ["BEFORE", "AFTER", "INSTEAD OF"]
                .into_iter()
                .find(|t| sql.contains(t))
                .unwrap_or("")
                .to_string();
            (name, event, timing)
        })
        .collect())
}

/// The DDL SQLite recorded when the object was created.
pub async fn object_ddl(conn: &Connection, name: &str) -> Result<String, AppError> {
    let (_, rows) = fetch_grid(
        conn,
        &format!(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE name = {}",
            quote_literal(name)
        ),
    )
    .await?;

    rows.into_iter()
        .next()
        .and_then(|mut r| {
            if r.is_empty() {
                None
            } else {
                Some(r.remove(0))
            }
        })
        .filter(|sql| !sql.is_empty())
        .ok_or_else(|| AppError::QueryFailed(format!("No DDL recorded for {name}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_closes_the_injection_route() {
        assert_eq!(quote_literal("users"), "'users'");
        // The single quote is doubled, so the argument cannot end early.
        assert_eq!(quote_literal("o'brien"), "'o''brien'");
        assert_eq!(
            quote_literal("x'); DROP TABLE users; --"),
            "'x''); DROP TABLE users; --'"
        );
    }

    #[test]
    fn values_render_for_the_grid() {
        assert_eq!(value_to_string(libsql::Value::Null), "null");
        assert_eq!(value_to_string(libsql::Value::Integer(42)), "42");
        assert_eq!(
            value_to_string(libsql::Value::Text("hi".into())),
            "hi".to_string()
        );
        assert_eq!(
            value_to_string(libsql::Value::Blob(vec![0, 1, 2])),
            "[3 bytes]"
        );
    }
}
