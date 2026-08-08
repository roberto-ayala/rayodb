use std::{collections::BTreeMap, sync::Arc};
use tauri::Manager;
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
use tokio::sync::Mutex;

use crate::{AppState, LOCAL_DB_NAME, terminal, utils};

/// Columns added to `projects` after the table's first shipped shape. Applied
/// one by one, ignoring "duplicate column" errors, so an install of any age
/// converges on the current schema.
pub const PROJECT_ADDED_COLUMNS: [&str; 8] = [
    "ssh_enabled",
    "ssh_host",
    "ssh_port",
    "ssh_user",
    "ssh_password",
    "ssh_key_path",
    "auto_connect",
    // Driver-specific settings as JSON: a SQLite file path, a MySQL socket,
    // anything the fixed columns cannot express.
    "options",
];

/// The `projects` table as first shipped. Later columns arrive by migration.
pub const PROJECTS_TABLE_DDL: &str = "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                driver TEXT NOT NULL DEFAULT 'PGSQL',
                username TEXT NOT NULL DEFAULT '',
                password TEXT NOT NULL DEFAULT '',
                database TEXT NOT NULL DEFAULT '',
                host TEXT NOT NULL DEFAULT '',
                port TEXT NOT NULL DEFAULT '',
                ssl TEXT NOT NULL DEFAULT 'false'
            )";

