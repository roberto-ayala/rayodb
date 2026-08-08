import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import { IndentGuides } from "./indent-guides";

export function SectionHeader({
  indent,
  label,
  icon,
  expanded,
  empty = false,
  onClick,
  onContextMenu,
}: {
  indent: number;
  label: string;
  icon: React.ReactNode;
  sectionKey?: string;
  expanded: boolean;
  /**
   * Nothing to expand into. The row stays — it is where the object's own
   * "New…" action lives, and hiding it would take that away exactly when it is
   * needed — but it stops looking navigable.
   */
  empty?: boolean;
  onClick: () => void;
  /** Carries the category's own action — creating the first object of its kind */
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={empty ? undefined : onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "relative flex w-full items-center gap-1.5 py-0.5 text-left transition-colors rounded-sm whitespace-nowrap",
        empty ? "cursor-default opacity-45" : "hover:bg-sidebar-accent",
      )}
      style={{ paddingLeft: `${indent}px` }}
    >
      <IndentGuides indent={indent} />
      <span className="shrink-0">{icon}</span>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {/* No chevron when there is nothing behind it: the row is a place to
          create, not a branch to open. */}
      {!empty &&
        (expanded ? (
          <ChevronDown className="ml-auto mr-1 h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="ml-auto mr-1 h-3 w-3 shrink-0 text-muted-foreground" />
        ))}
    </button>
  );
}
