# Multi-driver support plan (MySQL, SQLite)

Assessment and implementation plan for adding MySQL and SQLite alongside the
existing PostgreSQL driver.

Status as of this document: **frontend 7/10 ready, Rust backend 2/10, data model
3/10.**

## 1. What is already in place

### Frontend

- `src/lib/database-driver/factory.ts` holds a real `DriverFactory` backed by a
  `Map<DriverType, DatabaseDriver>`. Registering a new driver is one map entry
  plus one `DRIVER_CONFIGS` entry.
- `src/lib/database-driver/index.ts` defines the `DatabaseDriver` interface.
  Most advanced methods are already optional (`loadPolicies?`, `listenStart?`,
  `loadRoles?`, `loadExtensions?`, `runQueryStreamed?`, …), so a SQLite driver
  can implement ~15 of ~60 methods and still typecheck.
- Every consumer goes through `DriverFactory.getDriver(d.driver)` — stores,
  panels, ERD, tab bar. No scattered `invoke("pgsql_*")` calls, with one
  exception noted below.
- The wire format (packed strings with `CELL_SEP`/`ROW_SEP`, streaming events,
  virtual cache paging) is engine-agnostic.
- The SSH tunnel (`src-tauri/src/ssh.rs`) is generic and reusable for MySQL.

### Hardcoded spots that are trivial to widen

| Location | Issue |
| --- | --- |
| `src/types/index.ts:18` | `export type DriverType = "PGSQL"` |
| `src/App.tsx:86` | `connection.driver as "PGSQL"` |
| `src/stores/project-store/core.ts:25` | `(arr[0] ?? "PGSQL") as DriverType` |
| `src/components/connection-modal/index.tsx:50,78` | `driver: "PGSQL"` defaults |
| `src/components/connection-modal/form-fields.tsx` | `DriverDisplay` renders a static field; placeholder is `postgresql://…` |
| `src/tauri.ts:61` | direct `invoke("pgsql_test_connection")`, bypasses the driver layer |

## 2. What is missing

### 2.1 Rust backend: no abstraction at all (the bulk of the work)

- `src-tauri/src/drivers/mod.rs` is a single line: `pub mod pgsql;`. There is no
  `Driver` trait.
- `AppState` (`src-tauri/src/main.rs`) is typed directly against PostgreSQL:
  `clients: BTreeMap<String, Arc<deadpool_postgres::Pool>>`, `meta_clients`,
  `cancel_tokens: BTreeMap<String, tokio_postgres::CancelToken>`, plus a
  `drivers::pgsql::VirtualCache`.
- `main.rs` registers ~70 individual `drivers::pgsql::pgsql_*` commands in
  `invoke_handler!`.
- ~3,800 LOC under `src-tauri/src/drivers/pgsql/` are engine-specific.

Adding a driver today means either duplicating the whole command surface
(`mysql_load_tables`, `sqlite_load_tables`, …) or refactoring first. Refactor.

### 2.2 Connection model is rigid

- `ProjectDetails` (`src/types/index.ts:1`) is flat: `username`, `password`,
  `database`, `host`, `port`, `ssl`, plus SSH fields.
- The `projects` table in libsql has fixed columns
  (`src-tauri/src/dbs/project.rs:16`), and `project_db_insert` reads a
  positional array.
- `DatabaseDriver.connect` takes a fixed 6-tuple key.
- SQLite needs a file path, not host/port/user/password. MySQL has no `ssl`
  semantics identical to PG's.

### 2.3 PG-centric conceptual model, no capability gating

- The sidebar tree is server → schema → objects. MySQL has no schemas
  (database ≡ schema); SQLite has neither schemas, roles, matviews, nor
  extensions.
- `TabType` (`src/types/index.ts`) includes `pg-settings`, `notify`, `roles`,
  `schema-diff`, `extensions`, `enums` with no gating mechanism.
- There is no capability descriptor a driver can expose for the UI to hide
  unsupported tree branches, tabs, and command-palette entries.

### 2.4 PostgreSQL SQL generated in the frontend

- `src/lib/alter-table-sql.ts` (256 LOC) — PG DDL, double-quote identifier
  quoting (MySQL uses backticks).
- `src/components/server-sidebar/ddl-queries.ts` — `pg_catalog` queries.
- `src/components/command-palette/index.tsx` and
  `src/components/performance-monitor/table-stats-tab.tsx` — `pg_stat*` queries.

