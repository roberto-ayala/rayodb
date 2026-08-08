import type { StateCreator } from "zustand";
import { DriverFactory } from "@/lib/database-driver";
import { ensureCapabilities } from "@/stores/capability-store";
import type {
  ColumnDetail,
  DataTypeInfo,
  ForeignTableInfo,
  FunctionInfo,
  ProcedureInfo,
  SequenceInfo,
  TableInfo,
  TriggerFunctionInfo,
} from "@/types";
import type { ProjectState } from "./index";

export type SchemaSlice = {
  schemas: Record<string, string[]>;
  tables: Record<string, TableInfo[]>;
  columns: Record<string, string[]>;
  columnDetails: Record<string, ColumnDetail[]>;
  loadSchemas: (projectId: string) => Promise<void>;
  loadTables: (projectId: string, schema: string) => Promise<void>;
  loadColumns: (projectId: string, schema: string, table: string) => Promise<string[]>;
  loadColumnDetails: (projectId: string, schema: string, table: string) => Promise<ColumnDetail[]>;
  loadSchemaObjects: (projectId: string, schema: string) => Promise<void>;
};

export const createSchemaSlice: StateCreator<
  ProjectState,
  [["zustand/immer", never]],
  [],
  SchemaSlice
> = (set, get) => ({
  schemas: {},
  tables: {},
  columns: {},
  columnDetails: {},

  loadSchemas: async (projectId: string) => {
    const { projects } = get();
    const d = projects[projectId];
    if (!d) return;
    const driver = DriverFactory.getDriver(d.driver);
    const sc = await driver.loadSchemas(projectId);
    set((s) => {
      s.schemas[projectId] = sc;
    });
  },

  loadTables: async (projectId: string, schema: string) => {
    const key = `${projectId}::${schema}`;
    const { tables, projects } = get();
    if (tables[key]) return;

    const d = projects[projectId];
    if (!d) return;
    const driver = DriverFactory.getDriver(d.driver);
    const rawRows = await driver.loadTables(projectId, schema);
    const rows: TableInfo[] = rawRows.map(([name, size, parent, bound, partitionKey]) => ({
      name,
      size,
      parent,
      bound,
      partitionKey,
    }));
    set((s) => {
      s.tables[key] = rows;
    });
  },

  loadColumns: async (projectId: string, schema: string, table: string) => {
    const colKey = `${projectId}::${schema}::${table}`;
    const { columns, projects } = get();
    if (columns[colKey]) return columns[colKey];

    const d = projects[projectId];
    if (!d) return [];
    const driver = DriverFactory.getDriver(d.driver);
    const cols = await driver.loadColumns(projectId, schema, table);
    set((s) => {
      s.columns[colKey] = cols;
    });
    return cols;
  },

  loadColumnDetails: async (projectId: string, schema: string, table: string) => {
    const key = `${projectId}::${schema}::${table}`;
    const { columnDetails, projects } = get();
    if (columnDetails[key]) return columnDetails[key];

    const d = projects[projectId];
    if (!d) return [];
    const driver = DriverFactory.getDriver(d.driver);
    const details = await driver.loadColumnDetails(projectId, schema, table);
    set((s) => {
      s.columnDetails[key] = details;
    });
    return details;
  },

  loadSchemaObjects: async (projectId: string, schema: string) => {
    const key = `${projectId}::${schema}`;
    const { views: existingViews, projects } = get();
    if (existingViews[key]) return;

    const d = projects[projectId];
    if (!d) return;
    const driver = DriverFactory.getDriver(d.driver);
    // Skip what the engine does not have, so an unsupported category costs no
    // round trip and logs no error the user cannot act on.
    const caps = await ensureCapabilities(d.driver);
    const none = <T>(): Promise<T[]> => Promise.resolve([]);
    const [vR, mvR, seqR, fnR, procR, dtR, ftR, tfnR] = await Promise.allSettled([
      driver.loadViews(projectId, schema),
      caps.materializedViews ? driver.loadMaterializedViews(projectId, schema) : none<string>(),
      caps.sequences ? driver.loadSequences(projectId, schema) : none<SequenceInfo>(),
      caps.functions ? driver.loadFunctions(projectId, schema) : none<FunctionInfo>(),
      caps.procedures ? driver.loadProcedures(projectId, schema) : none<ProcedureInfo>(),
      caps.dataTypes ? driver.loadDataTypes(projectId, schema) : none<DataTypeInfo>(),
      caps.foreignTables ? driver.loadForeignTables(projectId, schema) : none<ForeignTableInfo>(),
      caps.triggerFunctions
        ? driver.loadTriggerFunctions(projectId, schema)
        : none<TriggerFunctionInfo>(),
    ]);

    const val = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
      r.status === "fulfilled" ? r.value : fallback;

    set((s) => {
      s.views[key] = val(vR, []);
      s.materializedViews[key] = val(mvR, []);
      s.sequences[key] = val(seqR, []);
      s.functions[key] = val(fnR, []);
      s.procedures[key] = val(procR, []);
      s.dataTypes[key] = val(dtR, []);
      s.foreignTables[key] = val(ftR, []);
      s.triggerFunctions[key] = val(tfnR, []);
    });
  },
});
