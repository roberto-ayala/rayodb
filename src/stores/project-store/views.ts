import type { StateCreator } from "zustand";
import { DriverFactory } from "@/lib/database-driver";
import type {
  DataTypeInfo,
  EventTriggerInfo,
  ForeignTableInfo,
  FunctionInfo,
  ProcedureInfo,
  SequenceInfo,
  TriggerFunctionInfo,
} from "@/types";
import type { ProjectState } from "./index";

export type ViewsSlice = {
  views: Record<string, string[]>;
  materializedViews: Record<string, string[]>;
  sequences: Record<string, SequenceInfo[]>;
  functions: Record<string, FunctionInfo[]>;
  procedures: Record<string, ProcedureInfo[]>;
  dataTypes: Record<string, DataTypeInfo[]>;
  foreignTables: Record<string, ForeignTableInfo[]>;
  eventTriggers: Record<string, EventTriggerInfo[]>;
  triggerFunctions: Record<string, TriggerFunctionInfo[]>;
  serverDatabases: Record<string, string[]>;
  serverTablespaces: Record<string, [string, string, string, string][]>;
  loadTableColumns: (projectId: string, schema: string, table: string) => Promise<void>;
  loadTableMetadata: (projectId: string, schema: string, table: string) => Promise<void>;
};

export const createViewsSlice: StateCreator<
  ProjectState,
  [["zustand/immer", never]],
  [],
  ViewsSlice
> = (set, get) => ({
  views: {},
  materializedViews: {},
  sequences: {},
  functions: {},
  procedures: {},
  dataTypes: {},
  foreignTables: {},
  eventTriggers: {},
  triggerFunctions: {},
  serverDatabases: {},
  serverTablespaces: {},

  /**
   * What the sidebar tree shows when a table is expanded: the columns, plus the
   * indexes it needs to mark the primary key. Everything else is the properties
   * modal's job — see loadTableMetadata.
   */
  loadTableColumns: async (projectId: string, schema: string, table: string) => {
    const key = `${projectId}::${schema}::${table}`;
    const { columnDetails, projects } = get();
    if (columnDetails[key]) return;

    const d = projects[projectId];
    if (!d) return;
    const driver = DriverFactory.getDriver(d.driver);

    const [colsR, idxsR] = await Promise.allSettled([
      driver.loadColumnDetails(projectId, schema, table),
      driver.loadIndexes(projectId, schema, table),
    ]);

    set((s) => {
      s.columnDetails[key] = colsR.status === "fulfilled" ? colsR.value : [];
      s.indexes[key] = idxsR.status === "fulfilled" ? idxsR.value : [];
    });
  },

  /** Every detail the properties modal displays for a table. */
  loadTableMetadata: async (projectId: string, schema: string, table: string) => {
    const key = `${projectId}::${schema}::${table}`;
    const { constraints, projects } = get();
    if (constraints[key]) return;

    const d = projects[projectId];
    if (!d) return;
    const driver = DriverFactory.getDriver(d.driver);

    const [colsR, idxsR, consR, trigsR, rlsR, polsR] = await Promise.allSettled([
      driver.loadColumnDetails(projectId, schema, table),
      driver.loadIndexes(projectId, schema, table),
      driver.loadConstraints(projectId, schema, table),
      driver.loadTriggers(projectId, schema, table),
      driver.loadRules(projectId, schema, table),
      driver.loadPolicies(projectId, schema, table),
    ]);

    const val = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
      r.status === "fulfilled" ? r.value : fallback;

    set((s) => {
      s.columnDetails[key] = val(colsR, []);
      s.indexes[key] = val(idxsR, []);
      s.constraints[key] = val(consR, []);
      s.triggers[key] = val(trigsR, []);
      s.rules[key] = val(rlsR, []);
      s.policies[key] = val(polsR, []);
    });
  },
});
