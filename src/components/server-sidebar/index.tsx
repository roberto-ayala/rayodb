import { Plus } from "lucide-react";
import React from "react";
import { CSVImportModal } from "@/components/csv-import-modal";
import { ObjectPropertiesModal } from "@/components/object-properties-modal";
import { Button } from "@/components/ui/button";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { serverFingerprint } from "@/lib/server-group";
import { useProjectStore } from "@/stores/project-store";
import { useQueryStore } from "@/stores/query-store";
import { useTabStore } from "@/stores/tab-store";
import { useUIStore } from "@/stores/ui-store";
import { ProjectConnectionStatus } from "@/types";
import { AddDatabaseDialog } from "./add-database-dialog";
import { renderSavedQueries } from "./render-saved-queries";
import { renderServerGroup } from "./render-server-group";
import type { CsvImportTarget, ObjectKind, PropsModalState, SidebarRenderCtx } from "./types";

export function ServerSidebar({
  onEditConnection,
}: {
  onEditConnection?: (projectId: string) => void;
}) {
  const projects = useProjectStore((s) => s.projects);
  const status = useProjectStore((s) => s.status);
  const serverDatabases = useProjectStore((s) => s.serverDatabases);
  const serverTablespaces = useProjectStore((s) => s.serverTablespaces);
  const schemas = useProjectStore((s) => s.schemas);
  const tables = useProjectStore((s) => s.tables);
  const columnDetails = useProjectStore((s) => s.columnDetails);
  const indexes = useProjectStore((s) => s.indexes);
  const views = useProjectStore((s) => s.views);
  const materializedViews = useProjectStore((s) => s.materializedViews);
  const sequences = useProjectStore((s) => s.sequences);
  const functions = useProjectStore((s) => s.functions);
  const procedures = useProjectStore((s) => s.procedures);
  const dataTypes = useProjectStore((s) => s.dataTypes);
  const foreignTables = useProjectStore((s) => s.foreignTables);
  const eventTriggers = useProjectStore((s) => s.eventTriggers);
  const triggerFunctions = useProjectStore((s) => s.triggerFunctions);
  const connect = useProjectStore((s) => s.connect);
  const disconnect = useProjectStore((s) => s.disconnect);
  const loadTables = useProjectStore((s) => s.loadTables);
  const loadColumns = useProjectStore((s) => s.loadColumns);
  const loadTableColumns = useProjectStore((s) => s.loadTableColumns);
  const loadSchemaObjects = useProjectStore((s) => s.loadSchemaObjects);
  const refreshConnection = useProjectStore((s) => s.refreshConnection);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const addDatabaseToServer = useProjectStore((s) => s.addDatabaseToServer);
  const setConnectionModalOpen = useUIStore((s) => s.setConnectionModalOpen);
  const openTab = useTabStore((s) => s.openTab);
  const pinTab = useTabStore((s) => s.pinTab);
  const openMonitorTab = useTabStore((s) => s.openMonitorTab);
  const openERDTab = useTabStore((s) => s.openERDTab);
  const openNotifyTab = useTabStore((s) => s.openNotifyTab);
  const openRolesTab = useTabStore((s) => s.openRolesTab);
  const openSchemaDiffTab = useTabStore((s) => s.openSchemaDiffTab);
  const openExtensionsTab = useTabStore((s) => s.openExtensionsTab);
  const openPgSettingsTab = useTabStore((s) => s.openPgSettingsTab);
  const savedQueries = useQueryStore((s) => s.queries);
  const loadQueries = useQueryStore((s) => s.loadQueries);
  const queriesLoaded = useQueryStore((s) => s.loaded);
  const removeQuery = useQueryStore((s) => s.removeQuery);
  const { menu, showMenu, closeMenu } = useContextMenu();

  const [propsModal, setPropsModal] = React.useState<PropsModalState>({
    open: false,
    objectType: "table",
    projectId: "",
    schema: "",
    name: "",
  });

  const openProperties = (
    objectType: ObjectKind,
    projectId: string,
    schema: string,
    name: string,
  ) => {
    setPropsModal({ open: true, objectType, projectId, schema, name });
  };

  const [csvImportTarget, setCsvImportTarget] = React.useState<CsvImportTarget | null>(null);

  React.useEffect(() => {
    if (!queriesLoaded) void loadQueries();
  }, [queriesLoaded, loadQueries]);

  const [addDbSource, setAddDbSource] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState<Record<string, boolean>>({});
  const [selectedItem, setSelectedItem] = React.useState<string | null>(null);

  // Rows that render open by default have no entry until their first click, so
  // the toggle has to start from the same default the row was drawn with —
  // otherwise that first click writes the state it already looked like.
  const toggle = (key: string, defaultOpen = false) =>
    setExpanded((p) => ({ ...p, [key]: !(p[key] ?? defaultOpen) }));
  const isOpen = (key: string, defaultOpen = false) => expanded[key] ?? defaultOpen;

  const setLoad = (key: string, v: boolean) => setLoading((p) => ({ ...p, [key]: v }));

  const onConnect = async (projectId: string) => {
    setLoad(projectId, true);
    await connect(projectId);
    setLoad(projectId, false);
  };

  const onDisconnect = async (projectId: string) => {
    setLoad(projectId, true);
    await disconnect(projectId);
    setLoad(projectId, false);
  };

  /**
   * The tree keeps its expanded branches across a disconnect, but the cached
   * metadata goes with the connection — and it can come back through any route
   * (the sidebar, the palette, running a query, auto-connect on startup). So
   * rather than hooking each of them, refill whatever is rendered open and
   * empty; otherwise the branch stays hollow until it is collapsed and
   * expanded again.
   */
  const refilling = React.useRef(new Set<string>());
  React.useEffect(() => {
    const refill = (key: string, load: () => Promise<unknown>) => {
      if (refilling.current.has(key)) return;
      refilling.current.add(key);
      setLoading((p) => ({ ...p, [key]: true }));
      void load()
        .catch((e) => console.error("Failed to reload schema objects:", e))
        .finally(() => {
          refilling.current.delete(key);
          setLoading((p) => ({ ...p, [key]: false }));
        });
    };

    for (const [projectId, projectSchemas] of Object.entries(schemas)) {
      if (status[projectId] !== ProjectConnectionStatus.Connected) continue;

      for (const schema of projectSchemas) {
        const schemaKey = `schema::${projectId}::${schema}`;
        if (!expanded[schemaKey]) continue;

        const storeKey = `${projectId}::${schema}`;
        const schemaTables = tables[storeKey];
        if (!schemaTables) {
          refill(schemaKey, () =>
            Promise.all([loadTables(projectId, schema), loadSchemaObjects(projectId, schema)]),
          );
          continue;
        }

        for (const { name } of schemaTables) {
          const tableKey = `table::${projectId}::${schema}::${name}`;
          if (!expanded[tableKey] || columnDetails[`${storeKey}::${name}`]) continue;
          refill(tableKey, () => loadTableColumns(projectId, schema, name));
        }
      }
    }
  }, [
    expanded,
    schemas,
    status,
    tables,
    columnDetails,
    loadTables,
    loadSchemaObjects,
    loadTableColumns,
  ]);

  // Expanding is just state: the effect above fetches whatever is open and empty.
  const onExpandSchema = (projectId: string, schema: string) => {
    toggle(`schema::${projectId}::${schema}`);
  };

  const onExpandTable = (projectId: string, schema: string, table: string) => {
    toggle(`table::${projectId}::${schema}::${table}`);
  };

  const selectQuery = (schema: string, table: string) =>
    `SELECT * FROM "${schema}"."${table}" LIMIT 100;`;

  const onOpenTableQuery = (projectId: string, schema: string, table: string) => {
    openTab(projectId, selectQuery(schema, table));
  };

  /** A single click browses: it reuses the preview tab and names it after the object */
  const onPreviewTableQuery = (projectId: string, schema: string, table: string) => {
    openTab(projectId, selectQuery(schema, table), {
      preview: true,
      title: `${schema}.${table}`,
    });
  };

  const onPinPreview = () => pinTab(useTabStore.getState().selectedTabIndex);

  const copy = (text: string) => navigator.clipboard.writeText(text);

  const ctx: SidebarRenderCtx = {
    projects,
    status,
    serverDatabases,
    serverTablespaces,
    schemas,
    tables,
    columnDetails,
    indexes,
    views,
    materializedViews,
    sequences,
    functions,
    procedures,
    dataTypes,
    foreignTables,
    eventTriggers,
    triggerFunctions,
    connect,
    disconnect,
    loadColumns,
    refreshConnection,
    deleteProject,
    addDatabaseToServer,
    openTab,
    openMonitorTab,
    openERDTab,
    openNotifyTab,
    openRolesTab,
    openSchemaDiffTab,
    openExtensionsTab,
    openPgSettingsTab,
    loading,
    selectedItem,
    setSelectedItem,
    setCsvImportTarget,
    setAddDbSource,
    openProperties,
    toggle,
    isOpen,
    onConnect,
    onDisconnect,
    onExpandSchema,
    onExpandTable,
    onOpenTableQuery,
    onPreviewTableQuery,
    onPinPreview,
    copy,
    showMenu,
    onEditConnection,
  };

  return (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar select-none">
      <div className="flex h-12 items-center justify-between border-b border-sidebar-border px-3">
        <span className="tracking-widest uppercase text-3xs font-semibold text-sidebar-foreground">
          CONNECTIONS
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setConnectionModalOpen(true)}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-auto p-1">
        {(() => {
          const entries = Object.entries(projects);
          // Auto-group by server fingerprint (host:port:user:ssh)
          const serverGroups = new Map<string, string[]>();
          for (const [pid, d] of entries) {
            const fp = serverFingerprint(d);
            if (!serverGroups.has(fp)) serverGroups.set(fp, []);
            serverGroups.get(fp)?.push(pid);
          }

          return (
            <>
              {Array.from(serverGroups.entries()).map(([fp, pids]) =>
                renderServerGroup(ctx, fp, pids),
              )}
            </>
          );
        })()}
      </div>

      {renderSavedQueries(ctx, savedQueries, removeQuery)}

      <AddDatabaseDialog
        open={!!addDbSource}
        onOpenChange={(open) => {
          if (!open) setAddDbSource(null);
        }}
        sourceProjectId={addDbSource ?? ""}
        projects={projects}
        onAdd={async (name, database) => {
          if (addDbSource) {
            await addDatabaseToServer(addDbSource, name, database);
            setAddDbSource(null);
          }
        }}
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
      <ObjectPropertiesModal
        open={propsModal.open}
        onOpenChange={(open) => setPropsModal((p) => ({ ...p, open }))}
        objectType={propsModal.objectType}
        projectId={propsModal.projectId}
        schema={propsModal.schema}
        name={propsModal.name}
      />
      {csvImportTarget && (
        <CSVImportModal
          open={!!csvImportTarget}
          onOpenChange={(open) => {
            if (!open) setCsvImportTarget(null);
          }}
          projectId={csvImportTarget.projectId}
          schema={csvImportTarget.schema}
          table={csvImportTarget.table}
          tableColumns={csvImportTarget.columns}
        />
      )}
    </div>
  );
}
