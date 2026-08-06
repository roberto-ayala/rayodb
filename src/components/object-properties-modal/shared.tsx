import { Check, Key, Link2, Loader2, Shield } from "lucide-react";
import { PanelSection, StatTile } from "@/components/ui/panel";

export { InfoRow } from "@/components/ui/panel";

/** The modal's stat card and section are the app-wide ones */
export function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return <StatTile icon={icon} label={label} value={value} />;
}

export function PropertySection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PanelSection title={title} icon={icon}>
      {children}
    </PanelSection>
  );
}

export function ConstraintIcon({ type }: { type: string }) {
  if (type === "PRIMARY KEY") return <Key className="h-3 w-3 text-warning shrink-0" />;
  if (type === "FOREIGN KEY") return <Link2 className="h-3 w-3 text-blue-500 shrink-0" />;
  if (type === "UNIQUE") return <Shield className="h-3 w-3 text-blue-500 shrink-0" />;
  if (type === "CHECK") return <Check className="h-3 w-3 text-muted-foreground shrink-0" />;
  return <Link2 className="h-3 w-3 text-muted-foreground/50 shrink-0" />;
}

export function LoadingPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
        <Loader2 className="h-5 w-5 animate-spin relative" />
      </div>
      <span className="text-xs">Loading...</span>
    </div>
  );
}

export function formatTimestamp(ts: string): string {
  if (ts === "never") return "never";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 2592000000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return ts;
  }
}
