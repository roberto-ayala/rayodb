//! Integration tests for the SQLite driver.
//!
//! Unlike the PostgreSQL suite these need no server and no opt-in: each test
//! builds its own database in a temp file and deletes it afterwards, so they
//! run on every `cargo test`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use tokio::sync::Mutex;

use crate::drivers::cache::{CELL_SEP, ROW_SEP, VirtualCache};
use crate::drivers::connection::ConnectionParams;
use crate::drivers::kind::DriverKind;
use crate::drivers::traits::Driver;

use super::{SqliteDriver, connect, test_connection};

/// A database file that removes itself when the test ends.
struct TempDb(PathBuf);

impl Drop for TempDb {
    fn drop(&mut self) {
        std::fs::remove_file(&self.0).ok();
    }
}

impl TempDb {
    fn path(&self) -> String {
        self.0.to_string_lossy().to_string()
    }

    fn params(&self) -> ConnectionParams {
        let mut options = BTreeMap::new();
        options.insert("path".to_string(), self.path());
        ConnectionParams {
            options,
            ..Default::default()
        }
    }
}

/// Build a database with the same shape the PostgreSQL fixture uses, so the
/// two drivers are exercised against comparable structure.
async fn fixture(name: &str) -> (TempDb, SqliteDriver) {
    let path = std::env::temp_dir().join(format!("rayodb-test-{name}.db"));
    std::fs::remove_file(&path).ok();
    let temp = TempDb(path.clone());

    let db = libsql::Builder::new_local(path.to_string_lossy().as_ref())
        .build()
        .await
        .unwrap();
    let conn = db.connect().unwrap();

    for stmt in [
        "CREATE TABLE customers (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        "CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
            total REAL NOT NULL
        )",
        "CREATE INDEX orders_customer_idx ON orders (customer_id)",
        "CREATE VIEW customer_orders AS
            SELECT c.id, c.email, count(o.id) AS order_count
            FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
            GROUP BY c.id, c.email",
        "CREATE TRIGGER customers_touch AFTER UPDATE ON customers
            BEGIN SELECT 1; END",
    ] {
        conn.execute(stmt, ()).await.unwrap();
    }

    for i in 1..=50 {
        conn.execute(
            "INSERT INTO customers (id, email, name) VALUES (?1, ?2, ?3)",
            libsql::params![i, format!("user{i}@example.com"), format!("User {i}")],
        )
        .await
        .unwrap();
    }
    for i in 1..=200 {
        conn.execute(
            "INSERT INTO orders (id, customer_id, total) VALUES (?1, ?2, ?3)",
            libsql::params![i, (i % 50) + 1, i as f64 + 0.5],
        )
        .await
        .unwrap();
    }

    let driver = connect(&temp.params()).await.expect("connect");
    (temp, driver)
}

#[tokio::test]
async fn connecting_reports_the_engine_version() {
    let (temp, _driver) = fixture("version").await;
    let banner = test_connection(&temp.params()).await.expect("version");
    assert!(banner.starts_with("SQLite "), "{banner}");
}

/// Opening a path that is not there would otherwise create an empty database,
/// which is never what someone opening a client meant.
#[tokio::test]
async fn a_missing_file_is_an_error_not_a_new_database() {
    let path = std::env::temp_dir().join("rayodb-does-not-exist.db");
    std::fs::remove_file(&path).ok();

    let mut options = BTreeMap::new();
    options.insert("path".to_string(), path.to_string_lossy().to_string());
    let params = ConnectionParams {
        options,
        ..Default::default()
    };

    let err = match connect(&params).await {
        Err(e) => e,
        Ok(_) => panic!("should have refused a missing file"),
    };
    assert!(err.to_string().contains("No such database file"), "{err}");
    assert!(!path.exists(), "must not have created the file");
}

#[tokio::test]
async fn an_empty_path_is_rejected() {
    let err = match connect(&ConnectionParams::default()).await {
        Err(e) => e,
        Ok(_) => panic!("should have refused an empty path"),
    };
    assert!(err.to_string().contains("No database file"), "{err}");
}

#[tokio::test]
async fn the_schema_tree_loads() {
    let (_temp, driver) = fixture("tree").await;

    assert_eq!(driver.kind(), DriverKind::Sqlite);

    // One implicit schema, named so the sidebar keeps its shape.
    assert_eq!(
        driver.load_schemas().await.unwrap(),
        vec!["main".to_string()]
    );

    let tables = driver.load_tables("main").await.unwrap();
    let names: Vec<&str> = tables.iter().map(|t| t.0.as_str()).collect();
    assert!(names.contains(&"customers"), "{names:?}");
    assert!(names.contains(&"orders"), "{names:?}");
    // SQLite's own bookkeeping tables are not the user's business.
    assert!(!names.iter().any(|n| n.starts_with("sqlite_")), "{names:?}");

    let views = driver.load_views("main").await.unwrap();
    assert_eq!(views, vec!["customer_orders".to_string()]);

    let columns = driver.load_columns("main", "customers").await.unwrap();
    assert_eq!(columns, vec!["id", "email", "name", "created_at"]);

    let details = driver
        .load_column_details("main", "customers")
        .await
        .unwrap();
    let email = details.iter().find(|c| c.0 == "email").unwrap();
    assert_eq!(email.1, "TEXT");
    assert!(!email.2, "email is NOT NULL");
    let created = details.iter().find(|c| c.0 == "created_at").unwrap();
    assert!(created.3.is_some(), "created_at has a default");
    let name = details.iter().find(|c| c.0 == "name").unwrap();
    assert!(name.2, "name is nullable");
    assert!(name.3.is_none(), "name has no default");
}

