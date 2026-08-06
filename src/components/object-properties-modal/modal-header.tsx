import {
  Check,
  Columns3,
  Copy,
  Database,
  Eye,
  FileCode,
  Key,
  Layers,
  Link2,
  Loader2,
  Pencil,
  Table,
  Zap,
} from "lucide-react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ObjectType, Tab } from "./types";

const objectIcon: Record<ObjectType, React.ReactNode> = {
  table: <Table className="h-4 w-4 text-primary" />,
  view: <Eye className="h-4 w-4 text-blue-500" />,
  matview: <Layers className="h-4 w-4 text-purple-500" />,
  function: <FileCode className="h-4 w-4 text-amber-500" />,
  "trigger-function": <Zap className="h-4 w-4 text-orange-500" />,
};

const objectLabel: Record<ObjectType, string> = {
  table: "Table",
  view: "View",
  matview: "Materialized View",
  function: "Function",
  "trigger-function": "Trigger Function",
};

const tabIcons: Partial<Record<Tab, React.ReactNode>> = {
  overview: <Database className="h-3 w-3" />,
  columns: <Columns3 className="h-3 w-3" />,
  indexes: <Key className="h-3 w-3" />,
  fkeys: <Link2 className="h-3 w-3" />,
  structure: <Pencil className="h-3 w-3" />,
  ddl: <FileCode className="h-3 w-3" />,
  actions: <Zap className="h-3 w-3" />,
};

export function ModalHeader({
  objectType,
  schema,
  name,
  projectId,
  loading,
  copied,
  copyText,
  availableTabs,
  activeTab,
  setActiveTab,
}: {
  objectType: ObjectType;
  schema: string;
  name: string;
  projectId: string;
  loading: boolean;
  copied: string | null;
  copyText: (text: string, label: string) => void;
  availableTabs: { key: Tab; label: string }[];
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}) {
  return (
    <div className="border-b border-border bg-muted/40 px-5 pt-5 pb-3">
      <DialogHeader>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background">
            {objectIcon[objectType]}
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="truncate">{name}</span>
              <button
                type="button"
                onClick={() => copyText(`"${schema}"."${name}"`, "name")}
                className="text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                title="Copy qualified name"
              >
                {copied === "name" ? (
                  <Check className="h-3 w-3 text-success" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wider">
                {objectLabel[objectType]}
              </span>
              <span className="text-2xs">{schema}</span>
              <span className="text-muted-foreground/30">|</span>
              <span className="text-2xs text-muted-foreground/60">{projectId}</span>
              {loading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {/* Tab switcher - pill style */}
      <div className="mt-3 flex gap-0.5 rounded-md border border-border bg-muted p-0.5">
        {availableTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-2xs font-medium transition-colors",
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tabIcons[tab.key]}
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
