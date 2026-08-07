import type {
  ColumnDetail,
  ConstraintDetail,
  DataTypeInfo,
  DbGrant,
  EventTriggerInfo,
  ForeignTableInfo,
  FunctionInfo,
  IndexDetail,
  PgRole,
  PolicyDetail,
  ProcedureInfo,
  ProjectConnectionStatus,
  RoleSpec,
  RuleDetail,
  SchemaObject,
  SequenceInfo,
  TableGrant,
  TriggerDetail,
  TriggerFunctionInfo,
} from "@/types";

// Wire types from Rust (tuples)
export type WireTableInfo = [string, string, string];
export type WireQueryResult = [string[], string[][], number];
export type WirePackedResult = [string, number]; // [packed_string, elapsed_ms]

export const CELL_SEP = "\x1F"; // Unit Separator
export const ROW_SEP = "\x1E"; // Record Separator

export function unpackResult(packed: string, time: number): WireQueryResult {
  if (!packed) return [[], [], time];
  const parts = packed.split(ROW_SEP);
  const columns = parts[0].split(CELL_SEP);
  const rows = parts.slice(1).map((r) => r.split(CELL_SEP));
  return [columns, rows, time];
}
export type WireColumnDetail = [string, string, boolean, string | null];
export type WireIndexDetail = [string, string, boolean, boolean];
export type WireConstraintDetail = [string, string, string];
export type WireTriggerDetail = [string, string, string];
export type WireRuleDetail = [string, string];
export type WirePolicyDetail = [string, string, string];
export type WireFunctionInfo = [string, string, string];
export type WireSequenceInfo = [string, string];
export type WireProcedureInfo = [string, string];
export type WireDataTypeInfo = [string, string, string];
export type WireForeignTableInfo = [string, string];
export type WireEventTriggerInfo = [string, string, string, string];
export type WireTriggerFunctionInfo = [string, string, string];
export type WireForeignKeyInfo = [string, string, string, string];

export interface ForeignKey {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
}

export type QueryStreamEvent =
  | { type: "columns"; columns: string; total_rows: number }
  | { type: "chunk"; data: string }
  | { type: "done"; elapsed: number; capped: boolean };

export interface StreamCallbacks {
  onColumns: (columns: string[], totalRows: number) => void;
  onChunk: (rows: string[][]) => void;
  onDone: (elapsed: number, capped: boolean) => void;
}

export interface DatabaseDriver {
  connect(
    projectId: string,
    key: [string, string, string, string, string, string],
    ssh?: string[],
  ): Promise<ProjectConnectionStatus>;
  disconnect(projectId: string): Promise<void>;
  cancelQuery?(projectId: string): Promise<boolean>;
  loadSchemas(projectId: string): Promise<string[]>;
  loadTables(projectId: string, schema: string): Promise<WireTableInfo[]>;
  loadColumns(projectId: string, schema: string, table: string): Promise<string[]>;
  loadColumnDetails(projectId: string, schema: string, table: string): Promise<ColumnDetail[]>;
  loadIndexes(projectId: string, schema: string, table: string): Promise<IndexDetail[]>;
  loadConstraints(projectId: string, schema: string, table: string): Promise<ConstraintDetail[]>;
  loadTriggers(projectId: string, schema: string, table: string): Promise<TriggerDetail[]>;
  loadRules(projectId: string, schema: string, table: string): Promise<RuleDetail[]>;
  loadPolicies(projectId: string, schema: string, table: string): Promise<PolicyDetail[]>;
  loadViews(projectId: string, schema: string): Promise<string[]>;
  loadMaterializedViews(projectId: string, schema: string): Promise<string[]>;
  loadSequences(projectId: string, schema: string): Promise<SequenceInfo[]>;
  loadFunctions(projectId: string, schema: string): Promise<FunctionInfo[]>;
  loadProcedures(projectId: string, schema: string): Promise<ProcedureInfo[]>;
  loadDataTypes(projectId: string, schema: string): Promise<DataTypeInfo[]>;
  loadForeignTables(projectId: string, schema: string): Promise<ForeignTableInfo[]>;
  loadEventTriggers(projectId: string): Promise<EventTriggerInfo[]>;
  loadTriggerFunctions(projectId: string, schema: string): Promise<TriggerFunctionInfo[]>;
  runQuery(projectId: string, sql: string, timeoutMs?: number): Promise<WireQueryResult>;
  runQueryStreamed?(
    projectId: string,
    sql: string,
    streamId: string,
    callbacks: StreamCallbacks,
  ): Promise<void>;
  executeVirtual?(
    projectId: string,
    sql: string,
    queryId: string,
    pageSize: number,
    timeoutMs?: number,
  ): Promise<[string, number, string, number]>;
  fetchPage?(
    projectId: string,
    queryId: string,
    colCount: number,
    offset: number,
    limit: number,
  ): Promise<string>;
  closeVirtual?(projectId: string, queryId: string): Promise<void>;
  loadActivity(projectId: string): Promise<string[][]>;
  loadDatabaseStats(projectId: string): Promise<[string, string][]>;
  loadTableStats(projectId: string): Promise<string[][]>;
  loadForeignKeys(projectId: string, schema: string): Promise<ForeignKey[]>;
  loadTableStatistics?(
    projectId: string,
    schema: string,
    table: string,
  ): Promise<[string, string][]>;
  loadFKDetails?(
    projectId: string,
    schema: string,
    table: string,
    direction: string,
  ): Promise<[string, string, string, string, string, string, string, string, string][]>;
  loadViewInfo?(projectId: string, schema: string, view: string): Promise<[string, string][]>;
  loadMatviewInfo?(projectId: string, schema: string, matview: string): Promise<[string, string][]>;
  loadFunctionInfo?(
    projectId: string,
    schema: string,
    funcName: string,
  ): Promise<[string, string][]>;
  generateDDL?(
    projectId: string,
    schema: string,
    name: string,
    objectType: string,
  ): Promise<string>;
  csvPreview?(filePath: string): Promise<[string[], string[][]]>;
  csvImport?(
    projectId: string,
    filePath: string,
    schema: string,
    table: string,
    columnMapping: [number, string][],
  ): Promise<number>;
  listenStart?(projectId: string, channel: string): Promise<boolean>;
  listenStop?(projectId: string, channel: string): Promise<boolean>;
  notifySend?(projectId: string, channel: string, payload: string): Promise<boolean>;
  discoverChannels?(projectId: string): Promise<string[]>;
  loadRoles?(projectId: string): Promise<PgRole[]>;
  createRole?(projectId: string, spec: RoleSpec): Promise<string>;
  alterRole?(projectId: string, spec: RoleSpec): Promise<string>;
  dropRole?(projectId: string, name: string): Promise<string>;
  loadTableGrants?(projectId: string, roleName: string): Promise<TableGrant[]>;
  loadDatabaseGrants?(projectId: string, roleName: string): Promise<DbGrant[]>;
  extractSchemaObjects?(projectId: string, schema: string): Promise<SchemaObject[]>;
  loadLocks?(projectId: string): Promise<string[][]>;
  loadIndexUsage?(projectId: string): Promise<string[][]>;
  loadTableBloat?(projectId: string): Promise<string[][]>;
  loadDatabases?(projectId: string): Promise<string[]>;
  loadTablespaces?(projectId: string): Promise<[string, string, string][]>;
  loadExtensions?(projectId: string): Promise<string[][]>;
  loadAvailableExtensions?(projectId: string): Promise<string[][]>;
  loadPgSettings?(projectId: string): Promise<string[][]>;
  tableAction?(
    projectId: string,
    action: string,
    schema: string,
    table: string,
    objectType: string,
  ): Promise<string>;
}