#[tokio::test]
async fn indexes_and_constraints_come_back() {
    let (_temp, driver) = fixture("indexes").await;

    let indexes = driver.load_indexes("main", "orders").await.unwrap();
    assert!(
        indexes
            .iter()
            .any(|i| i.0 == "orders_customer_idx" && i.1 == "customer_id"),
        "{indexes:?}"
    );

    // The UNIQUE on customers.email is stored as a unique index.
    let customer_indexes = driver.load_indexes("main", "customers").await.unwrap();
    assert!(
        customer_indexes.iter().any(|i| i.2 && i.1 == "email"),
        "{customer_indexes:?}"
    );

    let constraints = driver.load_constraints("main", "orders").await.unwrap();
    assert!(
        constraints
            .iter()
            .any(|c| c.1 == "PRIMARY KEY" && c.2 == "id"),
        "{constraints:?}"
    );
    assert!(
        constraints
            .iter()
            .any(|c| c.1 == "FOREIGN KEY" && c.2 == "customer_id"),
        "{constraints:?}"
    );
}

#[tokio::test]
async fn foreign_keys_resolve_in_both_directions() {
    let (_temp, driver) = fixture("fks").await;

    let fks = driver.load_foreign_keys("main").await.unwrap();
    assert!(
        fks.iter()
            .any(|f| f.0 == "orders" && f.1 == "customer_id" && f.2 == "customers"),
        "{fks:?}"
    );

    let outgoing = driver
        .fk_details("main", "orders", "outgoing")
        .await
        .unwrap();
    assert_eq!(outgoing.len(), 1, "{outgoing:?}");
    assert_eq!(outgoing[0].5, "customers", "target table");
    assert_eq!(outgoing[0].8, "CASCADE", "on delete");

    // Nothing indexes the reverse direction, so this is the interesting case.
    let incoming = driver
        .fk_details("main", "customers", "incoming")
        .await
        .unwrap();
    assert_eq!(incoming.len(), 1, "{incoming:?}");
    assert_eq!(incoming[0].2, "orders", "source table");
}

#[tokio::test]
async fn triggers_report_their_timing_and_event() {
    let (_temp, driver) = fixture("triggers").await;

    let triggers = driver.load_triggers("main", "customers").await.unwrap();
    let trigger = triggers
        .iter()
        .find(|t| t.0 == "customers_touch")
        .unwrap_or_else(|| panic!("{triggers:?}"));
    assert_eq!(trigger.1, "UPDATE", "event");
    assert_eq!(trigger.2, "AFTER", "timing");
}

#[tokio::test]
async fn queries_run_plain_and_packed() {
    let (_temp, driver) = fixture("queries").await;

    let (columns, rows, _) = driver
        .run_query("SELECT id, email FROM customers ORDER BY id LIMIT 3")
        .await
        .unwrap();
    assert_eq!(columns, vec!["id", "email"]);
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0][0], "1");
    assert_eq!(rows[0][1], "user1@example.com");

    let (packed, _) = driver
        .run_query_packed("SELECT count(*) AS n FROM orders", 0)
        .await
        .unwrap();
    let mut parts = packed.split(ROW_SEP);
    assert_eq!(parts.next().unwrap(), "n");
    assert_eq!(parts.next().unwrap(), "200");

    // A NULL must be distinguishable from an empty string in the grid.
    let (_, rows, _) = driver.run_query("SELECT NULL AS n").await.unwrap();
    assert_eq!(rows[0][0], "null");

    let err = driver
        .run_query("SELECT * FROM does_not_exist")
        .await
        .expect_err("missing table should fail");
    assert!(err.to_string().contains("does_not_exist"), "{err}");
}

#[tokio::test]
async fn virtual_paging_caches_and_serves_pages() {
    let (_temp, driver) = fixture("paging").await;
    let cache: Mutex<VirtualCache> = Mutex::new(VirtualCache::new());

    let (columns, total_rows, first_page, _) = driver
        .execute_virtual(
            &cache,
            "SELECT id, total FROM orders ORDER BY id",
            "q1",
            50,
            0,
        )
        .await
        .unwrap();

    assert_eq!(total_rows, 200);
    assert_eq!(columns.split(CELL_SEP).count(), 2);
    assert_eq!(first_page.split(ROW_SEP).count(), 50, "first page is full");

    let page = crate::drivers::pgsql::driver::fetch_cached_page(&cache, "q1", 2, 50, 50)
        .await
        .expect("second page");
    let first_id = page
        .split(ROW_SEP)
        .next()
        .unwrap()
        .split(CELL_SEP)
        .next()
        .unwrap();
    assert_eq!(first_id, "51", "offset 50 starts at id 51");

    crate::drivers::pgsql::driver::close_cached_query(&cache, "q1")
        .await
        .unwrap();
    assert!(cache.lock().await.is_empty());
}

