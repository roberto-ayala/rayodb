use crate::common::enums::{AppError, pg_error_message};

#[derive(Debug, Clone, serde::Serialize)]
pub struct PgRole {
    pub name: String,
    pub superuser: bool,
    pub create_db: bool,
    pub create_role: bool,
    pub login: bool,
    pub replication: bool,
    pub bypass_rls: bool,
    pub conn_limit: i32,
    pub valid_until: String,
    pub member_of: Vec<String>,
    pub inherit: bool,
}

/// What the role editor sends: every attribute the form can set. An empty
/// password means "leave it alone" on ALTER and "no password" on CREATE; an
/// empty valid_until means no expiry.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RoleSpec {
    pub name: String,
    pub login: bool,
    pub superuser: bool,
    pub create_db: bool,
    pub create_role: bool,
    pub inherit: bool,
    pub replication: bool,
    pub bypass_rls: bool,
    pub conn_limit: i32,
    pub valid_until: String,
    pub password: String,
    pub member_of: Vec<String>,
}

/// DDL takes no bind parameters, so identifiers and literals are quoted here.
/// Doubling the delimiter is the whole of the escaping rule, given
/// standard_conforming_strings, which has been on by default since 9.1.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn attribute_clauses(spec: &RoleSpec) -> String {
    fn flag<'a>(on: bool, yes: &'a str, no: &'a str) -> &'a str {
        if on { yes } else { no }
    }
    format!(
        "{} {} {} {} {} {} {} CONNECTION LIMIT {}",
        flag(spec.login, "LOGIN", "NOLOGIN"),
        flag(spec.superuser, "SUPERUSER", "NOSUPERUSER"),
        flag(spec.create_db, "CREATEDB", "NOCREATEDB"),
        flag(spec.create_role, "CREATEROLE", "NOCREATEROLE"),
        flag(spec.inherit, "INHERIT", "NOINHERIT"),
        flag(spec.replication, "REPLICATION", "NOREPLICATION"),
        flag(spec.bypass_rls, "BYPASSRLS", "NOBYPASSRLS"),
        spec.conn_limit,
    )
}

/// 'infinity' is how you say "no expiry" to VALID UNTIL — leaving the clause
/// out on ALTER would keep whatever expiry the role already had.
fn valid_until_clause(spec: &RoleSpec) -> String {
    if spec.valid_until.trim().is_empty() {
        " VALID UNTIL 'infinity'".to_string()
    } else {
        format!(" VALID UNTIL {}", quote_literal(spec.valid_until.trim()))
    }
}

fn password_clause(spec: &RoleSpec) -> String {
    if spec.password.is_empty() {
        String::new()
    } else {
        format!(" PASSWORD {}", quote_literal(&spec.password))
    }
}

pub async fn create_role(
    client: &deadpool_postgres::Client,
    spec: &RoleSpec,
) -> Result<(), AppError> {
    let mut sql = format!(
        "CREATE ROLE {} WITH {}{}{}",
        quote_ident(&spec.name),
        attribute_clauses(spec),
        password_clause(spec),
        valid_until_clause(spec),
    );
    for group in &spec.member_of {
        sql.push_str(&format!(
            "; GRANT {} TO {}",
            quote_ident(group),
            quote_ident(&spec.name)
        ));
    }

    // batch_execute wraps the statements in one implicit transaction, so a role
    // is never left created but not granted.
    client
        .batch_execute(&sql)
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))
}

pub async fn alter_role(
    client: &deadpool_postgres::Client,
    spec: &RoleSpec,
) -> Result<(), AppError> {
    let current: Vec<String> = client
        .query(
            "SELECT g.rolname
             FROM pg_auth_members m
             JOIN pg_roles g ON g.oid = m.roleid
             JOIN pg_roles r ON r.oid = m.member
             WHERE r.rolname = $1",
            &[&spec.name],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?
        .iter()
        .map(|r| r.get::<_, String>(0))
        .collect();

    let mut sql = format!(
        "ALTER ROLE {} WITH {}{}{}",
        quote_ident(&spec.name),
        attribute_clauses(spec),
        password_clause(spec),
        valid_until_clause(spec),
    );

    for group in &spec.member_of {
        if !current.contains(group) {
            sql.push_str(&format!(
                "; GRANT {} TO {}",
                quote_ident(group),
                quote_ident(&spec.name)
            ));
        }
    }
    for group in &current {
        if !spec.member_of.contains(group) {
            sql.push_str(&format!(
                "; REVOKE {} FROM {}",
                quote_ident(group),
                quote_ident(&spec.name)
            ));
        }
    }

    client
        .batch_execute(&sql)
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))
}

pub async fn drop_role(client: &deadpool_postgres::Client, name: &str) -> Result<(), AppError> {
    client
        .batch_execute(&format!("DROP ROLE {}", quote_ident(name)))
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))
}

