//! What an engine can actually do.
//!
//! The trait defaults in `drivers::traits` already refuse unsupported calls,
//! but an error the user has to trigger is a poor way to learn that their
//! engine has no materialized views. This descriptor lets the UI never offer
//! them in the first place: it gates sidebar branches, tabs and menu entries.
//!
//! `Capabilities::none()` is the honest starting point for a new engine — turn
//! a flag on only once the driver really implements it, since a flag that lies
//! puts a dead branch in the tree.

use serde::{Deserialize, Serialize};

use crate::drivers::kind::DriverKind;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    // ---- schema tree ----
    /// The server groups objects into named schemas. MySQL, where a database
    /// *is* the schema, says false and the tree collapses a level.
    pub schemas: bool,
    pub materialized_views: bool,
    pub sequences: bool,
    pub functions: bool,
    pub procedures: bool,
    pub data_types: bool,
    pub foreign_tables: bool,
    pub trigger_functions: bool,
    pub event_triggers: bool,
    pub partitions: bool,

    // ---- per-table detail ----
    pub triggers: bool,
    pub rules: bool,
    pub policies: bool,

    // ---- server-level panels ----
    pub databases: bool,
    pub tablespaces: bool,
    pub roles: bool,
    pub extensions: bool,
    pub server_settings: bool,
    pub monitoring: bool,
    pub pubsub: bool,

    // ---- actions ----
    pub query_cancellation: bool,
    pub streaming: bool,
    pub csv_import: bool,
    pub ddl_generation: bool,
    pub table_maintenance: bool,
    pub schema_diff: bool,
    /// The sidebar's "New table…", "New view…" and friends. These are complete
    /// PostgreSQL statements, not just quoted identifiers, so an engine only
    /// gets them once it has templates of its own.
    pub object_templates: bool,
    /// The properties modal's structure editor, which composes ALTER TABLE in
    /// the frontend and is PostgreSQL-shaped for the same reason.
    pub structure_editing: bool,
}

impl Capabilities {
    /// Nothing beyond running a query and listing tables and columns, which
    /// every engine must do. New drivers start here.
    pub fn none() -> Self {
        Self::default()
    }

    /// SQLite is a file, not a server: no roles, no extensions, no pub/sub, no
    /// server statistics to report. What it does have is the structural core —
    /// tables, views, indexes, foreign keys — plus the original DDL, which it
    /// stores verbatim in `sqlite_master`.
    pub fn sqlite() -> Self {
        Self {
            // One implicit schema, so nothing to browse between server and
            // table; `load_schemas` still names it so the tree keeps its shape.
            schemas: false,
            triggers: true,
            ddl_generation: true,
            streaming: true,
            ..Self::none()
        }
    }

    pub fn postgres() -> Self {
        Self {
            schemas: true,
            materialized_views: true,
            sequences: true,
            functions: true,
            procedures: true,
            data_types: true,
            foreign_tables: true,
            trigger_functions: true,
            event_triggers: true,
            partitions: true,

            triggers: true,
            rules: true,
            policies: true,

            databases: true,
            tablespaces: true,
            roles: true,
            extensions: true,
            server_settings: true,
            monitoring: true,
            pubsub: true,

            query_cancellation: true,
            streaming: true,
            csv_import: true,
            ddl_generation: true,
            table_maintenance: true,
            schema_diff: true,
            object_templates: true,
            structure_editing: true,
        }
    }

    /// MySQL: the structural half of the trait maps over, but a database is
    /// the schema rather than something inside one. Off are the things
    /// PostgreSQL has and it does not, plus the two frontend SQL generators
    /// that still emit PostgreSQL — those wait for the dialect work.
    pub fn mysql() -> Self {
        Self {
            schemas: true,
            functions: true,
            procedures: true,
            triggers: true,
            databases: true,
            server_settings: true,
            monitoring: true,
            query_cancellation: true,
            streaming: true,
            ddl_generation: true,
            ..Self::none()
        }
    }
}

impl DriverKind {
    /// Static per engine, so the UI can ask before a connection exists.
    pub fn capabilities(self) -> Capabilities {
        match self {
            DriverKind::Pgsql => Capabilities::postgres(),
            DriverKind::Sqlite => Capabilities::sqlite(),
            DriverKind::Mysql => Capabilities::mysql(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_engine_starts_with_nothing_enabled() {
        let caps = Capabilities::none();
        assert!(!caps.materialized_views);
        assert!(!caps.roles);
        assert!(!caps.pubsub);
        assert!(!caps.schemas);
        assert_eq!(caps, Capabilities::default());
    }

    #[test]
    fn postgres_enables_the_whole_surface() {
        let caps = DriverKind::Pgsql.capabilities();
        assert!(caps.schemas);
        assert!(caps.materialized_views);
        assert!(caps.policies);
        assert!(caps.pubsub);
        assert!(caps.roles);
    }

    /// The UI gates on `caps.someFlag`. A field renamed on one side only would
    /// read as `undefined`, which is falsy, so the feature would quietly vanish
    /// instead of failing loudly. Keep the two declarations in lockstep.
    #[test]
    fn rust_and_typescript_declare_the_same_flags() {
        let ts = include_str!("../../../src/lib/database-driver/capabilities.ts");
        let interface = ts
            .split_once("export interface DriverCapabilities {")
            .expect("interface not found")
            .1
            .split_once('}')
            .expect("unterminated interface")
            .0;

        let ts_fields: std::collections::BTreeSet<&str> = interface
            .lines()
            .filter_map(|l| l.trim().split_once(": boolean;"))
            .map(|(name, _)| name)
            .collect();

        let json = sonic_rs::to_string(&Capabilities::none()).unwrap();
        let rust_fields: std::collections::BTreeSet<&str> = json
            .trim_matches(['{', '}'])
            .split(',')
            .filter_map(|pair| pair.split_once(':'))
            .map(|(key, _)| key.trim_matches('"'))
            .collect();

        assert_eq!(
            rust_fields, ts_fields,
            "Capabilities fields drifted between Rust and TypeScript"
        );
    }

    #[test]
    fn capabilities_serialize_as_camel_case_for_the_frontend() {
        let json = sonic_rs::to_string(&DriverKind::Pgsql.capabilities()).unwrap();
        assert!(json.contains("\"materializedViews\":true"), "{json}");
        assert!(json.contains("\"serverSettings\":true"), "{json}");
        assert!(!json.contains("materialized_views"), "{json}");
    }
}
