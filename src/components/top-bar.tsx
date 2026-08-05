import { Database, Download, Moon, Search, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { useActiveTab, useTabStore } from "@/stores/tab-store";
import { useUIStore } from "@/stores/ui-store";
import { ProjectConnectionStatus } from "@/types";

export function TopBar({
  onCheckUpdates,
  onOpenCommandPalette,
}: {
  onCheckUpdates: () => void;
  onOpenCommandPalette: () => void;
}) {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const projects = useProjectStore((s) => s.projects);
  const status = useProjectStore((s) => s.status);
  const selectedTabIndex = useTabStore((s) => s.selectedTabIndex);
  const activeTab = useActiveTab();
  const setProjectId = useTabStore((s) => s.setProjectId);
  const activeProject = activeTab?.projectId;
  const activeProjectDetails = activeProject ? projects[activeProject] : undefined;

  return (
    <div className="flex h-11 items-center justify-between border-b border-border bg-muted/50 px-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">RSQL</span>
        </div>
        <div className="h-4 w-px bg-border" />
        {activeProject &&
        activeProjectDetails &&
        status[activeProject] === ProjectConnectionStatus.Connected ? (
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-success" />
            <span className="">{activeProject}</span>
            <span className="text-muted-foreground/50">&bull;</span>
            <span>
              {activeProjectDetails.host}:{activeProjectDetails.port}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {Object.keys(projects).length > 0 ? (
              <select
                className="h-7 rounded-md border border-border bg-input px-2 text-xs text-foreground"
                value={activeProject ?? ""}
                onChange={(e) => {
                  if (e.target.value) {
                    setProjectId(selectedTabIndex, e.target.value);
                  }
                }}
              >
                <option value="">Select connection...</option>
                {Object.entries(projects).map(([id, details]) => (
                  <option key={id} value={id}>
                    {id} ({details.database})
                    {status[id] === ProjectConnectionStatus.Connected ? "" : " \u2022 disconnected"}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-muted-foreground">No connection</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Command palette trigger */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex h-7 items-center gap-2 rounded-md border border-border bg-muted/60 px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Search className="h-3 w-3" />
          <span className="text-xs">Search...</span>
          <kbd className="font-mono hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-background px-1.5 text-3xs text-muted-foreground">
            {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}K
          </kbd>
        </button>

        <div className="h-4 w-px bg-border" />

        <Button variant="ghost" size="sm" onClick={onCheckUpdates}>
          <Download className="h-4 w-4" />
          <span className="text-xs">Updates</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={toggleTheme}>
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
