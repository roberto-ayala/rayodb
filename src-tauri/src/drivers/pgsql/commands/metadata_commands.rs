use crate::AppState;
use crate::common::pgsql::{PgsqlLoadColumns, PgsqlLoadSchemas, PgsqlLoadTables};
use crate::drivers::pgsql::{
    ColumnDetail, ConstraintDetail, DataTypeInfo, EventTriggerInfo, ForeignTableInfo, FunctionInfo,
    IndexDetail, PolicyDetail, ProcedureInfo, RuleDetail, SequenceInfo, TriggerDetail,
    TriggerFunctionInfo, get_pool, load_column_details, load_columns, load_constraints,
    load_data_types, load_databases, load_event_triggers, load_foreign_tables, load_functions,
    load_indexes, load_materialized_views, load_policies, load_procedures, load_rules,
    load_schemas, load_sequences, load_tables, load_tablespaces, load_trigger_functions,
    load_triggers, load_views,
};

use tauri::{AppHandle, Manager, Result, State};

use super::pool_connection::acquire_client;

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_databases(project_id: &str, app: AppHandle) -> Result<Vec<String>> {
    let app_state = app.state::<AppState>();
    let pool = {
        let pools = app_state.meta_clients.lock().await;
        get_pool(&pools, project_id)?
    };

    load_databases(&pool).await.map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_tablespaces(
    project_id: &str,
    app: AppHandle,
) -> Result<Vec<(String, String, String, String)>> {
    let app_state = app.state::<AppState>();
    let pool = {
        let pools = app_state.meta_clients.lock().await;
        get_pool(&pools, project_id)?
    };

    load_tablespaces(&pool).await.map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_schemas(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<PgsqlLoadSchemas> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_schemas(
        &client,
        r#"SELECT schema_name FROM information_schema.schemata
           WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
           ORDER BY schema_name"#,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_tables(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<PgsqlLoadTables> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_tables(
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
                  END AS parent
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1
             AND c.relkind IN ('r', 'p')
           ORDER BY c.relname"#,
        schema,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_columns(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<PgsqlLoadColumns> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_columns(&client, schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_column_details(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<ColumnDetail>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_column_details(&client, schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_indexes(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<IndexDetail>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_indexes(&client, schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_constraints(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<ConstraintDetail>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_constraints(&client, schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_triggers(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<TriggerDetail>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_triggers(&client, schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_rules(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<RuleDetail>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_rules(&client, schema, table).await.map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_policies(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<PolicyDetail>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_policies(&client, schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_views(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_views(&client, schema).await.map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_materialized_views(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_materialized_views(&client, schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_sequences(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<SequenceInfo>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_sequences(&client, schema).await.map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_functions(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<FunctionInfo>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_functions(&client, schema).await.map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_foreign_tables(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<ForeignTableInfo>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_foreign_tables(&client, schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_event_triggers(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<EventTriggerInfo>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_event_triggers(&client).await.map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_data_types(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<DataTypeInfo>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_data_types(&client, schema).await.map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_procedures(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<ProcedureInfo>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_procedures(&client, schema).await.map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pgsql_load_trigger_functions(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<TriggerFunctionInfo>> {
    let client = acquire_client(&app_state.meta_clients, project_id).await?;

    load_trigger_functions(&client, schema)
        .await
        .map_err(Into::into)
}
