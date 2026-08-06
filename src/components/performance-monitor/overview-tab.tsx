import { Database, HardDrive, Users, Zap } from "lucide-react";
import { InfoRow, PanelSection, StatTile } from "@/components/ui/panel";
import type { HistoryEntry } from "@/stores/history-store";

interface OverviewTabProps {
  dbStats: [string, string][];
  projectHistory: HistoryEntry[];
  avgTime: number;
  failedQueries: number;
}

export function OverviewTab({ dbStats, projectHistory, avgTime, failedQueries }: OverviewTabProps) {
  const statValue = (name: string) => dbStats.find(([n]) => n === name)?.[1] ?? "N/A";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={<Users className="h-4 w-4" />}
          label="Active Connections"
          value={statValue("Active Connections")}
        />
        <StatTile
          icon={<Database className="h-4 w-4" />}
          label="Database Size"
          value={statValue("Database Size")}
        />
        <StatTile
          icon={<Zap className="h-4 w-4" />}
          label="Cache Hit Ratio"
          value={statValue("Cache Hit Ratio")}
        />
        <StatTile
          icon={<HardDrive className="h-4 w-4" />}
          label="Deadlocks"
          value={statValue("Deadlocks")}
        />
      </div>

      <PanelSection title="Database Statistics" icon={<Database className="h-3 w-3" />}>
        <div className="[&>*:last-child]:border-b-0">
          {dbStats.map(([name, val]) => (
            <InfoRow key={name} label={name} value={val} />
          ))}
          {dbStats.length === 0 && (
            <div className="py-4 text-center text-xs text-muted-foreground">No stats available</div>
          )}
        </div>
      </PanelSection>

      {/* Session history summary */}
      <PanelSection title="Session Query Summary" icon={<Zap className="h-3 w-3" />}>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Total Queries" value={String(projectHistory.length)} />
          <StatTile label="Avg Execution Time" value={`${avgTime.toFixed(1)}ms`} />
          <StatTile
            label="Failed Queries"
            value={String(failedQueries)}
            tone={failedQueries > 0 ? "destructive" : "default"}
          />
        </div>
      </PanelSection>
    </div>
  );
}
