//! Integration tests for the MySQL driver.
//!
//! Like the PostgreSQL suite these need a live server and are skipped unless
//! `RAYODB_TEST_MYSQL` is set to `user:password@host:port/database`. To run:
//!
//! ```sh
//! docker run -d --rm --name rayodb-mysql -e MYSQL_ROOT_PASSWORD=rootpass \
//!     -e MYSQL_DATABASE=shop -e MYSQL_USER=testuser -e MYSQL_PASSWORD=testpass \
//!     -p 33306:3306 mysql:8
//! docker exec -i rayodb-mysql mysql -u root -prootpass shop \
//!     < src-tauri/tests/fixtures/seed-mysql.sql
//! RAYODB_TEST_MYSQL=root:rootpass@127.0.0.1:33306/shop cargo test
//! ```

use tokio::sync::Mutex;

use crate::drivers::cache::{CELL_SEP, ROW_SEP, VirtualCache};
use crate::drivers::connection::ConnectionParams;
use crate::drivers::kind::DriverKind;
use crate::drivers::traits::Driver;

use super::{MysqlDriver, connect, test_connection};

fn params_from_env() -> Option<ConnectionParams> {
    let raw = std::env::var("RAYODB_TEST_MYSQL").ok()?;
    let (creds, rest) = raw.split_once('@')?;
    let (username, password) = creds.split_once(':')?;
    let (hostport, database) = rest.split_once('/')?;
    let (host, port) = hostport.split_once(':')?;
    Some(ConnectionParams {
        username: username.to_string(),
        password: password.to_string(),
        database: database.to_string(),
        host: host.to_string(),
        port: port.to_string(),
        use_ssl: false,
        options: Default::default(),
    })
}

macro_rules! skip_without_server {
    () => {
        match params_from_env() {
            Some(p) => p,
            None => {
                eprintln!("RAYODB_TEST_MYSQL not set — skipping");
                return;
            }
        }
    };
}

async fn driver() -> Option<MysqlDriver> {
    let params = params_from_env()?;
    Some(connect(&params).await.expect("connect"))
}

#[tokio::test]
async fn test_connection_reports_the_server_version() {
    let params = skip_without_server!();
    let banner = test_connection(&params).await.expect("version");
    assert!(banner.starts_with("MySQL "), "{banner}");
}

#[tokio::test]
async fn the_schema_tree_loads() {
    let Some(driver) = driver().await else { return };

    assert_eq!(driver.kind(), DriverKind::Mysql);

    // A database *is* a schema here; the server's own four are not the user's.
    let schemas = driver.load_schemas().await.expect("load_schemas");
    assert!(schemas.contains(&"shop".to_string()), "{schemas:?}");
    for internal in ["mysql", "information_schema", "performance_schema", "sys"] {
        assert!(
            !schemas.iter().any(|s| s == internal),
            "{internal} should be hidden: {schemas:?}"
        );
    }

    let tables = driver.load_tables("shop").await.expect("load_tables");
    let names: Vec<&str> = tables.iter().map(|t| t.0.as_str()).collect();
    assert!(names.contains(&"customers"), "{names:?}");
    assert!(names.contains(&"orders"), "{names:?}");
    // A view is not a table.
    assert!(!names.contains(&"customer_orders"), "{names:?}");
    assert!(!tables[0].1.is_empty(), "tables report a size estimate");

    let views = driver.load_views("shop").await.expect("load_views");
    assert_eq!(views, vec!["customer_orders".to_string()]);

    let columns = driver
        .load_columns("shop", "customers")
        .await
        .expect("load_columns");
    assert_eq!(columns, vec!["id", "email", "name", "created_at"]);

    let details = driver
        .load_column_details("shop", "customers")
        .await
        .expect("load_column_details");
    let email = details.iter().find(|c| c.0 == "email").unwrap();
    assert_eq!(email.1, "varchar(255)");
    assert!(!email.2, "email is NOT NULL");
    let name = details.iter().find(|c| c.0 == "name").unwrap();
    assert!(name.2, "name is nullable");

    let functions = driver.load_functions("shop").await.expect("load_functions");
    assert!(
        functions.iter().any(|f| f.0 == "order_count"),
        "{functions:?}"
    );

    let procedures = driver
        .load_procedures("shop")
        .await
        .expect("load_procedures");
    assert!(
        procedures.iter().any(|p| p.0 == "purge_orders"),
        "{procedures:?}"
    );
}

#[tokio::test]
async fn indexes_and_constraints_come_back() {
    let Some(driver) = driver().await else { return };

    let indexes = driver
        .load_indexes("shop", "orders")
        .await
        .expect("load_indexes");
    assert!(
        indexes
            .iter()
            .any(|i| i.0 == "orders_customer_idx" && i.1 == "customer_id"),
        "{indexes:?}"
    );
    // MySQL always names the primary key's index PRIMARY.
    assert!(indexes.iter().any(|i| i.3), "{indexes:?}");

    let unique = driver
        .load_indexes("shop", "customers")
        .await
        .expect("load_indexes");
    assert!(unique.iter().any(|i| i.2 && i.1 == "email"), "{unique:?}");

    let constraints = driver
        .load_constraints("shop", "orders")
        .await
        .expect("load_constraints");
    assert!(
        constraints.iter().any(|c| c.1 == "PRIMARY KEY"),
        "{constraints:?}"
    );
    assert!(
        constraints.iter().any(|c| c.1 == "FOREIGN KEY"),
        "{constraints:?}"
    );
}

