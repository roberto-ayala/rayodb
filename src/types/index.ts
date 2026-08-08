export interface ProjectDetails {
  driver: DriverType;
  username: string;
  password: string;
  database: string;
  host: string;
  port: string;
  ssl: string;
  sshEnabled: string;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  sshPassword: string;
  sshKeyPath: string;
  autoConnect: string;
  /** Driver-specific settings as a JSON object, e.g. a SQLite file path. */
  options?: string;
}

/**
 * Every engine the app has a name for. Not every one is selectable —
 * `db_drivers` reports which have a driver behind them.
 */
export type DriverType = "PGSQL" | "MYSQL" | "SQLITE";

export type ProjectMap = Record<string, ProjectDetails>;

export type TabType =
  | "query"
  | "monitor"
  | "erd"
  | "terminal"
  | "notify"
  | "roles"
  | "schema-diff"
  | "extensions"
  | "pg-settings";

export interface Tab {
  id: string;
  type: TabType;
  projectId?: string;
  schema?: string;
  title: string;
  editorValue: string;
  isExecuting: boolean;
  /** Opened by a single click in the tree: the next preview replaces it */
  preview?: boolean;
  result?: QueryResult;
  /** Set when the last run failed; a failure is not a result set */
  queryError?: { message: string; cancelled?: boolean };
  explainResult?: ExplainPlan;
  virtualQuery?: VirtualQuery;
  queryTimeout?: number;
  isSplit?: boolean;
  splitEditorValue?: string;
  splitResult?: QueryResult;
  isSplitExecuting?: boolean;
}

export interface ExplainNode {
  "Node Type": string;
  "Relation Name"?: string;
  Alias?: string;
  "Join Type"?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  Filter?: string;
  "Hash Cond"?: string;
  "Merge Cond"?: string;
  "Sort Key"?: string[];
  Strategy?: string;
  "Startup Cost": number;
  "Total Cost": number;
  "Plan Rows": number;
  "Plan Width": number;
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: ExplainNode[];
  [key: string]: unknown;
}

export interface ExplainPlan {
  Plan: ExplainNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
  Triggers?: unknown[];
}

export interface QueryResult {
  columns: string[];
  rows: string[][];
  time: number;
  capped?: boolean;
}

export interface VirtualQuery {
  queryId: string;
  columns: string[];
  totalRows: number;
  pageSize: number;
  colCount: number;
  time: number;
}

export interface TableInfo {
  name: string;
  size: string;
  /** The table this one is a partition of, empty when it stands alone */
  parent: string;
  /** FOR VALUES … — a partition's real identity, empty when it is not one */
  bound: string;
  /** RANGE (col) | LIST (col) | HASH (col), empty unless partitioned */
  partitionKey: string;
}

export interface ColumnDetail {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
}

export interface IndexDetail {
  indexName: string;
  columnName: string;
  isUnique: boolean;
  isPrimary: boolean;
}

export interface ConstraintDetail {
  constraintName: string;
  constraintType: string;
  columnName: string;
}

export interface TriggerDetail {
  triggerName: string;
  event: string;
  timing: string;
}

export interface RuleDetail {
  ruleName: string;
  event: string;
}

export interface PolicyDetail {
  policyName: string;
  permissive: string;
  command: string;
}

export interface SequenceInfo {
  name: string;
  /** Current value, or "-" when the sequence has never been read */
  lastValue: string;
}

export interface FunctionInfo {
  name: string;
  returnType: string;
  arguments: string;
}

export interface ForeignTableInfo {
  name: string;
  /** The foreign server backing it */
  server: string;
}

export interface EventTriggerInfo {
  name: string;
  event: string;
  /** enabled | disabled | replica | always */
  enabled: string;
  /** The function it fires */
  function: string;
}

export interface DataTypeInfo {
  name: string;
  /** enum | domain | composite | range */
  kind: string;
  /** Labels, base type, attributes or subtype, depending on the kind */
  detail: string;
}

export interface ProcedureInfo {
  name: string;
  arguments: string;
}

export interface TriggerFunctionInfo {
  name: string;
  arguments: string;
  /** trigger | event_trigger — both are fired rather than called */
  kind: string;
}

export interface PgRole {
  name: string;
  superuser: boolean;
  create_db: boolean;
  create_role: boolean;
  login: boolean;
  replication: boolean;
  bypass_rls: boolean;
  conn_limit: number;
  valid_until: string;
  member_of: string[];
  inherit: boolean;
}

/** What the role editor sends back: every attribute the form can set */
export interface RoleSpec {
  name: string;
  login: boolean;
  superuser: boolean;
  create_db: boolean;
  create_role: boolean;
  inherit: boolean;
  replication: boolean;
  bypass_rls: boolean;
  conn_limit: number;
  /** Empty means no expiry */
  valid_until: string;
  /** Empty leaves the password untouched when editing */
  password: string;
  member_of: string[];
}

export interface SchemaGrant {
  schema: string;
  privilege: string;
  /** Relations in the schema the role holds it on, granted by name */
  granted: number;
  total: number;
}

export interface DefaultGrant {
  schema: string;
  privilege: string;
  granted: boolean;
}

export interface TableGrant {
  schema: string;
  table: string;
  grantee: string;
  privileges: string[];
}

export interface DbGrant {
  database: string;
  privilege: string;
  /** Granted to this role by name */
  granted: boolean;
  /** Available to everyone, so the role has it whether or not it was granted */
  via_public: boolean;
}

export interface SchemaObject {
  object_type: string;
  name: string;
  definition: string;
}

export enum ProjectConnectionStatus {
  Connected = "Connected",
  Connecting = "Connecting",
  Disconnected = "Disconnected",
  Failed = "Failed",
}