/// Same reason as MySQL: without these the overview never stops loading.
/// SQLite has no statistics catalogue, so the count is exact and the sizes are
/// honestly unavailable.
#[tokio::test]
async fn table_statistics_come_back() {
    let (_temp, driver) = fixture("stats").await;

    let stats = driver
        .table_statistics("main", "orders")
        .await
        .expect("table_statistics");
    let map: std::collections::BTreeMap<_, _> = stats.into_iter().collect();

    assert_eq!(map.get("row_estimate").map(String::as_str), Some("200"));
    assert_eq!(map.get("columns").map(String::as_str), Some("3"));
    // No dbstat, so no size — said as "-" rather than a made-up zero.
    assert_eq!(map.get("total_size").map(String::as_str), Some("-"));
}

#[tokio::test]
async fn ddl_comes_back_verbatim() {
    let (_temp, driver) = fixture("ddl").await;

    let ddl = driver
        .generate_ddl("main", "customers", "table")
        .await
        .unwrap();
    assert!(ddl.contains("CREATE TABLE customers"), "{ddl}");
    assert!(ddl.contains("email"), "{ddl}");

    let err = driver
        .generate_ddl("main", "nope", "table")
        .await
        .expect_err("unknown object");
    assert!(err.to_string().contains("No DDL recorded"), "{err}");
}

/// Everything SQLite does not have must refuse clearly rather than half-work.
#[tokio::test]
async fn unsupported_features_say_so() {
    let (_temp, driver) = fixture("unsupported").await;

    for err in [
        driver.load_roles().await.err(),
        driver.load_extensions().await.err(),
        driver.discover_channels().await.err(),
        driver.load_materialized_views("main").await.err(),
        driver.load_activity().await.err(),
    ] {
        let err = err.expect("should be unsupported");
        let msg = err.to_string();
        assert!(msg.contains("SQLITE"), "should name the engine: {msg}");
    }

    let caps = DriverKind::Sqlite.capabilities();
    assert!(!caps.roles);
    assert!(!caps.pubsub);
    assert!(!caps.materialized_views);
    assert!(!caps.monitoring);
    assert!(caps.ddl_generation);
    assert!(caps.triggers);
}

/// The path reaches the driver two ways: canonically in `options.path`, and in
/// the `database` slot of the connect key, which is all an unsaved connection
/// has to work with. Both must open the same file.
#[tokio::test]
async fn a_path_arrives_through_either_route() {
    let (temp, _driver) = fixture("routes").await;

    // As a saved project would load it.
    let via_options = connect(&temp.params()).await.expect("via options");
    assert!(!via_options.load_tables("main").await.unwrap().is_empty());

    // As the connection modal sends it before the project is saved.
    let key = ["", "", &temp.path(), "", "", "false"];
    let via_key = connect(&ConnectionParams::from_key(&key))
        .await
        .expect("via key");
    assert!(!via_key.load_tables("main").await.unwrap().is_empty());
}

/// The generic dispatch has to reach the SQLite driver, not just the concrete
/// constructor — this is what the Tauri command layer actually calls.
#[tokio::test]
async fn the_registry_dispatches_to_this_driver() {
    let (temp, _driver) = fixture("registry").await;

    let driver = crate::drivers::connection::connect(DriverKind::Sqlite, &temp.params())
        .await
        .expect("registry connect");
    assert_eq!(driver.kind(), DriverKind::Sqlite);
    assert_eq!(
        driver.load_schemas().await.unwrap(),
        vec!["main".to_string()]
    );

    let banner = crate::drivers::connection::test_connection(DriverKind::Sqlite, &temp.params())
        .await
        .expect("registry test");
    assert!(banner.starts_with("SQLite "), "{banner}");
}

/// PRAGMA takes no bind parameters, so a table name reaches the statement as
/// text. It must not be able to end the argument and start a new statement.
#[tokio::test]
async fn a_hostile_object_name_cannot_break_out() {
    let (_temp, driver) = fixture("injection").await;

    let hostile = "x'); DROP TABLE customers; --";
    // Nonsense name, so no columns; the point is that it stays a lookup.
    let columns = driver.load_columns("main", hostile).await.unwrap();
    assert!(columns.is_empty());

    // The table it tried to drop is still there.
    let tables = driver.load_tables("main").await.unwrap();
    assert!(
        tables.iter().any(|t| t.0 == "customers"),
        "injection dropped the table: {tables:?}"
    );
}