pub async fn load_roles(client: &deadpool_postgres::Client) -> Result<Vec<PgRole>, AppError> {
    let rows = client
        .query(
            "SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
                    r.rolcanlogin, r.rolreplication, r.rolbypassrls, r.rolconnlimit,
                    CASE WHEN r.rolvaliduntil = 'infinity' THEN ''
                         ELSE COALESCE(r.rolvaliduntil::text, '') END,
                    COALESCE(array_agg(m.rolname) FILTER (WHERE m.rolname IS NOT NULL), '{}')::text[],
                    r.rolinherit
             FROM pg_roles r
             LEFT JOIN pg_auth_members am ON am.member = r.oid
             LEFT JOIN pg_roles m ON m.oid = am.roleid
             GROUP BY r.oid, r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
                      r.rolcanlogin, r.rolreplication, r.rolbypassrls, r.rolconnlimit,
                      r.rolvaliduntil, r.rolinherit
             ORDER BY r.rolname",
            &[],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    let mut roles = Vec::new();
    for row in rows {
        roles.push(PgRole {
            name: row.get::<_, String>(0),
            superuser: row.get::<_, bool>(1),
            create_db: row.get::<_, bool>(2),
            create_role: row.get::<_, bool>(3),
            login: row.get::<_, bool>(4),
            replication: row.get::<_, bool>(5),
            bypass_rls: row.get::<_, bool>(6),
            conn_limit: row.get::<_, i32>(7),
            valid_until: row.get::<_, String>(8),
            member_of: row.get::<_, Vec<String>>(9),
            inherit: row.get::<_, bool>(10),
        });
    }

    Ok(roles)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TableGrant {
    pub schema: String,
    pub table: String,
    pub grantee: String,
    pub privileges: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SchemaGrant {
    pub schema: String,
    pub privilege: String,
    /// Relations in the schema this role holds the privilege on, granted by name
    pub granted: i64,
    pub total: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DefaultGrant {
    pub schema: String,
    pub privilege: String,
    pub granted: bool,
}

/// The seven privileges a table can carry, in the order the UI lays them out.
const TABLE_PRIVILEGES: &str = "(VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'))";

fn check_table_privilege(privilege: &str) -> Result<&'static str, AppError> {
    match privilege {
        "SELECT" => Ok("SELECT"),
        "INSERT" => Ok("INSERT"),
        "UPDATE" => Ok("UPDATE"),
        "DELETE" => Ok("DELETE"),
        "TRUNCATE" => Ok("TRUNCATE"),
        "REFERENCES" => Ok("REFERENCES"),
        "TRIGGER" => Ok("TRIGGER"),
        other => Err(AppError::QueryFailed(format!(
            "Unknown table privilege '{other}'"
        ))),
    }
}

/// How much of each schema this role can reach, counted over the relations that
/// exist now. GRANT ON ALL TABLES is a batch, not a rule, so a schema drifts to
/// a partial count as soon as anything new is created in it.
pub async fn load_schema_table_grants(
    client: &deadpool_postgres::Client,
    role_name: &str,
) -> Result<Vec<SchemaGrant>, AppError> {
    let sql = format!(
        "SELECT n.nspname::text,
                p.privilege_type,
                count(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
                    WHERE a.grantee = r.oid AND a.privilege_type = p.privilege_type))::bigint,
                count(*)::bigint
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN {TABLE_PRIVILEGES} AS p(privilege_type)
         CROSS JOIN (SELECT oid FROM pg_roles WHERE rolname = $1) r
         WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND n.nspname NOT LIKE 'pg\\_%'
         GROUP BY 1, 2
         ORDER BY 1, 2"
    );

    let rows = client
        .query(&sql, &[&role_name])
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows
        .iter()
        .map(|row| SchemaGrant {
            schema: row.get(0),
            privilege: row.get(1),
            granted: row.get(2),
            total: row.get(3),
        })
        .collect())
}

/// What tables created from here on will carry. Default privileges are keyed by
/// the role that creates the object, so these are the ones attached to the role
/// this connection authenticates as — the only ones it can set without FOR ROLE.
pub async fn load_default_table_grants(
    client: &deadpool_postgres::Client,
    role_name: &str,
) -> Result<Vec<DefaultGrant>, AppError> {
    let sql = format!(
        "SELECT n.nspname::text,
                p.privilege_type,
                EXISTS (
                    SELECT 1 FROM pg_default_acl d
                    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
                    WHERE d.defaclobjtype = 'r'
                      AND d.defaclnamespace = n.oid
                      AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                      AND a.grantee = r.oid
                      AND a.privilege_type = p.privilege_type)
         FROM pg_namespace n
         CROSS JOIN {TABLE_PRIVILEGES} AS p(privilege_type)
         CROSS JOIN (SELECT oid FROM pg_roles WHERE rolname = $1) r
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND n.nspname NOT LIKE 'pg\\_%'
         ORDER BY 1, 2"
    );

    let rows = client
        .query(&sql, &[&role_name])
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows
        .iter()
        .map(|row| DefaultGrant {
            schema: row.get(0),
            privilege: row.get(1),
            granted: row.get(2),
        })
        .collect())
}

