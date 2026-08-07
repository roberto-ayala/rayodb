import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import { IndentGuides } from "./indent-guides";

/**
 * The chevron owns expansion, the row body owns the action. Rows with nothing
 * to do but expand pass only `onClick` and both halves fall back to it.
 */
export function TreeRow({
  indent,
  icon,
  label,
  bold,
  expanded,
  loading: isLoading,
  meta,
  trailing,
  selected,
  onClick,
  onToggle,
  onDoubleClick,
  onContextMenu,
}: {
  indent: number;
  icon: React.ReactNode;
  label: string;
  bold?: boolean;
  expanded?: boolean;
  loading?: boolean;
  /** Sits next to the label; the right edge belongs to the chevron */
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  onToggle?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the row's own buttons carry the interaction; this only forwards the context menu
    <div
      onContextMenu={onContextMenu}
      className={cn(
        "relative flex w-full items-center gap-1.5 rounded-sm text-left text-sm transition-colors whitespace-nowrap",
        selected ? "bg-primary/10 text-foreground" : "hover:bg-hover",
      )}
    >
      <IndentGuides indent={indent} />
      <button
        type="button"
        onClick={onClick ?? onToggle}
        onDoubleClick={onDoubleClick}
        className="flex flex-1 items-center gap-1.5 py-1 text-left"
        style={{ paddingLeft: `${indent}px` }}
      >
        <span className="shrink-0">{icon}</span>
        <span className={cn("text-xs", bold && "font-semibold")}>{label}</span>
        {meta && <span className="shrink-0 text-3xs text-muted-foreground">{meta}</span>}
      </button>
      {/* Chevron sits on the right so that every icon keeps its indent column */}
      <span className="ml-auto mr-1 flex shrink-0 items-center gap-1.5">
        {expanded !== undefined &&
          (isLoading ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <button
              type="button"
              onClick={onToggle ?? onClick}
              aria-label={expanded ? "Collapse" : "Expand"}
              className="flex items-center rounded-sm p-0.5 hover:bg-sidebar-accent"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
            </button>
          ))}
        {trailing}
      </span>
    </div>
  );
}
