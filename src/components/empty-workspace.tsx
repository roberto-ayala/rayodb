import { Clock, Database, Plus, Search, Star, Terminal } from "lucide-react";
import { useHistoryStore } from "@/stores/history-store";
import { useProjectStore } from "@/stores/project-store";
import { useQueryStore } from "@/stores/query-store";
import { useTabStore } from "@/stores/tab-store";
import { ProjectConnectionStatus } from "@/types";

const isMac = navigator.platform.includes("Mac");
const mod = isMac ? "⌘" : "Ctrl";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function firstLine(sql: string): string {
  const line = sql.trim().split("\n")[0];
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/**
 * Shown when no tab is open. The space used to hold a wordmark; it now offers
 * the three ways in and what the user was last working on.
 */
export function EmptyWorkspace({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  const openTab = useTabStore((s) => s.openTab);
  const openTerminalTab = useTabStore((s) => s.openTerminalTab);
  const entries = useHistoryStore((s) => s.entries);
  const savedQueries = useQueryStore((s) => s.queries);
  const status = useProjectStore((s) => s.status);

  const connected = Object.entries(status)
    .filter(([, s]) => s === ProjectConnectionStatus.Connected)
    .map(([id]) => id);

  // One entry per distinct statement, most recent first
  const recent = entries
    .filter((e) => e.success && e.sql.trim())
    .filter((e, i, all) => all.findIndex((o) => o.sql.trim() === e.sql.trim()) === i)
    .slice(0, 5);

  const saved = savedQueries.slice(0, 3);

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-foreground">RSQL</span>
          <span className="text-xs text-muted-foreground">
            {connected.length > 0
              ? `${connected.length} connection${connected.length > 1 ? "s" : ""} open`
              : "No connection yet"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Action
            icon={<Plus className="h-4 w-4" />}
            label="New query"
            shortcut={`${mod}T`}
            onClick={() => openTab()}
          />
          <Action
            icon={<Terminal className="h-4 w-4" />}
            label="Terminal"
            shortcut={`${mod}\``}
            onClick={openTerminalTab}
          />
          <Action
            icon={<Search className="h-4 w-4" />}
            label="Search"
            shortcut={`${mod}K`}
            onClick={onOpenCommandPalette}
          />
        </div>

        {saved.length > 0 && (
          <Section title="Saved" icon={<Star className="h-3 w-3" />}>
            {saved.map((q) => (
              <Row
                key={q.id}
                onClick={() => openTab(q.projectId, q.sql)}
                title={q.title}
                meta={q.database}
              />
            ))}
          </Section>
        )}

        {recent.length > 0 ? (
          <Section title="Recent" icon={<Clock className="h-3 w-3" />}>
            {recent.map((e) => (
              <Row
                key={e.id}
                onClick={() => openTab(e.projectId, e.sql)}
                title={firstLine(e.sql)}
                mono
                meta={`${e.database} · ${timeAgo(e.timestamp)}`}
              />
            ))}
          </Section>
        ) : (
          <p className="text-xs text-muted-foreground">
            Pick a database on the left, or start a query — anything you run shows up here.
          </p>
        )}
      </div>
    </div>
  );
}

function Action({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-hover"
    >
      <span className="text-primary">{icon}</span>
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <kbd className="font-mono text-3xs text-muted-foreground">{shortcut}</kbd>
      </span>
    </button>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">{children}</div>
    </section>
  );
}

function Row({
  title,
  meta,
  mono,
  onClick,
}: {
  title: string;
  meta: string;
  mono?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-hover"
    >
      <Database className="h-3 w-3 shrink-0 text-muted-foreground/60" />
      <span
        className={`min-w-0 flex-1 truncate text-xs text-foreground ${mono ? "font-mono" : ""}`}
      >
        {title}
      </span>
      <span className="shrink-0 text-3xs text-muted-foreground">{meta}</span>
    </button>
  );
}