pub async fn set_schema_table_privilege(
    client: &deadpool_postgres::Client,
    schema: &str,
    role_name: &str,
    privilege: &str,
    granted: bool,
) -> Result<(), AppError> {
    let privilege = check_table_privilege(privilege)?;
    let sql = if granted {
        format!(
            "GRANT {privilege} ON ALL TABLES IN SCHEMA {} TO {}",
            quote_ident(schema),
            quote_ident(role_name)
        )
    } else {
        format!(
            "REVOKE {privilege} ON ALL TABLES IN SCHEMA {} FROM {}",
            quote_ident(schema),
            quote_ident(role_name)
        )
    };

    client
        .batch_execute(&sql)
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))
}

pub async fn set_default_table_privilege(
    client: &deadpool_postgres::Client,
    schema: &str,
    role_name: &str,
    privilege: &str,
    granted: bool,
) -> Result<(), AppError> {
    let privilege = check_table_privilege(privilege)?;
    let sql = if granted {
        format!(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA {} GRANT {privilege} ON TABLES TO {}",
            quote_ident(schema),
            quote_ident(role_name)
        )
    } else {
        format!(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA {} REVOKE {privilege} ON TABLES FROM {}",
            quote_ident(schema),
            quote_ident(role_name)
        )
    };

    client
        .batch_execute(&sql)
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))
}

/// The escape hatch for the exceptions the per-schema view cannot express.
pub async fn revoke_table_privileges(
    client: &deadpool_postgres::Client,
    schema: &str,
    table: &str,
    role_name: &str,
) -> Result<(), AppError> {
    let sql = format!(
        "REVOKE ALL PRIVILEGES ON TABLE {}.{} FROM {}",
        quote_ident(schema),
        quote_ident(table),
        quote_ident(role_name)
    );

    client
        .batch_execute(&sql)
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))
}

pub async fn load_table_grants(
    client: &deadpool_postgres::Client,
    role_name: &str,
) -> Result<Vec<TableGrant>, AppError> {
    let rows = client
        .query(
            "SELECT table_schema, table_name, grantee,
                    array_agg(privilege_type ORDER BY privilege_type)::text[]
             FROM information_schema.table_privileges
             WHERE grantee = $1
             GROUP BY table_schema, table_name, grantee
             ORDER BY table_schema, table_name",
            &[&role_name],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    let mut grants = Vec::new();
    for row in rows {
        grants.push(TableGrant {
            schema: row.get(0),
            table: row.get(1),
            grantee: row.get(2),
            privileges: row.get::<_, Vec<String>>(3),
        });
    }

    Ok(grants)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DbGrant {
    pub database: String,
    pub privilege: String,
    /// Granted to this role by name
    pub granted: bool,
    /// Available to everyone, so the role has it whether or not it was granted
    pub via_public: bool,
}

/// Every database against the three privileges one can hold on it, saying both
/// what this role was granted and what PUBLIC already gives everyone — a role
/// usually reaches a database through PUBLIC rather than a grant of its own,
/// and has_database_privilege cannot tell the two apart.
pub async fn load_database_grants(
    client: &deadpool_postgres::Client,
    role_name: &str,
) -> Result<Vec<DbGrant>, AppError> {
    let rows = client
        .query(
            // A null datacl means the defaults are in force rather than "no
            // privileges", so acldefault materialises them.
            "SELECT d.datname::text,
                    p.privilege_type,
                    EXISTS (SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
                            WHERE a.grantee = r.oid AND a.privilege_type = p.privilege_type),
                    EXISTS (SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
                            WHERE a.grantee = 0 AND a.privilege_type = p.privilege_type)
             FROM pg_database d
             CROSS JOIN (VALUES ('CONNECT'), ('CREATE'), ('TEMPORARY')) AS p(privilege_type)
             CROSS JOIN (SELECT oid FROM pg_roles WHERE rolname = $1) r
             WHERE NOT d.datistemplate
             ORDER BY d.datname, p.privilege_type",
            &[&role_name],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    Ok(rows
        .iter()
        .map(|row| DbGrant {
            database: row.get(0),
            privilege: row.get(1),
            granted: row.get(2),
            via_public: row.get(3),
        })
        .collect())
}

/// Roles are cluster-wide, so "adding a user to a database" is granting it a
/// privilege on that database. pg_database is shared, so this works from any
/// connection to the cluster, not only from the database being granted.
pub async fn set_database_privilege(
    client: &deadpool_postgres::Client,
    database: &str,
    role_name: &str,
    privilege: &str,
    granted: bool,
) -> Result<(), AppError> {
    let privilege = match privilege {
        "CONNECT" => "CONNECT",
        "CREATE" => "CREATE",
        "TEMPORARY" => "TEMPORARY",
        other => {
            return Err(AppError::QueryFailed(format!(
                "Unknown database privilege '{other}'"
            )));
        }
    };

    let sql = if granted {
        format!(
            "GRANT {privilege} ON DATABASE {} TO {}",
            quote_ident(database),
            quote_ident(role_name)
        )
    } else {
        format!(
            "REVOKE {privilege} ON DATABASE {} FROM {}",
            quote_ident(database),
            quote_ident(role_name)
        )
    };

    client
        .batch_execute(&sql)
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))
}
