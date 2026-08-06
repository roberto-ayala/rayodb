import { Loader2, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelHeader, PanelToolbar } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { DriverFactory } from "@/lib/database-driver";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/project-store";

interface PgSetting {
  name: string;
  setting: string;
  unit: string;
  category: string;
  description: string;
  context: string;
  source: string;
  bootVal: string;
  resetVal: string;
}

export function PgSettingsPanel({ projectId }: { projectId: string }) {
  const projects = useProjectStore((s) => s.projects);
  const details = projects[projectId];

  const [settings, setSettings] = useState<PgSetting[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [contextFilter, setContextFilter] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!details) return;
    setIsLoading(true);
    try {
      const driver = DriverFactory.getDriver(details.driver);
      const result = await driver.loadPgSettings?.(projectId);
      if (result) {
        setSettings(
          result.map((r) => ({
            name: r[0],
            setting: r[1],
            unit: r[2],
            category: r[3],
            description: r[4],
            context: r[5],
            source: r[6],
            bootVal: r[7],
            resetVal: r[8],
          })),
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [projectId, details]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categories = useMemo(() => {
    const cats = new Set(settings.map((s) => s.category));
    return Array.from(cats).sort();
  }, [settings]);

  const lowerFilter = filter.toLowerCase();
  const filtered = settings.filter((s) => {
    if (categoryFilter && s.category !== categoryFilter) return false;
    if (contextFilter && s.context !== contextFilter) return false;
    if (
      lowerFilter &&
      !s.name.toLowerCase().includes(lowerFilter) &&
      !s.description.toLowerCase().includes(lowerFilter)
    )
      return false;
    return true;
  });

  const grouped = new Map<string, PgSetting[]>();
  for (const s of filtered) {
    if (!grouped.has(s.category)) grouped.set(s.category, []);
    grouped.get(s.category)?.push(s);
  }

  const contextColor = (ctx: string) => {
    switch (ctx) {
      case "user":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "superuser":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "postmaster":
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      case "sighup":
        return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <PanelHeader
        icon={<Settings className="h-3.5 w-3.5" />}
        title="PostgreSQL Settings"
        subtitle={details?.database ?? projectId}
      >
        <span className="text-3xs text-muted-foreground">
          {filtered.length}/{settings.length}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </PanelHeader>

      <PanelToolbar className="flex-wrap">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search settings..."
          size="sm"
          className="w-56"
        />
        <Select
          value={categoryFilter ?? ""}
          onChange={(e) => setCategoryFilter(e.target.value || null)}
          size="sm"
          className="w-auto"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          value={contextFilter ?? ""}
          onChange={(e) => setContextFilter(e.target.value || null)}
          size="sm"
          className="w-auto"
        >
          <option value="">All contexts</option>
          <option value="user">user (SET)</option>
          <option value="superuser">superuser</option>
          <option value="sighup">sighup (reload)</option>
          <option value="postmaster">postmaster (restart)</option>
          <option value="internal">internal</option>
        </Select>
        {(categoryFilter || contextFilter || filter) && (
          <button
            type="button"
            onClick={() => {
              setFilter("");
              setCategoryFilter(null);
              setContextFilter(null);
            }}
            className="text-xs text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </PanelToolbar>

      <div className="flex-1 overflow-auto bg-card">
        {Array.from(grouped.entries()).map(([category, items]) => (
          <div key={category}>
            <div className="sticky top-0 z-10 flex h-8 items-center border-b border-border bg-muted/60 px-3 backdrop-blur">
              <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                {category}
              </span>
            </div>
            <div className="divide-y divide-border/60">
              {items.map((s) => {
                const isModified = s.setting !== s.bootVal;
                return (
                  <div
                    key={s.name}
                    className={cn(
                      "px-3 py-2 transition-colors hover:bg-hover",
                      isModified && "bg-primary/[0.02]",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{s.name}</span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-3xs",
                          contextColor(s.context),
                        )}
                      >
                        {s.context}
                      </span>
                      {isModified && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-3xs text-primary">
                          modified
                        </span>
                      )}
                      {s.source && s.source !== "default" && (
                        <span className="text-3xs text-muted-foreground">via {s.source}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <span className="text-xs font-semibold tabular-nums text-foreground">
                        {s.setting}
                        {s.unit ? ` ${s.unit}` : ""}
                      </span>
                      {isModified && (
                        <span className="text-3xs text-muted-foreground">
                          default: {s.bootVal}
                          {s.unit ? ` ${s.unit}` : ""}
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {filter || categoryFilter || contextFilter
              ? "No matching settings"
              : "No settings loaded"}
          </div>
        )}
      </div>
    </div>
  );
}
