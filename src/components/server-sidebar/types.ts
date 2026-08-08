import type React from "react";
import type { ContextMenuEntry } from "@/components/ui/context-menu";
import type { DriverCapabilities } from "@/lib/database-driver/capabilities";
import type { OpenTabOptions } from "@/stores/tab-store";
import type {
  ColumnDetail,
  DataTypeInfo,
  EventTriggerInfo,
  ForeignTableInfo,
  FunctionInfo,
  IndexDetail,
  ProcedureInfo,
  ProjectConnectionStatus,
  ProjectMap,
  SequenceInfo,
  TableInfo,
  TriggerFunctionInfo,
} from "@/types";

export type ObjectKind = "table" | "view" | "matview" | "function" | "trigger-function";

export type CsvImportTarget = {
  projectId: string;
  schema: string;
  table: string;
  columns: string[];
};

export type PropsModalState = {
  open: boolean;
  objectType: ObjectKind;
  projectId: string;
  schema: string;
  name: string;
};

/**
 * Bundle of state slices + handlers passed to render helpers.
 * This is plain prop-drilling, NOT React Context.
 */
export interface SidebarRenderCtx {
  projects: ProjectMap;
  /** What the engine behind a project supports; gates branches and menus. */
  capsFor: (projectId: string) => DriverCapabilities;
  status: Record<string, ProjectConnectionStatus>;
  serverDatabases: Record<string, string[]>;
  serverTablespaces: Record<string, [string, string, string, string][]>;
  schemas: Record<string, string[]>;
  tables: Record<string, TableInfo[]>;
  columnDetails: Record<string, ColumnDetail[]>;
  indexes: Record<string, IndexDetail[]>;
  views: Record<string, string[]>;
  materializedViews: Record<string, string[]>;
  sequences: Record<string, SequenceInfo[]>;
  functions: Record<string, FunctionInfo[]>;
  procedures: Record<string, ProcedureInfo[]>;
  dataTypes: Record<string, DataTypeInfo[]>;
  foreignTables: Record<string, ForeignTableInfo[]>;
  eventTriggers: Record<string, EventTriggerInfo[]>;
  triggerFunctions: Record<string, TriggerFunctionInfo[]>;

  connect: (projectId: string) => Promise<void>;
  disconnect: (projectId: string) => Promise<void>;
  loadColumns: (projectId: string, schema: string, table: string) => Promise<string[]>;
  refreshConnection: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  addDatabaseToServer: (sourceProjectId: string, name: string, database: string) => Promise<void>;
  openTab: (projectId?: string, sql?: string, options?: OpenTabOptions) => void;
  openMonitorTab: (projectId: string) => void;
  openERDTab: (projectId: string, schema: string) => void;
  openNotifyTab: (projectId: string) => void;
  openRolesTab: (projectId: string) => void;
  openSchemaDiffTab: (projectId: string) => void;
  openExtensionsTab: (projectId: string) => void;
  openPgSettingsTab: (projectId: string) => void;

  loading: Record<string, boolean>;
  selectedItem: string | null;
  setSelectedItem: (k: string | null) => void;
  setCsvImportTarget: (t: CsvImportTarget | null) => void;
  setAddDbSource: (id: string | null) => void;
  openProperties: (objectType: ObjectKind, projectId: string, schema: string, name: string) => void;

  toggle: (key: string, defaultOpen?: boolean) => void;
  isOpen: (key: string, defaultOpen?: boolean) => boolean;
  onConnect: (projectId: string) => Promise<void>;
  onDisconnect: (projectId: string) => Promise<void>;
  onExpandSchema: (projectId: string, schema: string) => void;
  onExpandTable: (projectId: string, schema: string, table: string) => void;
  onOpenTableQuery: (projectId: string, schema: string, table: string) => void;
  onPreviewTableQuery: (projectId: string, schema: string, table: string) => void;
  onPinPreview: () => void;

  copy: (text: string) => void;
  showMenu: (e: React.MouseEvent, items: ContextMenuEntry[]) => void;
  onEditConnection?: (projectId: string) => void;
}
