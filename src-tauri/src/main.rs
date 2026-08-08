// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_setup;
mod common;
mod dbs;
mod drivers;
mod ssh;
mod terminal;
mod utils;

const LOCAL_DB_NAME: &str = "rsql.db";

use std::{collections::BTreeMap, sync::Arc};
use tokio::sync::Mutex;
use tracing::Level;

use drivers::Driver;

pub struct AppState {
    /// One live driver per connected project. The only handle on a database,
    /// and deliberately engine-agnostic: nothing outside `drivers` names an
    /// engine.
    pub connections: Arc<Mutex<BTreeMap<String, Arc<dyn Driver>>>>,
    pub local_db: libsql::Database,
    pub resource_monitor: Arc<Mutex<utils::ResourceMonitor>>,
    pub virtual_cache: Arc<Mutex<drivers::cache::VirtualCache>>,
    pub notify_handles: Arc<Mutex<BTreeMap<String, tokio::task::JoinHandle<()>>>>,
    pub ssh_tunnels: Arc<Mutex<BTreeMap<String, ssh::SshTunnel>>>,
}

fn main() {
    tracing_subscriber::fmt()
        .with_file(true)
        .with_line_number(true)
        .with_level(true)
        .with_max_level(Level::INFO)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(app_setup::setup_app)
        .invoke_handler(tauri::generate_handler![
            dbs::project::project_db_select,
            dbs::project::project_db_insert,
            dbs::project::project_db_delete,
            dbs::query::query_db_select,
            dbs::query::query_db_insert,
            dbs::query::query_db_delete,
            dbs::workspace::workspace_save,
            dbs::workspace::workspace_load_all,
            dbs::workspace::workspace_delete,
            drivers::commands::db_capabilities,
            drivers::commands::db_test_connection,
            drivers::commands::db_connect,
            drivers::commands::db_disconnect,
            drivers::commands::db_cancel_query,
            drivers::commands::db_run_query,
            drivers::commands::db_run_query_packed,
            drivers::commands::db_run_query_streamed,
            drivers::commands::db_execute_virtual,
            drivers::commands::db_fetch_page,
            drivers::commands::db_close_virtual,
            drivers::commands::db_load_databases,
            drivers::commands::db_load_tablespaces,
            drivers::commands::db_load_schemas,
            drivers::commands::db_load_tables,
            drivers::commands::db_load_columns,
            drivers::commands::db_load_column_details,
            drivers::commands::db_load_indexes,
            drivers::commands::db_load_constraints,
            drivers::commands::db_load_triggers,
            drivers::commands::db_load_rules,
            drivers::commands::db_load_policies,
            drivers::commands::db_load_views,
            drivers::commands::db_load_materialized_views,
            drivers::commands::db_load_sequences,
            drivers::commands::db_load_functions,
            drivers::commands::db_load_procedures,
            drivers::commands::db_load_trigger_functions,
            drivers::commands::db_load_foreign_tables,
            drivers::commands::db_load_data_types,
            drivers::commands::db_load_event_triggers,
            drivers::commands::db_table_statistics,
            drivers::commands::db_fk_details,
            drivers::commands::db_view_info,
            drivers::commands::db_matview_info,
            drivers::commands::db_function_info,
            drivers::commands::db_generate_ddl,
            drivers::commands::db_table_action,
            drivers::commands::db_extract_schema_objects,
            drivers::commands::db_load_activity,
            drivers::commands::db_load_database_stats,
            drivers::commands::db_load_table_stats,
            drivers::commands::db_load_foreign_keys,
            drivers::commands::db_load_locks,
            drivers::commands::db_load_index_usage,
            drivers::commands::db_load_table_bloat,
            drivers::commands::db_load_server_settings,
            drivers::commands::db_load_extensions,
            drivers::commands::db_load_available_extensions,
            drivers::commands::db_listen_start,
            drivers::commands::db_listen_stop,
            drivers::commands::db_notify_send,
            drivers::commands::db_discover_channels,
            drivers::commands::db_load_roles,
            drivers::commands::db_load_table_grants,
            drivers::commands::db_load_database_grants,
            drivers::commands::db_load_schema_table_grants,
            drivers::commands::db_load_default_table_grants,
            drivers::commands::db_create_role,
            drivers::commands::db_alter_role,
            drivers::commands::db_drop_role,
            drivers::commands::db_set_database_privilege,
            drivers::commands::db_set_schema_table_privilege,
            drivers::commands::db_set_default_table_privilege,
            drivers::commands::db_revoke_table_privileges,
            drivers::commands::db_csv_preview,
            drivers::commands::db_csv_import,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            utils::compute_diff,
            utils::save_text_file,
            utils::system_resource_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