export function parseColumnDetails(wire: WireColumnDetail[]): ColumnDetail[] {
  return wire.map(([name, dataType, nullable, defaultValue]) => ({
    name,
    dataType,
    nullable,
    defaultValue,
  }));
}

export function parseIndexDetails(wire: WireIndexDetail[]): IndexDetail[] {
  return wire.map(([indexName, columnName, isUnique, isPrimary]) => ({
    indexName,
    columnName,
    isUnique,
    isPrimary,
  }));
}

export function parseConstraintDetails(wire: WireConstraintDetail[]): ConstraintDetail[] {
  return wire.map(([constraintName, constraintType, columnName]) => ({
    constraintName,
    constraintType,
    columnName,
  }));
}

export function parseTriggerDetails(wire: WireTriggerDetail[]): TriggerDetail[] {
  return wire.map(([triggerName, event, timing]) => ({
    triggerName,
    event,
    timing,
  }));
}

export function parseRuleDetails(wire: WireRuleDetail[]): RuleDetail[] {
  return wire.map(([ruleName, event]) => ({ ruleName, event }));
}

export function parsePolicyDetails(wire: WirePolicyDetail[]): PolicyDetail[] {
  return wire.map(([policyName, permissive, command]) => ({
    policyName,
    permissive,
    command,
  }));
}

export function parseSequenceInfo(wire: WireSequenceInfo[]): SequenceInfo[] {
  return wire.map(([name, lastValue]) => ({ name, lastValue }));
}

export function parseFunctionInfo(wire: WireFunctionInfo[]): FunctionInfo[] {
  return wire.map(([name, returnType, arguments_]) => ({
    name,
    returnType,
    arguments: arguments_,
  }));
}

export function parseForeignTableInfo(wire: WireForeignTableInfo[]): ForeignTableInfo[] {
  return wire.map(([name, server]) => ({ name, server }));
}

export function parseEventTriggerInfo(wire: WireEventTriggerInfo[]): EventTriggerInfo[] {
  return wire.map(([name, event, enabled, function_]) => ({
    name,
    event,
    enabled,
    function: function_,
  }));
}

export function parseDataTypeInfo(wire: WireDataTypeInfo[]): DataTypeInfo[] {
  return wire.map(([name, kind, detail]) => ({ name, kind, detail }));
}

export function parseProcedureInfo(wire: WireProcedureInfo[]): ProcedureInfo[] {
  return wire.map(([name, arguments_]) => ({ name, arguments: arguments_ }));
}

export function parseTriggerFunctionInfo(wire: WireTriggerFunctionInfo[]): TriggerFunctionInfo[] {
  return wire.map(([name, arguments_, kind]) => ({
    name,
    arguments: arguments_,
    kind,
  }));
}

export type { DriverConfig, DriverType } from "./factory";
export { DRIVER_CONFIGS, DriverFactory } from "./factory";