These must move behind the driver or behind a dialect abstraction.

## 3. Implementation plan

### Phase 1 — Rust driver trait and generic `AppState`

1. Define `src-tauri/src/drivers/traits.rs` with an async `Driver` trait
   covering the command surface actually used by the frontend interface
   (connect/disconnect, metadata loaders, query execution, streaming, virtual
   paging), returning the existing wire types.
2. Replace the PG-typed fields in `AppState` with driver-agnostic handles — an
   enum over concrete pools (`PgPool`, `MySqlPool`, `SqliteConn`) or
   `Arc<dyn Driver>` per project id. Keep `virtual_cache` but move it out of
   `drivers::pgsql`.
3. Move cancellation behind the trait (`cancel_query`), since
   `tokio_postgres::CancelToken` does not generalize.
4. Rename the Tauri commands to `db_*` and dispatch on the project's registered
   driver. Keep `pgsql_*` as thin aliases during migration if needed, then drop
   them.
5. Adapt `drivers::pgsql` to implement the trait — mostly mechanical, no query
   rewrites.

Exit criterion: PostgreSQL works exactly as before through the generic command
surface, with `main.rs` free of `tokio_postgres`/`deadpool_postgres` types.

### Phase 2 — Capabilities

1. Add a `DriverCapabilities` descriptor (schemas, roles, matviews, extensions,
   enums, listen/notify, policies, rules, server settings, streaming, CSV
   import, DDL generation, …) exposed by `DatabaseDriver`.
2. Gate the sidebar tree branches, `TabType` availability, the command palette,
   and the object-properties modal on it.
3. Gate the corresponding Rust commands too, returning a clear
   `AppError::Unsupported` instead of panicking.

Exit criterion: with a stub driver reporting zero optional capabilities, the UI
renders a coherent, reduced experience with no dead tabs or empty tree nodes.

### Phase 3 — Flexible connection model

1. Extend `ProjectDetails` with a driver-specific payload (a JSON `options`
   column in the `projects` table, or a nullable `file_path`), keeping the
   existing columns for backwards compatibility.
2. Make the connection modal render fields per driver: file picker for SQLite,
   host/port/user/password for MySQL and PostgreSQL.
3. Turn `DriverDisplay` into a real driver selector once more than one driver is
   registered.
4. Widen `DriverType` to `"PGSQL" | "MYSQL" | "SQLITE"` and fix the hardcoded
   literals listed in section 1.
5. Route `pgsql_test_connection` (`src/tauri.ts:61`) through the driver layer.

### Phase 4 — SQLite driver

Chosen first: no network, no auth, no schemas, no roles — it is the strongest
test of whether the capability system actually holds.

1. Rust driver over `rusqlite`/`libsql` implementing the trait; schema
   introspection via `sqlite_master` and `PRAGMA table_info`/`index_list`/
   `foreign_key_list`.
2. Capabilities: tables, views, indexes, columns, foreign keys, query
   execution, DDL generation. Everything else off.
3. Map the single implicit schema to `main` so the tree shape still works.

### Phase 5 — MySQL driver

1. Rust driver over `sqlx::MySql` (or `mysql_async`) implementing the trait,
   with SSH tunnel reuse.
2. Introspection via `information_schema`; stats via `performance_schema` and
   `SHOW PROCESSLIST`.
3. Map database ≡ schema in the tree.
4. Capabilities: tables, views, columns, indexes, constraints, triggers,
   routines, foreign keys, roles/grants, server variables. Off: matviews,
   policies, rules, extensions, enum types as objects, listen/notify.
5. Backtick identifier quoting — requires the dialect work from phase 6.

### Phase 6 — Move SQL out of the frontend

Can run in parallel with phases 4–5, and is a prerequisite for MySQL DDL.

1. Introduce an identifier-quoting/dialect helper, or push DDL generation fully
   into the Rust drivers (`generateDDL` already exists in the interface).
2. Rewrite `alter-table-sql.ts`, `ddl-queries.ts`, and the `pg_stat*` queries in
   the command palette and table-stats tab to go through it.

## 4. Effort shape

Phase 1 is roughly 80% of the risk and the majority of the effort; phases 2–3
are moderate; each concrete driver is then largely additive. Do not start a
driver before phase 1 lands, or the duplicated command surface will have to be
unwound later.
