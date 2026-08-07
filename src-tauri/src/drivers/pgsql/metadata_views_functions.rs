use tokio_postgres::Client;

use crate::common::enums::{AppError, pg_error_message};

use super::{
    DataTypeInfo, ForeignTableInfo, FunctionInfo, ObjectStats, ProcedureInfo, SequenceInfo,
};

pub async fn load_views(client: &Client, schema: &str) -> Result<Vec<String>, AppError> {
    let rows = client
        .query(
            r#"SELECT table_name
               FROM information_schema.views
               WHERE table_schema = $1
               ORDER BY table_name"#,
            &[&schema],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
}

pub async fn load_materialized_views(
    client: &Client,
    schema: &str,
) -> Result<Vec<String>, AppError> {
    let rows = client
        .query(
            r#"SELECT matviewname
               FROM pg_matviews
               WHERE schemaname = $1
               ORDER BY matviewname"#,
            &[&schema],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
}

pub async fn load_sequences(client: &Client, schema: &str) -> Result<Vec<SequenceInfo>, AppError> {
    let rows = client
        .query(
            // last_value is null until the sequence is first read — and also when
            // the role lacks SELECT on it, which reads the same either way.
            r#"SELECT sequencename::text,
                      COALESCE(last_value::text, '-')
               FROM pg_sequences
               WHERE schemaname = $1
               ORDER BY sequencename"#,
            &[&schema],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows.iter().map(|r| (r.get(0), r.get(1))).collect())
}

pub async fn load_functions(client: &Client, schema: &str) -> Result<Vec<FunctionInfo>, AppError> {
    let rows = client
        .query(
            r#"SELECT p.proname,
                      pg_get_function_result(p.oid),
                      pg_get_function_arguments(p.oid)
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = $1
                 AND p.prokind = 'f'
                 AND pg_get_function_result(p.oid) != 'trigger'
               ORDER BY p.proname"#,
            &[&schema],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows
        .iter()
        .map(|r| {
            let name: String = r.get(0);
            let ret: String = r.get(1);
            let args: String = r.get(2);
            (name, ret, args)
        })
        .collect())
}

/// Foreign tables live outside the database, so they carry the server that
/// backs them rather than a size.
pub async fn load_foreign_tables(
    client: &Client,
    schema: &str,
) -> Result<Vec<ForeignTableInfo>, AppError> {
    let rows = client
        .query(
            r#"SELECT c.relname::text,
                      COALESCE(s.srvname::text, '')
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               LEFT JOIN pg_foreign_table ft ON ft.ftrelid = c.oid
               LEFT JOIN pg_foreign_server s ON s.oid = ft.ftserver
               WHERE n.nspname = $1
                 AND c.relkind = 'f'
               ORDER BY c.relname"#,
            &[&schema],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows.iter().map(|r| (r.get(0), r.get(1))).collect())
}

/// User-defined types of a schema: enums, domains, composites and ranges, each
/// with the detail that identifies it (labels, base type, attributes, subtype).
pub async fn load_data_types(client: &Client, schema: &str) -> Result<Vec<DataTypeInfo>, AppError> {
    let rows = client
        .query(
            // Tables, views and sequences each own a composite type describing
            // their row; only relkind 'c' is a type the user actually declared.
            r#"SELECT t.typname::text,
                      CASE t.typtype
                        WHEN 'e' THEN 'enum'
                        WHEN 'd' THEN 'domain'
                        WHEN 'c' THEN 'composite'
                        ELSE 'range'
                      END,
                      COALESCE(
                        CASE t.typtype
                          WHEN 'e' THEN (SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
                                         FROM pg_enum e WHERE e.enumtypid = t.oid)
                          WHEN 'd' THEN format_type(t.typbasetype, t.typtypmod)
                          WHEN 'c' THEN (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
                                         FROM pg_attribute a
                                         WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped)
                          ELSE (SELECT format_type(r.rngsubtype, NULL) FROM pg_range r WHERE r.rngtypid = t.oid)
                        END, '')
               FROM pg_type t
               JOIN pg_namespace n ON n.oid = t.typnamespace
               WHERE n.nspname = $1
                 AND t.typtype IN ('e', 'd', 'c', 'r')
                 AND (t.typtype <> 'c'
                      OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'))
               ORDER BY t.typname"#,
            &[&schema],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows
        .iter()
        .map(|r| (r.get(0), r.get(1), r.get(2)))
        .collect())
}

/// Procedures are invoked with CALL and have no return type, so they get their
/// own listing instead of sharing the functions one.
pub async fn load_procedures(
    client: &Client,
    schema: &str,
) -> Result<Vec<ProcedureInfo>, AppError> {
    let rows = client
        .query(
            r#"SELECT p.proname,
                      pg_get_function_arguments(p.oid)
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = $1
                 AND p.prokind = 'p'
               ORDER BY p.proname"#,
            &[&schema],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows.iter().map(|r| (r.get(0), r.get(1))).collect())
}

pub async fn load_trigger_functions(
    client: &Client,
    schema: &str,
) -> Result<Vec<(String, String)>, AppError> {
    let rows = client
        .query(
            r#"SELECT p.proname,
                      pg_get_function_arguments(p.oid)
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = $1
                 AND pg_get_function_result(p.oid) = 'trigger'
               ORDER BY p.proname"#,
            &[&schema],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows
        .iter()
        .map(|r| {
            let name: String = r.get(0);
            let args: String = r.get(1);
            (name, args)
        })
        .collect())
}

pub async fn load_view_info(
    client: &Client,
    schema: &str,
    view: &str,
) -> Result<ObjectStats, AppError> {
    let rows = client
        .query(
            r#"SELECT
                 COALESCE(v.is_updatable, 'NO'),
                 COALESCE(v.check_option, 'NONE'),
                 pg_get_viewdef(c.oid, true)
               FROM information_schema.views v
               JOIN pg_class c ON c.relname = v.table_name
               JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = v.table_schema
               WHERE v.table_schema = $1 AND v.table_name = $2
               LIMIT 1"#,
            &[&schema, &view],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    if let Some(row) = rows.first() {
        Ok(vec![
            ("is_updatable".into(), row.get::<_, String>(0)),
            ("check_option".into(), row.get::<_, String>(1)),
            ("definition".into(), row.get::<_, String>(2)),
        ])
    } else {
        Ok(Vec::new())
    }
}

pub async fn load_matview_info(
    client: &Client,
    schema: &str,
    matview: &str,
) -> Result<ObjectStats, AppError> {
    let sql = r#"SELECT
         c.reltuples::bigint::text,
         pg_size_pretty(pg_total_relation_size(c.oid)),
         CASE WHEN m.ispopulated THEN 'YES' ELSE 'NO' END,
         m.definition
       FROM pg_matviews m
       JOIN pg_class c ON c.relname = m.matviewname
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = m.schemaname
       WHERE m.schemaname = $1 AND m.matviewname = $2
       LIMIT 1"#;

    let rows = client
        .query(sql, &[&schema, &matview])
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    if let Some(row) = rows.first() {
        Ok(vec![
            ("row_estimate".into(), row.get::<_, String>(0)),
            ("total_size".into(), row.get::<_, String>(1)),
            ("is_populated".into(), row.get::<_, String>(2)),
            ("definition".into(), row.get::<_, String>(3)),
        ])
    } else {
        Ok(Vec::new())
    }
}

pub async fn load_function_info(
    client: &Client,
    schema: &str,
    func_name: &str,
) -> Result<ObjectStats, AppError> {
    let rows = client
        .query(
            r#"SELECT
                 l.lanname,
                 CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' WHEN 'v' THEN 'VOLATILE' ELSE '' END,
                 p.proisstrict::text,
                 p.prosecdef::text,
                 p.procost::text,
                 p.prorows::text,
                 pg_get_function_result(p.oid),
                 pg_get_function_arguments(p.oid),
                 p.prosrc
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               JOIN pg_language l ON l.oid = p.prolang
               WHERE n.nspname = $1 AND p.proname = $2
               LIMIT 1"#,
            &[&schema, &func_name],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    let keys = [
        "language",
        "volatility",
        "is_strict",
        "security_definer",
        "estimated_cost",
        "estimated_rows",
        "return_type",
        "arguments",
        "source",
    ];

    if let Some(row) = rows.first() {
        Ok(keys
            .iter()
            .enumerate()
            .map(|(i, k)| {
                let val: Option<String> = row.try_get(i).ok();
                (k.to_string(), val.unwrap_or_default())
            })
            .collect())
    } else {
        Ok(Vec::new())
    }
}
