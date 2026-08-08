//! The Tauri command surface, driver-agnostic.
//!
//! Every command resolves the project's `Arc<dyn Driver>` and dispatches. No
//! engine is named here — adding one is a new `DriverKind` arm in
//! `drivers::connection`, not new commands.

use std::sync::Arc;

use tauri::ipc::Response;
use tauri::{AppHandle, Manager, Result, State};

use crate::AppState;
use crate::common::enums::{AppError, ProjectConnectionStatus};
use crate::drivers::capabilities::Capabilities;
use crate::drivers::connection::{
    ConnectionParams, connect, load_project_params, project_driver_kind, test_connection,
};
use crate::drivers::kind::DriverKind;
use crate::drivers::pgsql::commands::snapshot_persistence::{
    restore_virtual_from_snapshot, snapshot_cleanup_query, snapshot_load_page, snapshot_store_page,
    snapshot_upsert_metadata,
};
use crate::drivers::pgsql::driver::{close_cached_query, fetch_cached_page};
use crate::drivers::pgsql::roles_schema_objects::{
    DbGrant, DefaultGrant, PgRole, RoleSpec, SchemaGrant, SchemaObject, TableGrant,
};
use crate::drivers::traits::Driver;
use crate::drivers::types::*;

use crate::drivers::cache::CELL_SEP;

/// The connected driver for a project, or `ClientNotConnected`.
async fn driver_for(
    app_state: &AppState,
    project_id: &str,
) -> std::result::Result<Arc<dyn Driver>, AppError> {
    app_state
        .connections
        .lock()
        .await
        .get(project_id)
        .cloned()
        .ok_or_else(|| AppError::ClientNotConnected(project_id.to_string()))
}

/// Serialize with sonic_rs and hand back a raw IPC response, skipping Tauri's
/// own serde pass for the payloads big enough to matter.
fn raw<T: serde::Serialize>(value: &T) -> Result<Response> {
    let json = sonic_rs::to_string(value).map_err(|e| AppError::QueryFailed(e.to_string()))?;
    Ok(Response::new(json))
}

// ---- connection --------------------------------------------------------

/// What an engine supports. Static per driver, so the UI can gate its tree and
/// tabs before any connection exists.
#[tauri::command(rename_all = "snake_case")]
pub async fn db_capabilities(driver: Option<&str>) -> Result<Capabilities> {
    Ok(DriverKind::parse(driver.unwrap_or_default())?.capabilities())
}

/// One selectable engine, with what the connection form needs to know to
/// render itself.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub default_port: &'static str,
    /// The database is a file on disk, so the form asks for a path instead of
    /// a host, port, user and password.
    pub file_based: bool,
    /// The database field may be left blank, and the server then lists what it
    /// has.
    pub database_optional: bool,
}