pub fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(desktop)]
    if let Some(pubkey) = option_env!("TAURI_UPDATER_PUBLIC_KEY") {
        app.handle()
            .plugin(tauri_plugin_updater::Builder::new().pubkey(pubkey).build())?;
    } else {
        tracing::info!(
            "Updater disabled because TAURI_UPDATER_PUBLIC_KEY was not set at build time"
        );
    }

    let app_handle = app.handle().clone();

    tauri::async_runtime::block_on(async move {
        let db_path = if cfg!(debug_assertions) {
            LOCAL_DB_NAME.to_string()
        } else {
            let app_dir = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            std::fs::create_dir_all(&app_dir).ok();
            app_dir.join(LOCAL_DB_NAME).to_string_lossy().to_string()
        };

        let db = libsql::Builder::new_local(&db_path)
            .build()
            .await
            .expect("Failed to open local database");

        let conn = db.connect().expect("Failed to create connection");
        conn.execute(PROJECTS_TABLE_DDL, ())
            .await
            .expect("Failed to create projects table");

        conn.execute(
            "CREATE TABLE IF NOT EXISTS queries (
                id TEXT PRIMARY KEY,
                sql TEXT NOT NULL DEFAULT ''
            )",
            (),
        )
        .await
        .expect("Failed to create queries table");

        conn.execute(
            "CREATE TABLE IF NOT EXISTS workspaces (
                name TEXT PRIMARY KEY,
                tabs TEXT NOT NULL DEFAULT '[]'
            )",
            (),
        )
        .await
        .expect("Failed to create workspaces table");

        conn.execute(
            "CREATE TABLE IF NOT EXISTS virtual_query_snapshots (
                query_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                sql TEXT NOT NULL,
                columns_packed TEXT NOT NULL DEFAULT '',
                total_rows INTEGER NOT NULL DEFAULT 0,
                page_size INTEGER NOT NULL DEFAULT 0,
                col_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )",
            (),
        )
        .await
        .expect("Failed to create virtual_query_snapshots table");

        conn.execute(
            "CREATE TABLE IF NOT EXISTS virtual_query_pages (
                query_id TEXT NOT NULL,
                page_index INTEGER NOT NULL,
                packed_page TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (query_id, page_index)
            )",
            (),
        )
        .await
        .expect("Failed to create virtual_query_pages table");

        // Best-effort orphan cleanup in case app exited before tab-close cleanup.
        conn.execute(
            "DELETE FROM virtual_query_pages
             WHERE query_id NOT IN (SELECT query_id FROM virtual_query_snapshots)",
            (),
        )
        .await
        .ok();

        for col in PROJECT_ADDED_COLUMNS {
            conn.execute(
                &format!(
                    "ALTER TABLE projects ADD COLUMN {} TEXT NOT NULL DEFAULT ''",
                    col
                ),
                (),
            )
            .await
            .ok(); // Ignore "column already exists" errors
        }

        let state = AppState {
            connections: Arc::new(Mutex::new(BTreeMap::new())),
            local_db: db,
            resource_monitor: Arc::new(Mutex::new(utils::ResourceMonitor::new())),
            virtual_cache: Arc::new(Mutex::new(BTreeMap::new())),
            notify_handles: Arc::new(Mutex::new(BTreeMap::new())),
            ssh_tunnels: Arc::new(Mutex::new(BTreeMap::new())),
        };
        app_handle.manage(state);

        let terminal_state = terminal::TerminalState {
            sessions: Arc::new(Mutex::new(std::collections::HashMap::new())),
        };
        app_handle.manage(terminal_state);
    });

    let handle = app.handle();

    let app_menu = SubmenuBuilder::new(handle, "RSQL")
        .about(Some(AboutMetadata {
            name: Some("RSQL".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            copyright: Some("\u{00a9} 2025 rust-dd".into()),
            comments: Some(
                "Modern SQL client for PostgreSQL.\nBuilt with Tauri, React, and Rust.".into(),
            ),
            website: Some("https://github.com/rust-dd/rust-sql".into()),
            website_label: Some("GitHub".into()),
            ..Default::default()
        }))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(handle, "View").fullscreen().build()?;

    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(handle)
        .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;

    handle.set_menu(menu)?;

    #[cfg(debug_assertions)]
    {
        let window = app
            .get_webview_window("main")
            .expect("main window not found");
        window.open_devtools();
        window.close_devtools();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Apply the migration the way `setup_app` does.
    async fn migrate(conn: &libsql::Connection) {
        for col in PROJECT_ADDED_COLUMNS {
            conn.execute(
                &format!("ALTER TABLE projects ADD COLUMN {col} TEXT NOT NULL DEFAULT ''"),
                (),
            )
            .await
            .ok();
        }
    }

    /// An install predating the `options` column must keep its rows and read
    /// back an empty value, not fail to open.
    #[tokio::test]
    async fn an_existing_database_gains_options_without_losing_rows() {
        let db = libsql::Builder::new_local(":memory:")
            .build()
            .await
            .unwrap();
        let conn = db.connect().unwrap();

        // The schema as it shipped before this phase.
        conn.execute(PROJECTS_TABLE_DDL, ()).await.unwrap();
        for col in ["ssh_enabled", "ssh_host", "auto_connect"] {
            conn.execute(
                &format!("ALTER TABLE projects ADD COLUMN {col} TEXT NOT NULL DEFAULT ''"),
                (),
            )
            .await
            .unwrap();
        }
        conn.execute(
            "INSERT INTO projects (id, driver, username, database, host, port)
             VALUES ('p1', 'PGSQL', 'alice', 'shop', 'db.internal', '5432')",
            (),
        )
        .await
        .unwrap();

        migrate(&conn).await;

        let mut rows = conn
            .query(
                "SELECT driver, username, host, options FROM projects WHERE id = 'p1'",
                (),
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().expect("row survived migration");
        assert_eq!(row.get::<String>(0).unwrap(), "PGSQL");
        assert_eq!(row.get::<String>(1).unwrap(), "alice");
        assert_eq!(row.get::<String>(2).unwrap(), "db.internal");
        assert_eq!(
            row.get::<String>(3).unwrap(),
            "",
            "options defaults to empty"
        );
    }

    /// Startup runs the migration every time; the second pass must be a no-op.
    #[tokio::test]
    async fn migrating_twice_is_harmless() {
        let db = libsql::Builder::new_local(":memory:")
            .build()
            .await
            .unwrap();
        let conn = db.connect().unwrap();
        conn.execute(PROJECTS_TABLE_DDL, ()).await.unwrap();

        migrate(&conn).await;
        conn.execute(
            "INSERT INTO projects (id, options) VALUES ('p1', '{\"path\":\"/tmp/a.db\"}')",
            (),
        )
        .await
        .unwrap();
        migrate(&conn).await;

        let mut rows = conn
            .query("SELECT options FROM projects WHERE id = 'p1'", ())
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "{\"path\":\"/tmp/a.db\"}");
    }
}
