import { AlignLeft, Columns2, GitBranch, Play, Save, Square, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { format as formatSQL } from "sql-formatter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SqlCode } from "@/components/ui/sql-code";
import { useProjectStore } from "@/stores/project-store";
import { useQueryStore } from "@/stores/query-store";
import { useActiveTab, useTabStore } from "@/stores/tab-store";

const TIMEOUT_OPTIONS = [
  { label: "No limit", value: 0 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
  { label: "5m", value: 300000 },
  { label: "10m", value: 600000 },
];

export function EditorToolbar({
  onExecute,
  onExplain,
  onCancel,
}: {
  onExecute: () => void;
  onExplain: () => void;
  onCancel: () => void;
}) {
  const activeTab = useActiveTab();
  const selectedTabIndex = useTabStore((s) => s.selectedTabIndex);
  const updateContent = useTabStore((s) => s.updateContent);
  const toggleSplit = useTabStore((s) => s.toggleSplit);
  const setQueryTimeout = useTabStore((s) => s.setQueryTimeout);
  const projects = useProjectStore((s) => s.projects);
  const saveQueryAction = useQueryStore((s) => s.saveQuery);
  const activeProject = activeTab?.projectId;
  const activeProjectDetails = activeProject ? projects[activeProject] : undefined;

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const saveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (saveDialogOpen) {
      setTimeout(() => saveInputRef.current?.focus(), 100);
    }
  }, [saveDialogOpen]);

  const handleSaveSubmit = async () => {
    if (!activeProject || !activeProjectDetails || !saveTitle.trim()) return;
    await saveQueryAction(
      activeProject,
      activeProjectDetails.database,
      activeProjectDetails.driver,
      saveTitle.trim(),
      activeTab?.editorValue ?? "",
    );
    setSaveTitle("");
    setSaveDialogOpen(false);
  };

  const formatQuery = () => {
    const sql = activeTab?.editorValue;
    if (!sql?.trim()) return;
    try {
      const formatted = formatSQL(sql, {
        language: "postgresql",
        tabWidth: 2,
        keywordCase: "upper",
      });
      updateContent(selectedTabIndex, formatted);
    } catch {
      // silently ignore formatting errors
    }
  };

  if (!activeTab || activeTab.type !== "query") return null;

  const hasContent = !!activeTab.editorValue?.trim();

  return (
    <>
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-1.5">
        <Button
          variant="subtle"
          size="sm"
          onClick={() => setSaveDialogOpen(true)}
          disabled={!activeProject || !hasContent}
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
        <Button variant="subtle" size="sm" onClick={formatQuery} disabled={!hasContent}>
          <AlignLeft className="h-3.5 w-3.5" />
          Format
        </Button>
        <Button
          variant={activeTab?.isSplit ? "outline" : "subtle"}
          size="sm"
          onClick={() => toggleSplit(selectedTabIndex)}
          title="Toggle split editor"
        >
          <Columns2 className="h-3.5 w-3.5" />
          Split
        </Button>

        <div className="mx-1.5 h-4 w-px bg-border" />

        <div className="flex items-center gap-1">
          <Timer className="h-3 w-3 text-muted-foreground" />
          <Select
            size="sm"
            value={activeTab.queryTimeout ?? 0}
            onChange={(e) => setQueryTimeout(selectedTabIndex, Number(e.target.value))}
            className="w-auto text-muted-foreground"
            title="Query timeout"
          >
            {TIMEOUT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="mx-1.5 h-4 w-px bg-border" />

        <Button
          variant="outline"
          size="sm"
          onClick={onExplain}
          disabled={!activeProject || activeTab.isExecuting}
        >
          <GitBranch className="h-3.5 w-3.5" />
          Explain
          <kbd className="font-mono hidden sm:inline-flex ml-0.5 text-3xs text-muted-foreground/60">
            {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+Shift+Enter
          </kbd>
        </Button>
        {activeTab.isExecuting ? (
          <Button variant="destructive" size="sm" onClick={onCancel}>
            <Square className="h-3 w-3" />
            Stop
            <kbd className="font-mono hidden sm:inline-flex ml-0.5 text-3xs opacity-60">
              {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+.
            </kbd>
          </Button>
        ) : (
          <Button variant="default" size="sm" onClick={onExecute} disabled={!activeProject}>
            <Play className="h-3.5 w-3.5" />
            Execute
            <kbd className="font-mono hidden sm:inline-flex ml-0.5 text-3xs text-primary-foreground/70">
              {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+Enter
            </kbd>
          </Button>
        )}
      </div>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save Query</DialogTitle>
            <DialogDescription>Save the current query for quick access later.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveSubmit();
            }}
            className="space-y-4 mt-2"
          >
            <Field label="Query Name" htmlFor="save-query-title">
              <Input
                id="save-query-title"
                ref={saveInputRef}
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="e.g. Active users report"
                required
              />
            </Field>
            <div className="rounded-md bg-muted/50 p-2 max-h-24 overflow-auto">
              <SqlCode
                code={`${activeTab?.editorValue?.slice(0, 300) ?? ""}${
                  (activeTab?.editorValue?.length ?? 0) > 300 ? "..." : ""
                }`}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSaveDialogOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                className="text-xs"
                disabled={!saveTitle.trim()}
              >
                <Save className="h-3.5 w-3.5 mr-1" />
                Save Query
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
