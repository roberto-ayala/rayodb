import {
  Activity,
  Bell,
  Columns3,
  Copy,
  Database,
  List,
  Package,
  Plus,
  Settings,
  Shield,
  Terminal,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { DriverFactory } from "@/lib/database-driver";
import { cn } from "@/lib/utils";
import * as virtualCache from "@/lib/virtual-cache";
import { useProjectStore } from "@/stores/project-store";
import { useTabStore } from "@/stores/tab-store";

export function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const selectedTabIndex = useTabStore((s) => s.selectedTabIndex);
  const selectTab = useTabStore((s) => s.selectTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const closeAllTabs = useTabStore((s) => s.closeAllTabs);
  const closeOtherTabs = useTabStore((s) => s.closeOtherTabs);
  const openTab = useTabStore((s) => s.openTab);
  const { menu, showMenu, closeMenu } = useContextMenu();

  const cleanupVirtual = useCallback(
    (idx: number) => {
      const tab = tabs[idx];
      if (tab?.virtualQuery?.queryId && tab.projectId) {
        const d = useProjectStore.getState().projects[tab.projectId];
        if (d)
          DriverFactory.getDriver(d.driver)
            .closeVirtual?.(tab.projectId, tab.virtualQuery.queryId)
            .catch(() => {});
        virtualCache.clearQuery(tab.virtualQuery.queryId);
      }
    },
    [tabs],
  );

  const handleCloseTab = useCallback(
    (idx: number) => {
      cleanupVirtual(idx);
      closeTab(idx);
    },
    [cleanupVirtual, closeTab],
  );

  const handleCloseAll = useCallback(() => {
    for (let i = 0; i < tabs.length; i++) cleanupVirtual(i);
    closeAllTabs();
  }, [tabs, cleanupVirtual, closeAllTabs]);

  const handleCloseOthers = useCallback(
    (idx: number) => {
      for (let i = 0; i < tabs.length; i++) {
        if (i !== idx) cleanupVirtual(i);
      }
      closeOtherTabs(idx);
    },
    [tabs, cleanupVirtual, closeOtherTabs],
  );

  const openTerminalTab = useTabStore((s) => s.openTerminalTab);
  const projects = useProjectStore((s) => s.projects);

  return (
    <div className="flex min-h-[38px] items-center border-b border-border bg-muted/40">
      <div className="flex flex-1 items-end self-stretch overflow-x-auto overflow-y-hidden whitespace-nowrap scrollbar-none px-1.5 pt-1">
        {tabs.map((tab, idx) => {
          if (!tab) return null;
          const projectName = tab.projectId;
          const projectDb = tab.projectId ? projects[tab.projectId]?.database : undefined;
          const isActive = selectedTabIndex === idx;

          return (
            <div
              key={tab.id}
              onClick={() => selectTab(idx)}
              onContextMenu={(e) =>
                showMenu(e, [
                  {
                    label: "Close",
                    icon: <X className="h-3 w-3" />,
                    onClick: () => handleCloseTab(idx),
                  },
                  ...(tabs.length > 1
                    ? [
                        {
                          label: "Close Others",
                          icon: <XCircle className="h-3 w-3" />,
                          onClick: () => handleCloseOthers(idx),
                        },
                      ]
                    : []),
                  {
                    label: "Close All",
                    icon: <Trash2 className="h-3 w-3" />,
                    onClick: handleCloseAll,
                  },
                  ...(tab.editorValue
                    ? [
                        { separator: true as const },
                        {
                          label: "Copy SQL",
                          icon: <Copy className="h-3 w-3" />,
                          onClick: () => navigator.clipboard.writeText(tab.editorValue),
                        },
                      ]
                    : []),
                ])
              }
              className={cn(
                // The active tab carries the surface of the bar right below it
                // and covers the divider, so the two read as one region
                "group relative z-10 flex shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-3 py-1.5 transition-colors duration-150 cursor-pointer select-none -mb-px",
                isActive
                  ? "border-border bg-muted text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              <div className="flex items-center gap-1.5 text-xs">
                {tab.type === "terminal" ? (
                  <Terminal
                    className={cn("h-3 w-3", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                ) : tab.type === "monitor" ? (
                  <Activity
                    className={cn("h-3 w-3", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                ) : tab.type === "notify" ? (
                  <Bell
                    className={cn("h-3 w-3", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                ) : tab.type === "roles" ? (
                  <Shield
                    className={cn("h-3 w-3", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                ) : tab.type === "schema-diff" ? (
                  <Columns3
                    className={cn("h-3 w-3", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                ) : tab.type === "extensions" ? (
                  <Package
                    className={cn("h-3 w-3", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                ) : tab.type === "enums" ? (
                  <List
                    className={cn("h-3 w-3", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                ) : tab.type === "pg-settings" ? (
                  <Settings
                    className={cn("h-3 w-3", isActive ? "text-primary" : "text-muted-foreground")}
                  />
                ) : projectDb ? (
                  <Database
                    className={cn(
                      "h-3 w-3",
                      isActive ? "text-primary/70" : "text-muted-foreground/60",
                    )}
                  />
                ) : null}
                {projectDb && tab.type !== "monitor" && (
                  <span className="text-muted-foreground/70">{projectName}:</span>
                )}
                <span className={cn(isActive && "font-medium")}>{tab.title}</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(idx);
                }}
                className="rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-0.5 pr-1.5">
        <Button variant="ghost" size="icon-sm" onClick={() => openTab()} title="New query tab">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={openTerminalTab}
          title="Open terminal (Cmd+`)"
        >
          <Terminal className="h-3.5 w-3.5" />
        </Button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </div>
  );
}