/// The engines that can actually be opened. An engine the app has a name for
/// but no driver behind is left out, so the picker never offers a dead end.
#[tauri::command(rename_all = "snake_case")]
pub async fn db_drivers() -> Result<Vec<DriverInfo>> {
    Ok(DriverKind::ALL
        .into_iter()
        .filter(|k| k.is_implemented())
        .map(|k| DriverInfo {
            id: k.as_str(),
            name: k.display_name(),
            default_port: k.default_port(),
            file_based: k.is_file_based(),
            database_optional: k.database_optional(),
        })
        .collect())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_test_connection(driver: Option<&str>, key: [&str; 6]) -> Result<String> {
    let kind = DriverKind::parse(driver.unwrap_or_default())?;
    test_connection(kind, &ConnectionParams::from_key(&key))
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_connect(
    project_id: &str,
    key: Option<[&str; 6]>,
    ssh: Option<Vec<String>>,
    app: AppHandle,
) -> Result<ProjectConnectionStatus> {
    let app_state = app.state::<AppState>();
    {
        let connections = app_state.connections.lock().await;
        if connections.contains_key(project_id) {
            return Ok(ProjectConnectionStatus::Connected);
        }
    }

    // An explicit key means "connect with what the modal has", which may not be
    // saved yet; without one the stored row is the source of truth.
    let (kind, mut params) = match key {
        Some(key) => (
            project_driver_kind(&app_state, project_id)
                .await
                .unwrap_or_default(),
            ConnectionParams::from_key(&key),
        ),
        None => load_project_params(&app_state, project_id).await?,
    };

    if let Some(ssh_params) = ssh {
        // ssh_params: [ssh_host, ssh_port, ssh_user, ssh_password, ssh_key_path]
        if ssh_params.len() >= 3 && !ssh_params[0].is_empty() {
            let ssh_password = ssh_params
                .get(3)
                .filter(|s| !s.is_empty())
                .map(|s| s.as_str());
            let ssh_key_path = ssh_params
                .get(4)
                .filter(|s| !s.is_empty())
                .map(|s| s.as_str());

            app_state.ssh_tunnels.lock().await.remove(project_id);

            let tunnel = crate::ssh::start_tunnel(
                &ssh_params[0],
                ssh_params[1].parse().unwrap_or(22),
                &ssh_params[2],
                ssh_password,
                ssh_key_path,
                &params.host,
                params.port.parse().unwrap_or(5432),
            )
            .await
            .map_err(AppError::ConnectionFailed)?;

            params.host = "127.0.0.1".to_string();
            params.port = tunnel.local_port.to_string();

            app_state
                .ssh_tunnels
                .lock()
                .await
                .insert(project_id.to_string(), tunnel);
        }
    }

    let driver = connect(kind, &params).await?;

    app_state
        .connections
        .lock()
        .await
        .insert(project_id.to_string(), driver);

    Ok(ProjectConnectionStatus::Connected)
}

/// Tear down every resource tied to a project: the connection itself, any
/// LISTEN task and the SSH tunnel that fronted the server.
#[tauri::command(rename_all = "snake_case")]
pub async fn db_disconnect(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<ProjectConnectionStatus> {
    if let Some(driver) = app_state.connections.lock().await.remove(project_id)
        && let Err(e) = driver.disconnect().await
    {
        tracing::warn!("Driver teardown for {} reported: {:?}", project_id, e);
    }

    {
        // LISTEN handles are keyed as "<project_id>:<channel>".
        let mut handles = app_state.notify_handles.lock().await;
        let prefix = format!("{}:", project_id);
        let keys: Vec<String> = handles
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for key in keys {
            if let Some(handle) = handles.remove(&key) {
                handle.abort();
            }
        }
    }

    if let Some(tunnel) = app_state.ssh_tunnels.lock().await.remove(project_id) {
        tunnel.stop();
    }

    Ok(ProjectConnectionStatus::Disconnected)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_cancel_query(project_id: &str, app_state: State<'_, AppState>) -> Result<bool> {
    driver_for(&app_state, project_id)
        .await?
        .cancel_query()
        .await
        .map_err(Into::into)
}

// ---- query execution ---------------------------------------------------

#[tauri::command(rename_all = "snake_case")]
pub async fn db_run_query(
    project_id: &str,
    sql: &str,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .run_query(sql)
        .await?;
    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_run_query_packed(
    project_id: &str,
    sql: &str,
    timeout_ms: Option<u32>,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .run_query_packed(sql, timeout_ms.unwrap_or(0))
        .await?;
    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_run_query_streamed(
    project_id: &str,
    sql: &str,
    stream_id: &str,
    app: AppHandle,
) -> Result<()> {
    let driver = {
        let app_state = app.state::<AppState>();
        driver_for(&app_state, project_id).await?
    };
    driver
        .run_query_streamed(sql, stream_id, &app)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_execute_virtual(
    project_id: &str,
    sql: &str,
    query_id: &str,
    page_size: usize,
    timeout_ms: Option<u32>,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .execute_virtual(
            &app_state.virtual_cache,
            sql,
            query_id,
            page_size,
            timeout_ms.unwrap_or(0),
        )
        .await?;

    let col_count = if result.0.is_empty() {
        0
    } else {
        result.0.split(CELL_SEP).count()
    };
    if let Err(e) = snapshot_upsert_metadata(
        &app_state, project_id, query_id, sql, &result.0, result.1, page_size, col_count,
    )
    .await
    {
        tracing::warn!(
            "Failed to persist virtual snapshot metadata for {}: {:?}",
            query_id,
            e
        );
    }
    if let Err(e) = snapshot_store_page(&app_state, query_id, 0, &result.2).await {
        tracing::warn!(
            "Failed to persist virtual snapshot first page for {}: {:?}",
            query_id,
            e
        );
    }

    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_fetch_page(
    query_id: &str,
    col_count: usize,
    offset: usize,
    limit: usize,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let page_index = if limit == 0 { 0 } else { offset / limit };

    match fetch_cached_page(&app_state.virtual_cache, query_id, col_count, offset, limit).await {
        Ok(packed) => {
            if let Err(e) = snapshot_store_page(&app_state, query_id, page_index, &packed).await {
                tracing::warn!("Failed to persist fetched page for {}: {:?}", query_id, e);
            }
            return raw(&packed);
        }
        Err(err) => {
            tracing::debug!(
                "Virtual cache miss for query {}, trying snapshot fallback: {:?}",
                query_id,
                err
            );
        }
    }

    if let Some(packed) = snapshot_load_page(&app_state, query_id, page_index).await? {
        return raw(&packed);
    }

    if restore_virtual_from_snapshot(&app_state, query_id).await? {
        let packed =
            fetch_cached_page(&app_state.virtual_cache, query_id, col_count, offset, limit).await?;
        if let Err(e) = snapshot_store_page(&app_state, query_id, page_index, &packed).await {
            tracing::warn!(
                "Failed to persist restored page for {} (page {}): {:?}",
                query_id,
                page_index,
                e
            );
        }
        return raw(&packed);
    }

    Err(AppError::QueryFailed(format!(
        "Virtual query {} not found in memory and no snapshot available",
        query_id
    ))
    .into())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_close_virtual(query_id: &str, app_state: State<'_, AppState>) -> Result<()> {
    close_cached_query(&app_state.virtual_cache, query_id).await?;
    if let Err(e) = snapshot_cleanup_query(&app_state, query_id).await {
        tracing::warn!(
            "Failed to cleanup virtual snapshot for {}: {:?}",
            query_id,
            e
        );
    }
    Ok(())
}

// ---- schema tree -------------------------------------------------------

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_databases(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>> {
    driver_for(&app_state, project_id)
        .await?
        .load_databases()
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_tablespaces(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<TablespaceInfo>> {
    driver_for(&app_state, project_id)
        .await?
        .load_tablespaces()
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_schemas(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<SchemaList> {
    driver_for(&app_state, project_id)
        .await?
        .load_schemas()
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_tables(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<TableList> {
    driver_for(&app_state, project_id)
        .await?
        .load_tables(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_columns(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<ColumnList> {
    driver_for(&app_state, project_id)
        .await?
        .load_columns(schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_column_details(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<ColumnDetail>> {
    driver_for(&app_state, project_id)
        .await?
        .load_column_details(schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_indexes(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<IndexDetail>> {
    driver_for(&app_state, project_id)
        .await?
        .load_indexes(schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_constraints(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<ConstraintDetail>> {
    driver_for(&app_state, project_id)
        .await?
        .load_constraints(schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_triggers(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<TriggerDetail>> {
    driver_for(&app_state, project_id)
        .await?
        .load_triggers(schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_rules(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<RuleDetail>> {
    driver_for(&app_state, project_id)
        .await?
        .load_rules(schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_policies(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<PolicyDetail>> {
    driver_for(&app_state, project_id)
        .await?
        .load_policies(schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_views(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>> {
    driver_for(&app_state, project_id)
        .await?
        .load_views(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_materialized_views(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>> {
    driver_for(&app_state, project_id)
        .await?
        .load_materialized_views(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_sequences(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<SequenceInfo>> {
    driver_for(&app_state, project_id)
        .await?
        .load_sequences(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_functions(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<FunctionInfo>> {
    driver_for(&app_state, project_id)
        .await?
        .load_functions(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_procedures(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<ProcedureInfo>> {
    driver_for(&app_state, project_id)
        .await?
        .load_procedures(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_trigger_functions(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<TriggerFunctionInfo>> {
    driver_for(&app_state, project_id)
        .await?
        .load_trigger_functions(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_foreign_tables(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<ForeignTableInfo>> {
    driver_for(&app_state, project_id)
        .await?
        .load_foreign_tables(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_data_types(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<DataTypeInfo>> {
    driver_for(&app_state, project_id)
        .await?
        .load_data_types(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_event_triggers(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<EventTriggerInfo>> {
    driver_for(&app_state, project_id)
        .await?
        .load_event_triggers()
        .await
        .map_err(Into::into)
}

// ---- object inspection -------------------------------------------------

#[tauri::command(rename_all = "snake_case")]
pub async fn db_table_statistics(
    project_id: &str,
    schema: &str,
    table: &str,
    app_state: State<'_, AppState>,
) -> Result<ObjectStats> {
    driver_for(&app_state, project_id)
        .await?
        .table_statistics(schema, table)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_fk_details(
    project_id: &str,
    schema: &str,
    table: &str,
    direction: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<FKDetail>> {
    driver_for(&app_state, project_id)
        .await?
        .fk_details(schema, table, direction)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_view_info(
    project_id: &str,
    schema: &str,
    view: &str,
    app_state: State<'_, AppState>,
) -> Result<ObjectStats> {
    driver_for(&app_state, project_id)
        .await?
        .view_info(schema, view)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_matview_info(
    project_id: &str,
    schema: &str,
    matview: &str,
    app_state: State<'_, AppState>,
) -> Result<ObjectStats> {
    driver_for(&app_state, project_id)
        .await?
        .matview_info(schema, matview)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_function_info(
    project_id: &str,
    schema: &str,
    func_name: &str,
    app_state: State<'_, AppState>,
) -> Result<ObjectStats> {
    driver_for(&app_state, project_id)
        .await?
        .function_info(schema, func_name)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_generate_ddl(
    project_id: &str,
    schema: &str,
    name: &str,
    object_type: &str,
    app_state: State<'_, AppState>,
) -> Result<String> {
    driver_for(&app_state, project_id)
        .await?
        .generate_ddl(schema, name, object_type)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_table_action(
    project_id: &str,
    action: &str,
    schema: &str,
    table: &str,
    object_type: &str,
    app_state: State<'_, AppState>,
) -> Result<String> {
    driver_for(&app_state, project_id)
        .await?
        .table_action(action, schema, table, object_type)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_extract_schema_objects(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<SchemaObject>> {
    driver_for(&app_state, project_id)
        .await?
        .extract_schema_objects(schema)
        .await
        .map_err(Into::into)
}

// ---- monitoring --------------------------------------------------------

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_activity(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .load_activity()
        .await?;
    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_database_stats(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<DbStat>> {
    driver_for(&app_state, project_id)
        .await?
        .load_database_stats()
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_table_stats(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .load_table_stats()
        .await?;
    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_foreign_keys(
    project_id: &str,
    schema: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<ForeignKeyInfo>> {
    driver_for(&app_state, project_id)
        .await?
        .load_foreign_keys(schema)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_locks(project_id: &str, app_state: State<'_, AppState>) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .load_locks()
        .await?;
    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_index_usage(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .load_index_usage()
        .await?;
    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_table_bloat(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .load_table_bloat()
        .await?;
    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_server_settings(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .load_server_settings()
        .await?;
    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_extensions(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .load_extensions()
        .await?;
    raw(&result)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_available_extensions(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Response> {
    let result = driver_for(&app_state, project_id)
        .await?
        .load_available_extensions()
        .await?;
    raw(&result)
}

// ---- pub/sub -----------------------------------------------------------

#[tauri::command(rename_all = "snake_case")]
pub async fn db_listen_start(project_id: &str, channel: &str, app: AppHandle) -> Result<bool> {
    let driver = {
        let app_state = app.state::<AppState>();
        driver_for(&app_state, project_id).await?
    };
    driver
        .listen_start(channel, project_id, &app)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_listen_stop(project_id: &str, channel: &str, app: AppHandle) -> Result<bool> {
    let driver = {
        let app_state = app.state::<AppState>();
        driver_for(&app_state, project_id).await?
    };
    driver
        .listen_stop(channel, project_id, &app)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_notify_send(
    project_id: &str,
    channel: &str,
    payload: &str,
    app_state: State<'_, AppState>,
) -> Result<bool> {
    driver_for(&app_state, project_id)
        .await?
        .notify_send(channel, payload)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_discover_channels(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>> {
    driver_for(&app_state, project_id)
        .await?
        .discover_channels()
        .await
        .map_err(Into::into)
}

// ---- roles and grants --------------------------------------------------

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_roles(
    project_id: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<PgRole>> {
    driver_for(&app_state, project_id)
        .await?
        .load_roles()
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_table_grants(
    project_id: &str,
    role_name: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<TableGrant>> {
    driver_for(&app_state, project_id)
        .await?
        .load_table_grants(role_name)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_database_grants(
    project_id: &str,
    role_name: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<DbGrant>> {
    driver_for(&app_state, project_id)
        .await?
        .load_database_grants(role_name)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_schema_table_grants(
    project_id: &str,
    role_name: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<SchemaGrant>> {
    driver_for(&app_state, project_id)
        .await?
        .load_schema_table_grants(role_name)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_load_default_table_grants(
    project_id: &str,
    role_name: &str,
    app_state: State<'_, AppState>,
) -> Result<Vec<DefaultGrant>> {
    driver_for(&app_state, project_id)
        .await?
        .load_default_table_grants(role_name)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_create_role(
    project_id: &str,
    spec: RoleSpec,
    app_state: State<'_, AppState>,
) -> Result<String> {
    driver_for(&app_state, project_id)
        .await?
        .create_role(&spec)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_alter_role(
    project_id: &str,
    spec: RoleSpec,
    app_state: State<'_, AppState>,
) -> Result<String> {
    driver_for(&app_state, project_id)
        .await?
        .alter_role(&spec)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_drop_role(
    project_id: &str,
    name: &str,
    app_state: State<'_, AppState>,
) -> Result<String> {
    driver_for(&app_state, project_id)
        .await?
        .drop_role(name)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_set_database_privilege(
    project_id: &str,
    database: &str,
    role_name: &str,
    privilege: &str,
    granted: bool,
    app_state: State<'_, AppState>,
) -> Result<String> {
    driver_for(&app_state, project_id)
        .await?
        .set_database_privilege(database, role_name, privilege, granted)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_set_schema_table_privilege(
    project_id: &str,
    schema: &str,
    role_name: &str,
    privilege: &str,
    granted: bool,
    app_state: State<'_, AppState>,
) -> Result<String> {
    driver_for(&app_state, project_id)
        .await?
        .set_schema_table_privilege(schema, role_name, privilege, granted)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_set_default_table_privilege(
    project_id: &str,
    schema: &str,
    role_name: &str,
    privilege: &str,
    granted: bool,
    app_state: State<'_, AppState>,
) -> Result<String> {
    driver_for(&app_state, project_id)
        .await?
        .set_default_table_privilege(schema, role_name, privilege, granted)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_revoke_table_privileges(
    project_id: &str,
    schema: &str,
    table: &str,
    role_name: &str,
    app_state: State<'_, AppState>,
) -> Result<String> {
    driver_for(&app_state, project_id)
        .await?
        .revoke_table_privileges(schema, table, role_name)
        .await
        .map_err(Into::into)
}

// ---- bulk load ---------------------------------------------------------

#[tauri::command(rename_all = "snake_case")]
pub async fn db_csv_preview(file_path: &str) -> Result<(Vec<String>, Vec<Vec<String>>)> {
    crate::drivers::pgsql::parse_csv_preview(file_path, 5)
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn db_csv_import(
    project_id: &str,
    file_path: &str,
    schema: &str,
    table: &str,
    column_mapping: Vec<(usize, String)>,
    app_state: State<'_, AppState>,
) -> Result<usize> {
    driver_for(&app_state, project_id)
        .await?
        .csv_import(file_path, schema, table, column_mapping)
        .await
        .map_err(Into::into)
}
