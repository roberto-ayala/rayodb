import { useEffect, useState } from "react";
import { serverName } from "@/lib/server-group";
import { cn } from "@/lib/utils";
import { useHistoryStore } from "@/stores/history-store";
import { useProjectStore } from "@/stores/project-store";
import { useActiveTab } from "@/stores/tab-store";
import { getSystemResourceUsage, type SystemResourceUsage } from "@/tauri";
import { ProjectConnectionStatus } from "@/types";

export function StatusBar() {
  const activeTab = useActiveTab();
  const projects = useProjectStore((s) => s.projects);
  const status = useProjectStore((s) => s.status);
  const historyCount = useHistoryStore((s) => s.entries.length);

  const projectId = activeTab?.projectId;
  const details = projectId ? projects[projectId] : undefined;
  const connStatus = projectId ? status[projectId] : undefined;
  const [resources, setResources] = useState<SystemResourceUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const usage = await getSystemResourceUsage();
        if (!cancelled) setResources(usage);
      } catch {
        // Ignore metrics polling errors to keep footer stable.
      }
    };

    void load();
    const id = window.setInterval(() => {
      void load();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const formatMb = (mb: number): string => {
    if (mb >= 1000) return `${(mb / 1000).toFixed(2)} GB`;
    return `${mb.toLocaleString()} MB`;
  };

  const formatMbps = (mbps: number): string => {
    if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
    return `${mbps.toFixed(2)} Mbps`;
  };

  const cpu = resources ? `${resources.app_cpu_percent.toFixed(1)}%` : "--";
  const rss = resources ? formatMb(resources.app_memory_rss_mb) : "--";
  const proc = resources ? `${resources.app_process_count}` : "--";
  const conn = resources
    ? `${resources.db_connections_in_use}/${resources.db_connections_open}`
    : "--";
  const rx = resources ? formatMbps(resources.network_rx_mbps) : "--";
  const tx = resources ? formatMbps(resources.network_tx_mbps) : "--";
  const waiting = resources?.db_connections_waiting ?? 0;

  return (
    <div className="grid h-7 grid-cols-[1fr_auto_1fr] items-center border-t border-border bg-window-chrome px-3 pb-px text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        {projectId && details ? (
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2 py-0.5",
              connStatus === ProjectConnectionStatus.Connected && "bg-success/10 text-success",
              connStatus === ProjectConnectionStatus.Connecting && "bg-warning/10 text-warning",
              connStatus === ProjectConnectionStatus.Failed && "bg-destructive/10 text-destructive",
              !connStatus && "text-muted-foreground",
            )}
          >
            <div
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connStatus === ProjectConnectionStatus.Connected && "bg-success",
                connStatus === ProjectConnectionStatus.Connecting && "bg-warning",
                connStatus === ProjectConnectionStatus.Failed && "bg-destructive",
                !connStatus && "bg-muted",
              )}
            />
            {/* Same hierarchy as the sidebar tree: connection first, then database */}
            <span>{serverName(projects, projectId)}</span>
            <span className="opacity-50">&bull;</span>
            <span>{details.database}</span>
          </div>
        ) : (
          <span>No connection</span>
        )}
      </div>

      <div className="flex items-center gap-6 justify-self-center">
        <Metric label="CPU" value={cpu} width="6ch" />
        <Metric label="RSS" value={rss} width="8ch" />
        <Metric label="PROC" value={proc} width="3ch" />
        <Metric
          label="CONN"
          value={conn}
          width="6ch"
          note={waiting > 0 ? `${waiting} waiting` : undefined}
        />
        <Metric label="NET" value={`↓ ${rx} ↑ ${tx}`} width="27ch" />
      </div>

      <div className="flex items-center justify-self-end gap-2">
        <span className="font-mono tabular-nums">{historyCount}</span>
        <span>queries in history</span>
      </div>
    </div>
  );
}

/**
 * Metrics tick every second, so each value gets a fixed slot in mono: the row
 * keeps its width whatever the numbers do, and the grid keeps it centred
 * regardless of what the sides show.
 */
function Metric({
  label,
  value,
  width,
  note,
}: {
  label: string;
  value: string;
  width: string;
  note?: string;
}) {
  return (
    <span className="flex items-center gap-1" title={note}>
      {label && <span className="text-3xs font-semibold uppercase tracking-widest">{label}</span>}
      <span
        className="whitespace-nowrap font-mono tabular-nums text-foreground/80"
        style={{ width }}
      >
        {value}
      </span>
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", note ? "bg-warning" : "bg-transparent")}
      />
    </span>
  );
}
