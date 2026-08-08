//! Integration tests for the PostgreSQL driver.
//!
//! These need a live server and are skipped unless `RAYODB_TEST_PG` is set to a
//! connection string of the form `user:password@host:port/database`. To run:
//!
//! ```sh
//! docker run -d --rm --name rayodb-test -e POSTGRES_PASSWORD=testpass \
//!     -e POSTGRES_USER=testuser -e POSTGRES_DB=testdb -p 55432:5432 postgres:16
//! RAYODB_TEST_PG=testuser:testpass@127.0.0.1:55432/testdb cargo test -- --nocapture
//! ```
//!
//! The fixture schema they expect is in `tests/fixtures/seed.sql`.

use tokio::sync::Mutex;

use crate::drivers::cache::VirtualCache;
use crate::drivers::connection::ConnectionParams;
use crate::drivers::kind::DriverKind;
use crate::drivers::traits::Driver;

use super::commands::pool_connection::{connect, test_connection};

/// Parse `user:password@host:port/database`.
fn params_from_env() -> Option<ConnectionParams> {
    let raw = std::env::var("RAYODB_TEST_PG").ok()?;
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
                eprintln!("RAYODB_TEST_PG not set — skipping");
                return;
            }
        }
    };
}

#[tokio::test]
async fn test_connection_reports_server_version() {
    let params = skip_without_server!();
    let version = test_connection(&params).await.expect("test_connection");
    assert!(
        version.contains("PostgreSQL"),
        "unexpected version banner: {version}"
    );
}

#[tokio::test]
async fn connect_exposes_pools_and_kind() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    assert_eq!(driver.kind(), DriverKind::Pgsql);

    let stats = driver.pool_stats().expect("pgsql reports pool stats");
    assert_eq!(stats.query.max, 16, "query pool size");
    assert_eq!(stats.meta.max, 8, "meta pool size");
    assert!(
        stats.query.open >= 1,
        "eager validation opened a connection"
    );
}

#[tokio::test]
async fn schema_tree_loads() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    let schemas = driver.load_schemas().await.expect("load_schemas");
    assert!(schemas.contains(&"app".to_string()), "schemas: {schemas:?}");
    assert!(
        !schemas.iter().any(|s| s == "pg_catalog"),
        "system schemas must stay hidden"
    );

    let tables = driver.load_tables("app").await.expect("load_tables");
    let names: Vec<&str> = tables.iter().map(|t| t.0.as_str()).collect();
    for expected in ["customers", "orders", "events", "events_2025"] {
        assert!(names.contains(&expected), "missing {expected} in {names:?}");
    }

    // The partition branch: the child names its parent and carries a bound,
    // the parent carries a partition key.
    let child = tables.iter().find(|t| t.0 == "events_2025").unwrap();
    assert_eq!(child.2, "events", "partition parent");
    assert!(child.3.contains("FROM"), "partition bound: {}", child.3);
    let parent = tables.iter().find(|t| t.0 == "events").unwrap();
    assert!(parent.4.contains("RANGE"), "partition key: {}", parent.4);
    assert!(!parent.1.is_empty(), "partitioned table reports a size");

    let columns = driver
        .load_columns("app", "customers")
        .await
        .expect("load_columns");
    assert!(columns.contains(&"email".to_string()), "{columns:?}");

    let details = driver
        .load_column_details("app", "customers")
        .await
        .expect("load_column_details");
    let email = details.iter().find(|c| c.0 == "email").unwrap();
    assert_eq!(email.1, "text");
    assert!(!email.2, "email is NOT NULL");
    let created = details.iter().find(|c| c.0 == "created_at").unwrap();
    assert!(created.3.is_some(), "created_at has a default");

    let indexes = driver
        .load_indexes("app", "orders")
        .await
        .expect("load_indexes");
    assert!(
        indexes.iter().any(|i| i.0 == "orders_customer_idx"),
        "{indexes:?}"
    );
    assert!(indexes.iter().any(|i| i.3), "primary key index present");

    let constraints = driver
        .load_constraints("app", "orders")
        .await
        .expect("load_constraints");
    assert!(!constraints.is_empty(), "orders has constraints");

    let triggers = driver
        .load_triggers("app", "customers")
        .await
        .expect("load_triggers");
    assert!(
        triggers.iter().any(|t| t.0 == "customers_touch"),
        "{triggers:?}"
    );

    let rules = driver
        .load_rules("app", "orders")
        .await
        .expect("load_rules");
    let rule = rules
        .iter()
        .find(|r| r.0 == "orders_no_delete")
        .unwrap_or_else(|| panic!("{rules:?}"));
    assert_eq!(rule.1, "DELETE", "rule event");

    // A view's _RETURN rule is an implementation detail, not a user rule.
    let view_rules = driver
        .load_rules("app", "customer_orders")
        .await
        .expect("load_rules on a view");
    assert!(view_rules.is_empty(), "_RETURN leaked: {view_rules:?}");

    let policies = driver
        .load_policies("app", "customers")
        .await
        .expect("load_policies");
    assert!(
        policies.iter().any(|p| p.0 == "customers_self"),
        "{policies:?}"
    );

    let views = driver.load_views("app").await.expect("load_views");
    assert!(views.contains(&"customer_orders".to_string()), "{views:?}");

    let matviews = driver
        .load_materialized_views("app")
        .await
        .expect("load_materialized_views");
    assert!(
        matviews.contains(&"order_totals".to_string()),
        "{matviews:?}"
    );

    let sequences = driver.load_sequences("app").await.expect("load_sequences");
    assert!(
        sequences.iter().any(|s| s.0 == "invoice_seq"),
        "{sequences:?}"
    );

    let functions = driver.load_functions("app").await.expect("load_functions");
    assert!(
        functions.iter().any(|f| f.0 == "order_count"),
        "{functions:?}"
    );

    let trigger_fns = driver
        .load_trigger_functions("app")
        .await
        .expect("load_trigger_functions");
    assert!(
        trigger_fns.iter().any(|f| f.0 == "touch_row"),
        "{trigger_fns:?}"
    );

    let types = driver
        .load_data_types("app")
        .await
        .expect("load_data_types");
    assert!(types.iter().any(|t| t.0 == "status"), "{types:?}");

    // Present but empty in the fixture — these must return Ok, not error.
    driver
        .load_procedures("app")
        .await
        .expect("load_procedures");
    driver
        .load_foreign_tables("app")
        .await
        .expect("load_foreign_tables");
    driver
        .load_event_triggers()
        .await
        .expect("load_event_triggers");

    let databases = driver.load_databases().await.expect("load_databases");
    assert!(databases.contains(&"testdb".to_string()), "{databases:?}");

    let tablespaces = driver.load_tablespaces().await.expect("load_tablespaces");
    assert!(!tablespaces.is_empty(), "pg_default always exists");
}

