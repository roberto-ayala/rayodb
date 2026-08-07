import {
  Database,
  Key,
  Loader2,
  Pencil,
  Plus,
  Shield,
  ShieldCheck,
  ShieldX,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RoleEditor } from "@/components/role-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { DriverFactory } from "@/lib/database-driver";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/project-store";
import type { DbGrant, DefaultGrant, PgRole, RoleSpec, SchemaGrant, TableGrant } from "@/types";

/** What one can hold on a database, in the order the table shows them */
const DB_PRIVILEGES = ["CONNECT", "CREATE", "TEMPORARY"] as const;

/** Shared by the grant header and its rows so the two line up */
const GRANT_COLUMNS = "grid grid-cols-[8rem_12rem_1fr] items-start";

/** The seven a table can carry, in the order the matrix lays them out */
const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

/**
 * A checkbox that can also say "some": granting on a schema reaches the tables
 * that exist at that moment, so a schema drifts to partial as soon as one is
 * created. Clicking a partial box grants the rest.
 */
function TriStateBox({
  state,
  disabled,
  title,
  onChange,
}: {
  state: "none" | "some" | "all";
  disabled?: boolean;
  title?: string;
  onChange: (granted: boolean) => void;
}) {
  return (
    <Checkbox
      ref={(el) => {
        if (el) el.indeterminate = state === "some";
      }}
      checked={state === "all"}
      disabled={disabled}
      title={title}
      onChange={() => onChange(state !== "all")}
    />
  );
}

interface RolesPanelProps {
  projectId: string;
}

