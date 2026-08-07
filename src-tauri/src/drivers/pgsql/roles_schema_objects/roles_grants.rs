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
}

pub async fn load_database_grants(
    client: &deadpool_postgres::Client,
    role_name: &str,
) -> Result<Vec<DbGrant>, AppError> {
    let rows = client
        .query(
            "SELECT datname, privilege_type
             FROM pg_database
             CROSS JOIN LATERAL (
               SELECT privilege_type
               FROM (VALUES ('CONNECT'), ('CREATE'), ('TEMPORARY')) AS privs(privilege_type)
               WHERE has_database_privilege($1, datname, privilege_type)
             ) t
             WHERE NOT datistemplate
             ORDER BY datname, privilege_type",
            &[&role_name],
        )
        .await
        .map_err(|e| AppError::QueryFailed(pg_error_message(&e)))?;

    let mut grants = Vec::new();
    for row in rows {
        grants.push(DbGrant {
            database: row.get(0),
            privilege: row.get(1),
        });
    }

    Ok(grants)
}
