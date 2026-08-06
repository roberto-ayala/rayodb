import type React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared shell for the full-tab panels — monitor, settings, extensions,
 * schema diff, enums, notify — so they present the same header, toolbar,
 * section and table styling instead of each inventing its own.
 */
export function PanelHeader({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-primary">{icon}</span>
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {subtitle && (
          <>
            <span className="text-border">|</span>
            <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
          </>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  );
}

/** Second row: filters, search and secondary actions */
export function PanelToolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The app's segmented control, shared by every panel that switches views */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  stretch,
  className,
}: {
  tabs: { id: T; label: string; icon?: React.ReactNode; count?: number; disabled?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  /** Fill the available width, as the properties modal header does */
  stretch?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "items-center gap-0.5 rounded-md border border-border bg-background p-0.5",
        stretch ? "flex" : "inline-flex",
        className,
      )}
    >
      {tabs.map(({ id, label, icon, count, disabled }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(id)}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
            value === id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {icon}
          {label}
          {count !== undefined && (
            <span
              className={cn(
                "text-3xs",
                value === id ? "text-muted-foreground" : "text-muted-foreground/60",
              )}
            >
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Titled container for a group of rows, stats or a table */
export function PanelSection({
  title,
  icon,
  actions,
  children,
  className,
}: {
  title?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      {title && (
        <header className="flex h-8 items-center justify-between border-b border-border bg-muted/50 px-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {icon}
            <span className="text-3xs font-semibold uppercase tracking-widest">{title}</span>
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Metric tile used across the monitor and overview surfaces */
export function StatTile({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-3xs font-semibold uppercase tracking-widest">{label}</span>
      </div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums leading-tight", toneClass)}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-3xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Table styling shared by every panel that lists rows */
export const tableClasses = {
  wrapper: "w-full overflow-auto",
  table: "w-full border-collapse text-xs",
  head: "sticky top-0 z-10 bg-muted/60 backdrop-blur",
  th: "px-3 py-1.5 text-left text-3xs font-semibold uppercase tracking-widest text-muted-foreground",
  row: "border-t border-border/60 transition-colors hover:bg-hover",
  td: "px-3 py-1.5 align-middle",
};

export function PanelEmpty({ icon, message }: { icon?: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
      {icon}
      <span className="text-xs">{message}</span>
    </div>
  );
}