#[tokio::test]
async fn foreign_keys_resolve_in_both_directions() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    let fks = driver
        .load_foreign_keys("app")
        .await
        .expect("load_foreign_keys");
    assert!(
        fks.iter()
            .any(|f| f.0 == "orders" && f.1 == "customer_id" && f.2 == "customers"),
        "{fks:?}"
    );

    let outgoing = driver
        .fk_details("app", "orders", "outgoing")
        .await
        .expect("fk_details outgoing");
    assert!(!outgoing.is_empty(), "orders references customers");
    let fk = &outgoing[0];
    assert_eq!(fk.5, "customers", "target table");
    assert_eq!(fk.8, "CASCADE", "on delete");

    let incoming = driver
        .fk_details("app", "customers", "incoming")
        .await
        .expect("fk_details incoming");
    assert!(!incoming.is_empty(), "customers is referenced by orders");
}

#[tokio::test]
async fn queries_execute_packed_and_plain() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    let (columns, rows, _) = driver
        .run_query("SELECT id, email FROM app.customers ORDER BY id LIMIT 3")
        .await
        .expect("run_query");
    assert_eq!(columns, vec!["id", "email"]);
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0][0], "1");

    let (packed, _) = driver
        .run_query_packed("SELECT count(*) AS n FROM app.orders", 0)
        .await
        .expect("run_query_packed");
    // header row then one data row, separated by the record separator
    let mut parts = packed.split(crate::drivers::cache::ROW_SEP);
    assert_eq!(parts.next().unwrap(), "n");
    assert_eq!(parts.next().unwrap(), "2000");

    // A failing statement must surface the server's message, not "db error".
    let err = driver
        .run_query("SELECT * FROM app.does_not_exist")
        .await
        .expect_err("missing relation should fail");
    let msg = err.to_string();
    assert!(
        msg.contains("does_not_exist") && msg.contains("42P01"),
        "error lost its detail: {msg}"
    );

    // statement_timeout is applied and then reset
    let timed_out = driver.run_query_packed("SELECT pg_sleep(2)", 100).await;
    assert!(timed_out.is_err(), "1ms budget should trip the timeout");
    driver
        .run_query_packed("SELECT 1", 0)
        .await
        .expect("connection still usable after a timeout");
}

#[tokio::test]
async fn virtual_paging_caches_and_serves_pages() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");
    let cache: Mutex<VirtualCache> = Mutex::new(VirtualCache::new());

    let (columns, total_rows, first_page, _) = driver
        .execute_virtual(
            &cache,
            "SELECT id, total FROM app.orders ORDER BY id",
            "q-test",
            100,
            0,
        )
        .await
        .expect("execute_virtual");

    assert_eq!(total_rows, 2000);
    let col_count = columns.split(crate::drivers::cache::CELL_SEP).count();
    assert_eq!(col_count, 2);
    assert!(!first_page.is_empty(), "first page is materialized");

    let page = super::driver::fetch_cached_page(&cache, "q-test", col_count, 100, 100)
        .await
        .expect("fetch second page");
    let first_row = page.split(crate::drivers::cache::ROW_SEP).next().unwrap();
    let first_id = first_row
        .split(crate::drivers::cache::CELL_SEP)
        .next()
        .unwrap();
    assert_eq!(first_id, "101", "offset 100 starts at id 101");

    super::driver::close_cached_query(&cache, "q-test")
        .await
        .expect("close");
    assert!(
        cache.lock().await.is_empty(),
        "closing evicts the cached query"
    );
}