export function RolesPanel({ projectId }: RolesPanelProps) {
  const [roles, setRoles] = useState<PgRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [tableGrants, setTableGrants] = useState<TableGrant[]>([]);
  const [dbGrants, setDbGrants] = useState<DbGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PgRole | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [savingGrant, setSavingGrant] = useState(false);
  const [schemaGrants, setSchemaGrants] = useState<SchemaGrant[]>([]);
  const [defaultGrants, setDefaultGrants] = useState<DefaultGrant[]>([]);
  const projects = useProjectStore((s) => s.projects);
  const { menu, showMenu, closeMenu } = useContextMenu();

  const driver = projects[projectId] ? DriverFactory.getDriver(projects[projectId].driver) : null;

  const refresh = useCallback(async () => {
    if (!driver) return [] as PgRole[];
    const r = (await driver.loadRoles?.(projectId)) ?? [];
    setRoles(r);
    return r;
  }, [driver, projectId]);

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  const selectRole = useCallback(
    async (name: string) => {
      setSelectedRole(name);
      setConfirmDrop(false);
      if (!driver) return;
      const [tg, dg, sg, defg] = await Promise.all([
        driver.loadTableGrants?.(projectId, name) ?? Promise.resolve([]),
        driver.loadDatabaseGrants?.(projectId, name) ?? Promise.resolve([]),
        driver.loadSchemaTableGrants?.(projectId, name) ?? Promise.resolve([]),
        driver.loadDefaultTableGrants?.(projectId, name) ?? Promise.resolve([]),
      ]);
      setTableGrants(tg);
      setDbGrants(dg);
      setSchemaGrants(sg);
      setDefaultGrants(defg);
    },
    [driver, projectId],
  );

  const databases = Array.from(new Set(dbGrants.map((g) => g.database)));
  // Both listings cover every schema, so either one names them all
  const schemaNames = Array.from(
    new Set([...schemaGrants.map((g) => g.schema), ...defaultGrants.map((g) => g.schema)]),
  ).sort();

  const toggleGrant = useCallback(
    async (database: string, privilege: string, granted: boolean) => {
      if (!driver || !selectedRole) return;
      setSavingGrant(true);
      try {
        await driver.setDatabasePrivilege?.(projectId, database, selectedRole, privilege, granted);
        const refreshed = await driver.loadDatabaseGrants?.(projectId, selectedRole);
        setDbGrants(refreshed ?? []);
      } catch (err: unknown) {
        toast.error(`Could not change ${privilege} on "${database}"`, {
          description: err instanceof Error ? err.message : String(err),
          duration: 10000,
        });
      } finally {
        setSavingGrant(false);
      }
    },
    [driver, projectId, selectedRole],
  );

  const reloadTablePrivileges = useCallback(
    async (role: string) => {
      if (!driver) return;
      const [tg, sg, defg] = await Promise.all([
        driver.loadTableGrants?.(projectId, role) ?? Promise.resolve([]),
        driver.loadSchemaTableGrants?.(projectId, role) ?? Promise.resolve([]),
        driver.loadDefaultTableGrants?.(projectId, role) ?? Promise.resolve([]),
      ]);
      setTableGrants(tg);
      setSchemaGrants(sg);
      setDefaultGrants(defg);
    },
    [driver, projectId],
  );

  /** Runs a privilege change and refreshes what it touched, reporting failures */
  const runPrivilegeChange = useCallback(
    async (label: string, change: () => Promise<string | undefined>, role: string) => {
      setSavingGrant(true);
      try {
        const message = await change();
        await reloadTablePrivileges(role);
        if (message) toast.success(message);
      } catch (err: unknown) {
        toast.error(label, {
          description: err instanceof Error ? err.message : String(err),
          duration: 10000,
        });
      } finally {
        setSavingGrant(false);
      }
    },
    [reloadTablePrivileges],
  );

  const toggleSchemaGrant = useCallback(
    (schema: string, privilege: string, granted: boolean) => {
      if (!driver || !selectedRole) return;
      void runPrivilegeChange(
        `Could not change ${privilege} on "${schema}"`,
        () =>
          driver.setSchemaTablePrivilege?.(projectId, schema, selectedRole, privilege, granted) ??
          Promise.resolve(undefined),
        selectedRole,
      );
    },
    [driver, projectId, selectedRole, runPrivilegeChange],
  );

  const toggleDefaultGrant = useCallback(
    (schema: string, privilege: string, granted: boolean) => {
      if (!driver || !selectedRole) return;
      void runPrivilegeChange(
        `Could not change the default ${privilege} in "${schema}"`,
        () =>
          driver.setDefaultTablePrivilege?.(projectId, schema, selectedRole, privilege, granted) ??
          Promise.resolve(undefined),
        selectedRole,
      );
    },
    [driver, projectId, selectedRole, runPrivilegeChange],
  );

  const revokeOnTable = useCallback(
    (schema: string, table: string) => {
      if (!driver || !selectedRole) return;
      void runPrivilegeChange(
        `Could not revoke on "${schema}"."${table}"`,
        () =>
          driver.revokeTablePrivileges?.(projectId, schema, table, selectedRole) ??
          Promise.resolve(undefined),
        selectedRole,
      );
    },
    [driver, projectId, selectedRole, runPrivilegeChange],
  );

  const saveRole = useCallback(
    async (spec: RoleSpec) => {
      if (!driver) return;
      const message = editing
        ? await driver.alterRole?.(projectId, spec)
        : await driver.createRole?.(projectId, spec);
      await refresh();
      setSelectedRole(spec.name);
      toast.success(message ?? "Role saved");
    },
    [driver, projectId, editing, refresh],
  );

  const dropRole = useCallback(
    async (name: string) => {
      if (!driver) return;
      try {
        const message = await driver.dropRole?.(projectId, name);
        await refresh();
        setSelectedRole(null);
        setConfirmDrop(false);
        toast.success(message ?? "Role dropped");
      } catch (err: unknown) {
        // Postgres refuses while the role still owns objects, and that message
        // is the useful part — it names what is in the way.
        toast.error(`Could not drop "${name}"`, {
          description: err instanceof Error ? err.message : String(err),
          duration: 10000,
        });
      }
    },
    [driver, projectId, refresh],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-card text-sm text-muted-foreground">
        Loading roles...
      </div>
    );
  }

  const selected = roles.find((r) => r.name === selectedRole);

  return (
    <div className="flex h-full bg-background">
      {/* Role list */}
      <div className="w-[240px] shrink-0 overflow-y-auto border-r border-border bg-background">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">
            Roles ({roles.length})
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="New role"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        {roles.map((role) => (
          <button
            key={role.name}
            type="button"
            onClick={() => selectRole(role.name)}
            className={cn(
              "flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs transition-colors",
              selectedRole === role.name
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-muted/30",
            )}
          >
            {role.superuser ? (
              <ShieldCheck className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            ) : role.login ? (
              <User className="h-3.5 w-3.5 text-primary shrink-0" />
            ) : (
              <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="truncate">{role.name}</span>
            {role.superuser && (
              <span className="ml-auto text-3xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500">
                SUPER
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {/* The detail sits on the card surface so its tables and chips read
          against something plain, the way the other panels present content */}
      <div className="flex-1 overflow-y-auto bg-card p-4">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
            Select a role
          </div>
        ) : (
          <div className="space-y-5 max-w-[800px]">
            {/* Header */}
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center",
                  selected.superuser ? "bg-amber-500/10" : "bg-primary/10",
                )}
              >
                {selected.superuser ? (
                  <ShieldCheck className="h-5 w-5 text-amber-500" />
                ) : (
                  <Shield className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <div className="font-semibold text-lg">{selected.name}</div>
                <div className="text-xs text-muted-foreground">
                  {selected.login ? "Login role" : "Group role"}
                  {selected.conn_limit >= 0 && ` (max ${selected.conn_limit} connections)`}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {confirmDrop ? (
                  <>
                    <span className="text-xs text-muted-foreground">Drop this role?</span>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="text-xs"
                      onClick={() => void dropRole(selected.name)}
                    >
                      Drop
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => setConfirmDrop(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setEditing(selected);
                        setEditorOpen(true);
                      }}
                    >
                      <Pencil className="mr-1.5 h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Drop role"
                      onClick={() => setConfirmDrop(true)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Attributes */}
            <div>
              <div className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Attributes
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { label: "SUPERUSER", active: selected.superuser },
                    { label: "CREATEDB", active: selected.create_db },
                    { label: "CREATEROLE", active: selected.create_role },
                    { label: "LOGIN", active: selected.login },
                    { label: "REPLICATION", active: selected.replication },
                    { label: "BYPASSRLS", active: selected.bypass_rls },
                  ] as const
                ).map(({ label, active }) => (
                  <span
                    key={label}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-3xs",
                      active
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "bg-muted/30 text-muted-foreground/40 border border-border/60",
                    )}
                  >
                    {active ? (
                      <ShieldCheck className="h-2.5 w-2.5" />
                    ) : (
                      <ShieldX className="h-2.5 w-2.5" />
                    )}
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Member of */}
            {selected.member_of.length > 0 && (
              <div>
                <div className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Member of
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.member_of.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => selectRole(g)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/50 text-xs hover:bg-accent transition-colors"
                    >
                      <Users className="h-2.5 w-2.5" /> {g}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Database access */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Database Access
                </span>
                {savingGrant && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <div className="overflow-hidden rounded-lg border border-border/60">
                <table className="w-full text-xs">
                  <thead>
                    {/* Opaque, or the rows show through it */}
                    <tr className="bg-muted">
                      {/* This column takes the slack so the privilege columns
                          hug their labels and leave no gap at the end */}
                      <th className="w-full px-3 py-1.5 text-left font-medium text-muted-foreground">
                        Database
                      </th>
                      {DB_PRIVILEGES.map((p) => (
                        <th
                          key={p}
                          className="whitespace-nowrap px-3 py-1.5 text-center font-medium text-muted-foreground"
                        >
                          {p}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {databases.map((db) => (
                      <tr key={db} className="border-t border-border/60">
                        <td className="px-3 py-1">
                          <Database className="mr-1.5 inline h-3 w-3 text-muted-foreground/50" />
                          {db}
                        </td>
                        {DB_PRIVILEGES.map((priv) => {
                          const grant = dbGrants.find(
                            (g) => g.database === db && g.privilege === priv,
                          );
                          return (
                            <td key={priv} className="px-3 py-1">
                              <span className="flex items-center justify-center gap-1.5">
                                <Checkbox
                                  checked={grant?.granted ?? false}
                                  disabled={savingGrant}
                                  onChange={(e) => void toggleGrant(db, priv, e.target.checked)}
                                />
                                {/* A role usually reaches a database through
                                    PUBLIC, and revoking its own grant would not
                                    take that away — so say where it comes from */}
                                {!grant?.granted && grant?.via_public && (
                                  <span className="text-3xs text-muted-foreground/60">
                                    via PUBLIC
                                  </span>
                                )}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-3xs text-muted-foreground/60">
                Roles belong to the server, not to one database. Granting CONNECT is what lets this
                role into a database.
              </p>
            </div>

            {/* Table access by schema */}
            <div>
              <div className="mb-2 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                Table Access
              </div>
              {/* One grid for header and rows together, so the columns size
                  themselves to the privilege names and still line up — as two
                  grids they could only have matched on fixed widths, which is
                  what forced the names to be abbreviated */}
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <div className="grid min-w-max grid-cols-[minmax(8rem,1fr)_auto_repeat(7,auto)] text-xs">
                  <span className="bg-muted px-3 py-1.5 font-medium text-muted-foreground">
                    Schema
                  </span>
                  <span className="bg-muted px-3 py-1.5 font-medium text-muted-foreground">
                    Applies to
                  </span>
                  {TABLE_PRIVILEGES.map((p) => (
                    <span
                      key={p}
                      className="bg-muted px-2.5 py-1.5 text-center text-3xs font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {p}
                    </span>
                  ))}

                  {schemaNames.map((schema) => {
                    const stateOf = (privilege: string) => {
                      const g = schemaGrants.find(
                        (x) => x.schema === schema && x.privilege === privilege,
                      );
                      if (!g || g.granted === 0) return "none" as const;
                      return g.granted >= g.total ? ("all" as const) : ("some" as const);
                    };
                    const counts = (privilege: string) => {
                      const g = schemaGrants.find(
                        (x) => x.schema === schema && x.privilege === privilege,
                      );
                      return g ? `${g.granted} of ${g.total} tables` : "no tables";
                    };

                    return (
                      <Fragment key={schema}>
                        <span
                          className="truncate border-t border-border/60 px-3 py-1 font-medium"
                          title={schema}
                        >
                          {schema}
                        </span>
                        <span className="whitespace-nowrap border-t border-border/60 px-3 py-1 text-muted-foreground">
                          Existing tables
                        </span>
                        {TABLE_PRIVILEGES.map((p) => (
                          <span
                            key={p}
                            className="flex justify-center border-t border-border/60 px-2.5 py-1"
                          >
                            <TriStateBox
                              state={stateOf(p)}
                              disabled={savingGrant}
                              title={counts(p)}
                              onChange={(granted) => toggleSchemaGrant(schema, p, granted)}
                            />
                          </span>
                        ))}

                        {/* GRANT reaches what exists; only default privileges
                            reach what has not been created yet */}
                        <span className="px-3 py-1" />
                        <span className="whitespace-nowrap px-3 py-1 text-muted-foreground">
                          New tables
                        </span>
                        {TABLE_PRIVILEGES.map((p) => (
                          <span key={p} className="flex justify-center px-2.5 py-1">
                            <TriStateBox
                              state={
                                defaultGrants.find((x) => x.schema === schema && x.privilege === p)
                                  ?.granted
                                  ? "all"
                                  : "none"
                              }
                              disabled={savingGrant}
                              title={`Tables created in ${schema} from now on`}
                              onChange={(granted) => toggleDefaultGrant(schema, p, granted)}
                            />
                          </span>
                        ))}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
              <p className="mt-1.5 text-3xs text-muted-foreground/60">
                Granting on a schema reaches the tables that exist now — a partial box means new
                ones appeared since. "New tables" sets the default privileges that tables created
                from this connection will carry.
              </p>
            </div>

            {/* Table grants */}
            {tableGrants.length === 0 ? (
              <div>
                <div className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Table Privileges
                </div>
                <div className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground/60">
                  No table privileges in {projects[projectId]?.database ?? "this database"}. Grant
                  them from a query, or through a group this role belongs to.
                </div>
              </div>
            ) : (
              <div>
                <div className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Table Privileges ({tableGrants.length})
                </div>
                {/* Header and rows are separate grids sharing one column
                    template: only the rows scroll, so the header keeps its
                    place and the scrollbar stops below it. The flexible column
                    is the last one, so what the scrollbar takes comes off the
                    right edge rather than shifting the columns out of line */}
                <div className="overflow-hidden rounded-lg border border-border/60">
                  <div className={cn(GRANT_COLUMNS, "bg-muted text-xs text-muted-foreground")}>
                    <span className="px-3 py-1.5 font-medium">Schema</span>
                    <span className="px-3 py-1.5 font-medium">Table</span>
                    <span className="px-3 py-1.5 font-medium">Privileges</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {tableGrants.map((g) => (
                      // biome-ignore lint/a11y/noStaticElementInteractions: the row is a listing; only its context menu acts
                      <div
                        key={`${g.schema}.${g.table}`}
                        className={cn(
                          GRANT_COLUMNS,
                          "border-t border-border/60 text-xs hover:bg-muted/30",
                        )}
                        onContextMenu={(e) =>
                          showMenu(e, [
                            { header: `${g.schema}.${g.table}` },
                            {
                              label: "Revoke all privileges",
                              icon: <ShieldX className="h-3 w-3" />,
                              onClick: () => revokeOnTable(g.schema, g.table),
                              destructive: true,
                            },
                          ])
                        }
                      >
                        <span className="truncate px-3 py-1 text-muted-foreground">{g.schema}</span>
                        <span className="truncate px-3 py-1">{g.table}</span>
                        <div className="flex flex-wrap gap-1 px-3 py-1">
                          {g.privileges.map((p) => (
                            <span key={p} className="rounded bg-primary/5 px-1.5 py-0.5 text-3xs">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {selected.valid_until && (
              <div className="text-xs text-muted-foreground">
                <Key className="h-3 w-3 inline mr-1" />
                Password valid until: {selected.valid_until}
              </div>
            )}
          </div>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      <RoleEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        roles={roles}
        onSave={saveRole}
      />
    </div>
  );
}
