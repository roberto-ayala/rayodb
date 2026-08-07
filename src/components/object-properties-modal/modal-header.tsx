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
import { ModalBanner } from "@/components/ui/modal-banner";
import { SegmentedTabs } from "@/components/ui/panel";
import type { ObjectType, Tab } from "./types";

const objectIcon: Record<ObjectType, React.ReactNode> = {
  table: <Table className="h-5 w-5 text-primary" />,
  view: <Eye className="h-5 w-5 text-blue-500" />,
  matview: <Layers className="h-5 w-5 text-purple-500" />,
  function: <FileCode className="h-5 w-5 text-amber-500" />,
  "trigger-function": <Zap className="h-5 w-5 text-orange-500" />,
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
    <ModalBanner
      icon={objectIcon[objectType]}
      title={name}
      badge={objectLabel[objectType]}
      description={
        <>
          {schema}
          <span className="mx-1.5 text-muted-foreground/30">|</span>
          <span className="text-muted-foreground/60">{projectId}</span>
        </>
      }
      actions={
        <>
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
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
        </>
      }
    >
      <SegmentedTabs
        stretch
        className="mt-3"
        tabs={availableTabs.map((t) => ({ id: t.key, label: t.label, icon: tabIcons[t.key] }))}
        value={activeTab}
        onChange={setActiveTab}
      />
    </ModalBanner>
  );
}