#[tokio::test]
async fn foreign_keys_resolve_in_both_directions() {
    let Some(driver) = driver().await else { return };

    let fks = driver
        .load_foreign_keys("shop")
        .await
        .expect("load_foreign_keys");
    assert!(
        fks.iter()
            .any(|f| f.0 == "orders" && f.1 == "customer_id" && f.2 == "customers"),
        "{fks:?}"
    );

    let outgoing = driver
        .fk_details("shop", "orders", "outgoing")
        .await
        .expect("fk_details outgoing");
    assert!(!outgoing.is_empty(), "orders references customers");
    assert_eq!(outgoing[0].5, "customers", "target table");
    assert_eq!(outgoing[0].8, "CASCADE", "on delete");
    assert_eq!(outgoing[0].7, "RESTRICT", "on update");

    let incoming = driver
        .fk_details("shop", "customers", "incoming")
        .await
        .expect("fk_details incoming");
    assert!(!incoming.is_empty(), "customers is referenced by orders");
    assert_eq!(incoming[0].2, "orders", "source table");
}

#[tokio::test]
async fn triggers_report_their_timing_and_event() {
    let Some(driver) = driver().await else { return };

    let triggers = driver
        .load_triggers("shop", "customers")
        .await
        .expect("load_triggers");
    let trigger = triggers
        .iter()
        .find(|t| t.0 == "customers_touch")
        .unwrap_or_else(|| panic!("{triggers:?}"));
    assert_eq!(trigger.1, "UPDATE", "event");
    assert_eq!(trigger.2, "BEFORE", "timing");
}

#[tokio::test]
async fn queries_run_plain_and_packed() {
    let Some(driver) = driver().await else { return };

    let (columns, rows, _) = driver
        .run_query("SELECT id, email FROM customers ORDER BY id LIMIT 3")
        .await
        .expect("run_query");
    assert_eq!(columns, vec!["id", "email"]);
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0][0], "1");
    assert_eq!(rows[0][1], "user1@example.com");

    let (packed, _) = driver
        .run_query_packed("SELECT count(*) AS n FROM orders", 0)
        .await
        .expect("run_query_packed");
    let mut parts = packed.split(ROW_SEP);
    assert_eq!(parts.next().unwrap(), "n");
    assert_eq!(parts.next().unwrap(), "200");

    // NULL has to be distinguishable from an empty string in the grid.
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
    let Some(driver) = driver().await else { return };
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
        .expect("execute_virtual");

    assert_eq!(total_rows, 200);
    assert_eq!(columns.split(CELL_SEP).count(), 2);
    assert_eq!(first_page.split(ROW_SEP).count(), 50);

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
}

#[tokio::test]
async fn ddl_comes_from_show_create() {
    let Some(driver) = driver().await else { return };

    let ddl = driver
        .generate_ddl("shop", "customers", "table")
        .await
        .expect("generate_ddl");
    assert!(ddl.contains("CREATE TABLE"), "{ddl}");
    // MySQL quotes with backticks, which is the whole reason the frontend's
    // generators cannot be reused as they are.
    assert!(ddl.contains("`customers`"), "{ddl}");

    let view = driver
        .generate_ddl("shop", "customer_orders", "view")
        .await
        .expect("view ddl");
    assert!(view.contains("CREATE"), "{view}");
}

#[tokio::test]
async fn monitoring_reads_the_server() {
    let Some(driver) = driver().await else { return };

    // Implemented even though the monitor panel is gated off: it is the one
    // piece that works, and the panel turns on once the rest catch up.
    let activity = driver.load_activity().await.expect("activity");
    assert!(!activity.is_empty(), "our own connection is in there");

    let settings = driver.load_server_settings().await.expect("settings");
    assert!(!settings.is_empty(), "global variables are never empty");
}

/// Everything MySQL does not have must refuse clearly rather than half-work.
#[tokio::test]
async fn unsupported_features_say_so() {
    let Some(driver) = driver().await else { return };

    for err in [
        driver.load_materialized_views("shop").await.err(),
        driver.load_policies("shop", "orders").await.err(),
        driver.load_rules("shop", "orders").await.err(),
        driver.discover_channels().await.err(),
        driver.load_extensions().await.err(),
    ] {
        let msg = err.expect("should be unsupported").to_string();
        assert!(msg.contains("MYSQL"), "should name the engine: {msg}");
    }

    let caps = DriverKind::Mysql.capabilities();
    assert!(caps.schemas, "a database is a schema");
    assert!(caps.triggers);
    // The monitor panel needs five more implementations before it is honest.
    assert!(!caps.monitoring);
    assert!(!caps.materialized_views);
    assert!(!caps.pubsub);
    assert!(!caps.policies);
    // The frontend's SQL generators now have a MySQL dialect.
    assert!(caps.object_templates);
    assert!(caps.structure_editing);
}

/// information_schema filters take object names as data. A name that tried to
/// close the literal must stay a filter, not become a statement.
#[tokio::test]
async fn a_hostile_object_name_cannot_break_out() {
    let Some(driver) = driver().await else { return };

    let hostile = "x'; DROP TABLE customers; --";
    let columns = driver.load_columns("shop", hostile).await.expect("lookup");
    assert!(columns.is_empty());

    let tables = driver.load_tables("shop").await.expect("load_tables");
    assert!(
        tables.iter().any(|t| t.0 == "customers"),
        "injection dropped the table: {tables:?}"
    );
}

/// The generic dispatch has to reach this driver, which is what the command
/// layer actually calls.
#[tokio::test]
async fn the_registry_dispatches_to_this_driver() {
    let params = skip_without_server!();

    let driver = crate::drivers::connection::connect(DriverKind::Mysql, &params)
        .await
        .expect("registry connect");
    assert_eq!(driver.kind(), DriverKind::Mysql);
    assert!(!driver.load_schemas().await.unwrap().is_empty());
}
