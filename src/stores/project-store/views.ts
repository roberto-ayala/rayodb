import type { StateCreator } from "zustand";
import { DriverFactory } from "@/lib/database-driver";
import { ensureCapabilities } from "@/stores/capability-store";
import type {
  DataTypeInfo,
  EventTriggerInfo,
  ForeignTableInfo,
  FunctionInfo,
  PolicyDetail,
  ProcedureInfo,
  RuleDetail,
  SequenceInfo,
  TriggerDetail,
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

    // Only ask for what the engine has. Without this the unsupported calls
    // still go out and fail, which costs a round trip and buries a real error
    // among expected ones.
    const caps = await ensureCapabilities(d.driver);
    const none = <T>(): Promise<T[]> => Promise.resolve([]);
    const [colsR, idxsR, consR, trigsR, rlsR, polsR] = await Promise.allSettled([
      driver.loadColumnDetails(projectId, schema, table),
      driver.loadIndexes(projectId, schema, table),
      driver.loadConstraints(projectId, schema, table),
      caps.triggers ? driver.loadTriggers(projectId, schema, table) : none<TriggerDetail>(),
      caps.rules ? driver.loadRules(projectId, schema, table) : none<RuleDetail>(),
      caps.policies ? driver.loadPolicies(projectId, schema, table) : none<PolicyDetail>(),
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
