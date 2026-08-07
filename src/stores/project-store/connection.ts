import { toast } from "sonner";
import type { StateCreator } from "zustand";
import { DriverFactory } from "@/lib/database-driver";
import { ProjectConnectionStatus as PCS } from "@/types";
import type { ProjectState } from "./index";

export type ConnectionSlice = {
  connect: (projectId: string) => Promise<void>;
  disconnect: (projectId: string) => Promise<void>;
  refreshConnection: (projectId: string) => Promise<void>;
};

/** Drop every cached schema object belonging to a project. */
export function clearProjectMetadata(s: ProjectState, projectId: string) {
  const schemaPrefix = `${projectId}::`;
  const scoped = [
    s.tables,
    s.columns,
    s.columnDetails,
    s.indexes,
    s.constraints,
    s.triggers,
    s.rules,
    s.policies,
    s.views,
    s.materializedViews,
    s.sequences,
    s.functions,
    s.triggerFunctions,
  ] as Record<string, unknown>[];
  for (const bucket of scoped) {
    for (const key of Object.keys(bucket)) {
      if (key.startsWith(schemaPrefix)) delete bucket[key];
    }
  }

  delete s.schemas[projectId];
  delete s.serverDatabases[projectId];
  delete s.serverTablespaces[projectId];
}

export const createConnectionSlice: StateCreator<
  ProjectState,
  [["zustand/immer", never]],
  [],
  ConnectionSlice
> = (set, get) => ({
  connect: async (projectId: string) => {
    const { projects } = get();
    const d = projects[projectId];
    if (!d) return;

    set((s) => {
      s.status[projectId] = PCS.Connecting;
      s.connectionErrors[projectId] = "";
    });

    try {
      const driver = DriverFactory.getDriver(d.driver);
      const key: [string, string, string, string, string, string] = [
        d.username,
        d.password,
        d.database,
        d.host,
        d.port,
        d.ssl,
      ];
      const ssh =
        d.sshEnabled === "true"
          ? [d.sshHost, d.sshPort || "22", d.sshUser, d.sshPassword, d.sshKeyPath]
          : undefined;
      const st = await driver.connect(projectId, key, ssh);
      set((s) => {
        s.status[projectId] = st;
      });

      if (st === PCS.Connected) {
        const [sc, dbs, tsp] = await Promise.allSettled([
          driver.loadSchemas(projectId),
          driver.loadDatabases?.(projectId),
          driver.loadTablespaces?.(projectId),
        ]);
        set((s) => {
          s.schemas[projectId] = sc.status === "fulfilled" ? sc.value : [];
          s.serverDatabases[projectId] = dbs.status === "fulfilled" && dbs.value ? dbs.value : [];
          s.serverTablespaces[projectId] = tsp.status === "fulfilled" && tsp.value ? tsp.value : [];
        });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Connection failed";
      set((s) => {
        s.status[projectId] = PCS.Failed;
        s.connectionErrors[projectId] = msg;
      });
      const d = projects[projectId];
      toast.error(`Connection failed: ${d?.database || projectId}`, {
        description: msg,
        duration: 10000,
      });
    }
  },

  disconnect: async (projectId: string) => {
    const { projects } = get();
    const d = projects[projectId];
    if (!d) return;

    try {
      await DriverFactory.getDriver(d.driver).disconnect(projectId);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Disconnect failed";
      toast.error(`Failed to disconnect: ${d.database || projectId}`, { description: msg });
      return;
    }

    set((s) => {
      s.status[projectId] = PCS.Disconnected;
      s.connectionErrors[projectId] = "";
      clearProjectMetadata(s, projectId);
    });
  },

  refreshConnection: async (projectId: string) => {
    const { projects, status, tables } = get();
    const d = projects[projectId];
    if (!d || status[projectId] !== PCS.Connected) return;

    // Remember which schemas had tables loaded so we can re-expand them after the wipe
    const schemaPrefix = `${projectId}::`;
    const expandedSchemas = Object.keys(tables)
      .filter((k) => k.startsWith(schemaPrefix))
      .map((k) => k.slice(schemaPrefix.length));

    set((s) => {
      clearProjectMetadata(s, projectId);
    });

    try {
      const driver = DriverFactory.getDriver(d.driver);
      const [sc, dbs, tsp] = await Promise.allSettled([
        driver.loadSchemas(projectId),
        driver.loadDatabases?.(projectId),
        driver.loadTablespaces?.(projectId),
      ]);
      set((s) => {
        s.schemas[projectId] = sc.status === "fulfilled" ? sc.value : [];
        s.serverDatabases[projectId] = dbs.status === "fulfilled" && dbs.value ? dbs.value : [];
        s.serverTablespaces[projectId] = tsp.status === "fulfilled" && tsp.value ? tsp.value : [];
      });

      await Promise.all(
        expandedSchemas.map((schema) =>
          Promise.all([
            get().loadTables(projectId, schema),
            get().loadSchemaObjects(projectId, schema),
          ]),
        ),
      );

      toast.success("Connection refreshed");
    } catch {
      toast.error("Failed to refresh connection data");
    }
  },
});
