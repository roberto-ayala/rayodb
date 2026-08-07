import {
  Activity,
  Columns3,
  Copy,
  Database,
  Edit3,
  HardDrive,
  Link2,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Trash2,
  Unplug,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectDetails } from "@/types";
import { ProjectConnectionStatus } from "@/types";
import { I } from "./constants";
import { renderSchemas } from "./render-schema-objects";
import { TreeRow } from "./tree-row";
import type { SidebarRenderCtx } from "./types";

/**
 * Render a single server-fingerprint group with its databases, roles
 * and tablespaces. Auto-grouping by host:port:user:ssh fingerprint.
 */
export function renderServerGroup(ctx: SidebarRenderCtx, fp: string, pids: string[]) {
  const {
    projects,
    status,
    serverDatabases,
    serverTablespaces,
    eventTriggers,
    isOpen,
    toggle,
    onConnect,
    onDisconnect,
    addDatabaseToServer,
    deleteProject,
    refreshConnection,
    openTab,
    openMonitorTab,
    openNotifyTab,
    openRolesTab,
    openSchemaDiffTab,
    openExtensionsTab,
    openPgSettingsTab,
    setAddDbSource,
    showMenu,
    copy,
    onEditConnection,
  } = ctx;

  const primaryDetails: ProjectDetails | undefined = projects[pids[0]];
  if (!primaryDetails) return null;

  const gKey = `srv::${fp}`;
  const dbCatKey = `${gKey}::databases`;

  // The group is named after the connection it was configured as; the address
  // it resolves to rides along as muted context.
  const serverLabel = pids[0];
  const serverAddress = `${primaryDetails.host}:${primaryDetails.port}`;
  const connectedPid = pids.find((p) => status[p] === ProjectConnectionStatus.Connected);

  // Union of databases discovered from pg_database + ones we have a project for
  const discoveredDbs = new Set<string>();
  for (const pid of pids) {
    const dbs = serverDatabases[pid];
    if (dbs)
      dbs.forEach((db) => {
        discoveredDbs.add(db);
      });
    const d = projects[pid];
    if (d?.database) discoveredDbs.add(d.database);
  }
  const dbToProject = new Map<string, string>();
  for (const pid of pids) {
    const d = projects[pid];
    if (d?.database) dbToProject.set(d.database, pid);
  }
  const allDbs = Array.from(discoveredDbs).sort();

  const anyConnected = pids.some((p) => status[p] === ProjectConnectionStatus.Connected);
  const anyConnecting = pids.some((p) => status[p] === ProjectConnectionStatus.Connecting);

  // Connecting "the server" means opening its default database — the one the
  // connection was configured with.
  const defaultPid = pids[0];
  const defaultDatabase = primaryDetails.database;

  return (
    <div key={gKey}>
      <TreeRow
        indent={I.server}
        icon={
          <Server
            className={cn(
              "h-3.5 w-3.5",
              anyConnected ? "text-success" : anyConnecting ? "text-warning" : "text-primary",
            )}
          />
        }
        label={serverLabel}
        meta={`(${serverAddress})`}
        bold
        expanded={isOpen(gKey, true)}
        onClick={() => toggle(gKey, true)}
        onContextMenu={(e) =>
          showMenu(e, [
            { header: "Server" },
            ...(anyConnected || anyConnecting
              ? []
              : [
                  {
                    label: defaultDatabase ? `Connect (${defaultDatabase})` : "Connect",
                    icon: <Link2 className="h-3 w-3" />,
                    onClick: () => void onConnect(defaultPid),
                  },
                ]),
            ...(connectedPid
              ? [
                  {
                    label: "New Query",
                    icon: <Plus className="h-3 w-3" />,
                    onClick: () => openTab(connectedPid),
                  },
                  {
                    label: "Performance Monitor",
                    icon: <Activity className="h-3 w-3" />,
                    onClick: () => openMonitorTab(connectedPid),
                  },
                  {
                    label: "PG Settings",
                    icon: <Settings className="h-3 w-3" />,
                    onClick: () => openPgSettingsTab(connectedPid),
                  },
                ]
              : []),
            {
              label: "Add Database",
              icon: <Plus className="h-3 w-3" />,
              onClick: () => setAddDbSource(pids[0]),
            },
            ...(anyConnected
              ? [
                  {
                    label: "Disconnect",
                    icon: <Unplug className="h-3 w-3" />,
                    onClick: () => {
                      for (const pid of pids) {
                        if (status[pid] === ProjectConnectionStatus.Connected)
                          void onDisconnect(pid);
                      }
                    },
                  },
                ]
              : []),
            ...(onEditConnection
              ? [
                  {
                    label: "Edit Connection",
                    icon: <Edit3 className="h-3 w-3" />,
                    onClick: () => onEditConnection(pids[0]),
                  },
                ]
              : []),
            { separator: true as const },
            {
              label: "Copy Name",
              icon: <Copy className="h-3 w-3" />,
              onClick: () => copy(serverLabel),
            },
            { separator: true as const },
            {
              label: "Delete",
              icon: <Trash2 className="h-3 w-3" />,
              onClick: () => {
                for (const pid of pids) void deleteProject(pid);
              },
              destructive: true,
            },
          ])
        }
      />

      {isOpen(gKey, true) && (
        <>
          <TreeRow
            indent={I.cat}
            icon={<Database className="h-3.5 w-3.5 text-muted-foreground" />}
            label={`Databases${allDbs.length > 0 ? ` (${allDbs.length})` : ""}`}
            expanded={isOpen(dbCatKey, true)}
            onClick={() => toggle(dbCatKey, true)}
          />

          {isOpen(dbCatKey, true) &&
            allDbs.map((dbName) => {
              const dbPid = dbToProject.get(dbName);
              const dbKey = `db::${fp}::${dbName}`;

              if (dbPid) {
                const dbConn = status[dbPid];
                const isDbConnected = dbConn === ProjectConnectionStatus.Connected;
                const isDbConnecting = dbConn === ProjectConnectionStatus.Connecting;
                const isDbFailed = dbConn === ProjectConnectionStatus.Failed;
                return (
                  <div key={dbName}>
                    <TreeRow
                      indent={I.db}
                      icon={
                        isDbConnecting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <Database
                            className={cn(
                              "h-3.5 w-3.5",
                              isDbConnected
                                ? "text-success"
                                : isDbFailed
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                            )}
                          />
                        )
                      }
                      label={dbName}
                      expanded={isDbConnected ? isOpen(dbKey, true) : undefined}
                      onClick={() => {
                        if (!isDbConnected && !isDbConnecting) void onConnect(dbPid);
                        else if (isDbConnected) toggle(dbKey, true);
                      }}
                      onContextMenu={(e) =>
                        showMenu(e, [
                          { header: "Database" },
                          {
                            label: "New Query",
                            icon: <Plus className="h-3 w-3" />,
                            onClick: () => openTab(dbPid),
                          },
                          {
                            label: isDbConnected ? "Reconnect" : "Connect",
                            icon: <RefreshCw className="h-3 w-3" />,
                            onClick: () => void onConnect(dbPid),
                          },
                          ...(isDbConnected
                            ? [
                                {
                                  label: "Refresh",
                                  icon: <RefreshCw className="h-3 w-3" />,
                                  onClick: () => void refreshConnection(dbPid),
                                },
                                {
                                  label: "Disconnect",
                                  icon: <Unplug className="h-3 w-3" />,
                                  onClick: () => void onDisconnect(dbPid),
                                },
                                {
                                  label: "LISTEN/NOTIFY",
                                  icon: <Zap className="h-3 w-3" />,
                                  onClick: () => openNotifyTab(dbPid),
                                },
                                {
                                  label: "Schema Diff",
                                  icon: <Columns3 className="h-3 w-3" />,
                                  onClick: () => openSchemaDiffTab(dbPid),
                                },
                                {
                                  label: "Extensions",
                                  icon: <Package className="h-3 w-3" />,
                                  onClick: () => openExtensionsTab(dbPid),
                                },
                                // Roles belong to the server, not to this
                                // database — reachable from here, but not a
                                // branch of it
                                {
                                  label: "Server Roles",
                                  icon: <Shield className="h-3 w-3" />,
                                  onClick: () => openRolesTab(dbPid),
                                },
                              ]
                            : []),
                          ...(onEditConnection
                            ? [
                                { separator: true as const },
                                {
                                  label: "Edit Connection",
                                  icon: <Edit3 className="h-3 w-3" />,
                                  onClick: () => onEditConnection(dbPid),
                                },
                              ]
                            : []),
                          { separator: true as const },
                          {
                            label: "Copy Name",
                            icon: <Copy className="h-3 w-3" />,
                            onClick: () => copy(dbName),
                          },
                          { separator: true as const },
                          {
                            label: "Delete",
                            icon: <Trash2 className="h-3 w-3" />,
                            onClick: () => void deleteProject(dbPid),
                            destructive: true,
                          },
                        ])
                      }
                    />

                    {isDbConnected && isOpen(dbKey, true) && (
                      <>
                        {renderSchemas(ctx, dbPid)}
                        {/* Event triggers fire on DDL anywhere in the database,
                            so they sit beside the schemas rather than inside one */}
                        {(eventTriggers[dbPid]?.length ?? 0) > 0 && (
                          <>
                            <TreeRow
                              indent={I.schema}
                              icon={<Zap className="h-3.5 w-3.5 text-muted-foreground" />}
                              label={`Event Triggers (${eventTriggers[dbPid].length})`}
                              expanded={isOpen(`${dbKey}::evttrig`)}
                              onClick={() => toggle(`${dbKey}::evttrig`)}
                            />
                            {isOpen(`${dbKey}::evttrig`) &&
                              eventTriggers[dbPid].map((evt) => (
                                // biome-ignore lint/a11y/noStaticElementInteractions: a label with a context menu, like the function rows
                                <div
                                  key={evt.name}
                                  className="relative flex items-center gap-1.5 py-0.5 rounded-sm whitespace-nowrap select-none hover:bg-sidebar-accent"
                                  style={{ paddingLeft: `${I.schemaObj}px` }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    showMenu(e, [
                                      { header: evt.event },
                                      {
                                        label: "Copy Name",
                                        icon: <Copy className="h-3 w-3" />,
                                        onClick: () => copy(evt.name),
                                      },
                                      {
                                        label: "Copy Function Name",
                                        icon: <Copy className="h-3 w-3" />,
                                        onClick: () => copy(evt.function),
                                      },
                                    ]);
                                  }}
                                >
                                  <Zap className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                                  <span className="text-xs text-foreground">{evt.name}</span>
                                  <span className="text-3xs text-muted-foreground">
                                    {evt.event}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-3xs",
                                      evt.enabled === "enabled"
                                        ? "text-muted-foreground/40"
                                        : "text-warning",
                                    )}
                                  >
                                    {evt.enabled === "enabled" ? evt.function : evt.enabled}
                                  </span>
                                </div>
                              ))}
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              } else {
                // No project entry yet — clicking auto-creates one
                return (
                  <TreeRow
                    key={dbName}
                    indent={I.db}
                    icon={<Database className="h-3.5 w-3.5 text-muted-foreground/50" />}
                    label={dbName}
                    onClick={() => void addDatabaseToServer(pids[0], dbName, dbName)}
                    onContextMenu={(e) =>
                      showMenu(e, [
                        {
                          label: "Connect",
                          icon: <Link2 className="h-3 w-3" />,
                          onClick: () => void addDatabaseToServer(pids[0], dbName, dbName),
                        },
                        {
                          label: "Copy Name",
                          icon: <Copy className="h-3 w-3" />,
                          onClick: () => copy(dbName),
                        },
                      ])
                    }
                  />
                );
              }
            })}

          <TreeRow
            indent={I.cat}
            icon={<Shield className="h-3.5 w-3.5 text-muted-foreground" />}
            label="Login/Group Roles"
            onClick={() => {
              if (connectedPid) {
                openRolesTab(connectedPid);
              } else {
                void onConnect(pids[0]).then(() => {
                  const p = pids.find((id) => status[id] === ProjectConnectionStatus.Connected);
                  if (p) openRolesTab(p);
                });
              }
            }}
          />

          {(() => {
            const tspCatKey = `${gKey}::tablespaces`;
            const tspData = connectedPid ? serverTablespaces[connectedPid] || [] : [];
            return (
              <>
                <TreeRow
                  indent={I.cat}
                  icon={<HardDrive className="h-3.5 w-3.5 text-muted-foreground" />}
                  label={`Tablespaces${tspData.length > 0 ? ` (${tspData.length})` : ""}`}
                  expanded={isOpen(tspCatKey)}
                  onClick={() => {
                    if (connectedPid) {
                      toggle(tspCatKey);
                    } else {
                      void onConnect(pids[0]);
                    }
                  }}
                />
                {isOpen(tspCatKey) &&
                  tspData.map(([name, owner, location]) => (
                    <div
                      key={name}
                      className="relative flex items-center gap-1.5 py-0.5 hover:bg-sidebar-accent rounded-sm whitespace-nowrap"
                      style={{ paddingLeft: `${I.db}px` }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showMenu(e, [
                          {
                            label: "Copy Name",
                            icon: <Copy className="h-3 w-3" />,
                            onClick: () => copy(name),
                          },
                        ]);
                      }}
                    >
                      <HardDrive className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                      <span className="text-xs text-foreground">{name}</span>
                      <span className="text-3xs text-muted-foreground">{owner}</span>
                      {location && (
                        <span className="text-3xs text-muted-foreground/40">{location}</span>
                      )}
                    </div>
                  ))}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