#[tokio::test]
async fn object_inspection_and_ddl() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    let stats = driver
        .table_statistics("app", "customers")
        .await
        .expect("table_statistics");
    assert!(!stats.is_empty(), "{stats:?}");

    let view = driver
        .view_info("app", "customer_orders")
        .await
        .expect("view_info");
    assert!(!view.is_empty());

    let matview = driver
        .matview_info("app", "order_totals")
        .await
        .expect("matview_info");
    assert!(!matview.is_empty());

    let func = driver
        .function_info("app", "order_count")
        .await
        .expect("function_info");
    assert!(!func.is_empty());

    let ddl = driver
        .generate_ddl("app", "customers", "table")
        .await
        .expect("generate_ddl");
    assert!(ddl.contains("CREATE TABLE"), "{ddl}");
    assert!(ddl.contains("email"), "{ddl}");

    let objects = driver
        .extract_schema_objects("app")
        .await
        .expect("extract_schema_objects");
    assert!(!objects.is_empty());
}

#[tokio::test]
async fn monitoring_panels_load() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    assert!(!driver.load_activity().await.expect("activity").is_empty());
    assert!(
        !driver
            .load_database_stats()
            .await
            .expect("database_stats")
            .is_empty()
    );
    driver.load_table_stats().await.expect("table_stats");
    driver.load_locks().await.expect("locks");
    driver.load_index_usage().await.expect("index_usage");
    driver.load_table_bloat().await.expect("table_bloat");

    let settings = driver
        .load_server_settings()
        .await
        .expect("server_settings");
    assert!(!settings.is_empty(), "pg_settings is never empty");

    let extensions = driver.load_extensions().await.expect("extensions");
    assert!(!extensions.is_empty(), "plpgsql is always installed");
    driver
        .load_available_extensions()
        .await
        .expect("available_extensions");
}

#[tokio::test]
async fn roles_and_grants_load() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    let roles = driver.load_roles().await.expect("load_roles");
    assert!(roles.iter().any(|r| r.name == "analyst"), "seeded role");

    let table_grants = driver
        .load_table_grants("analyst")
        .await
        .expect("load_table_grants");
    assert!(
        table_grants.iter().any(|g| g.table == "customers"),
        "{table_grants:?}"
    );

    driver
        .load_database_grants("analyst")
        .await
        .expect("load_database_grants");
    driver
        .load_schema_table_grants("analyst")
        .await
        .expect("load_schema_table_grants");
    driver
        .load_default_table_grants("analyst")
        .await
        .expect("load_default_table_grants");
}

#[tokio::test]
async fn maintenance_actions_run() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    let msg = driver
        .table_action("ANALYZE", "app", "orders", "table")
        .await
        .expect("ANALYZE");
    assert!(msg.contains("completed"), "{msg}");

    driver
        .table_action("REFRESH", "app", "order_totals", "matview")
        .await
        .expect("REFRESH MATERIALIZED VIEW");

    let err = driver
        .table_action("NOPE", "app", "orders", "table")
        .await
        .expect_err("unknown action must be rejected");
    assert!(err.to_string().contains("Unknown action"), "{err}");
}

#[tokio::test]
async fn pubsub_channel_discovery() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    // No listeners yet, but the query itself must work.
    driver.discover_channels().await.expect("discover_channels");

    driver
        .notify_send("test_channel", "hello")
        .await
        .expect("notify_send");
}

// Not covered here: `run_query_streamed`, `listen_start` and `listen_stop`.
// They take the concrete `AppHandle` of the Wry runtime, while `mock_app`
// hands out an `AppHandle<MockRuntime>`; bridging the two would mean making
// `Driver` generic over the runtime, which would cost `AppState` its
// `Arc<dyn Driver>`. Exercise those two from the running app instead.

#[tokio::test]
async fn cancel_without_a_running_query_is_a_no_op() {
    let params = skip_without_server!();
    let driver = connect(&params).await.expect("connect");

    // Nothing has taken a query client yet, so there is no token to cancel.
    assert!(!driver.cancel_query().await.expect("cancel_query"));

    driver.run_query("SELECT 1").await.expect("run_query");
    // A token exists now; cancelling an already-finished statement is
    // accepted by the server and must not error.
    driver.cancel_query().await.expect("cancel after query");
}
