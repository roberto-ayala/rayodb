import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import { IndentGuides } from "./indent-guides";

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
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={cn(
        "relative flex w-full items-center gap-1.5 py-1 text-left text-sm transition-colors rounded-sm whitespace-nowrap",
        selected ? "bg-primary/10 text-foreground" : "hover:bg-hover",
      )}
      style={{ paddingLeft: `${indent}px` }}
    >
      <IndentGuides indent={indent} />
      <span className="shrink-0">{icon}</span>
      <span className={cn("font-mono text-xs", bold && "font-semibold")}>{label}</span>
      {meta && <span className="shrink-0 font-mono text-3xs text-muted-foreground">{meta}</span>}
      {/* Chevron sits on the right so that every icon keeps its indent column */}
      <span className="ml-auto mr-1 flex shrink-0 items-center gap-1.5">
        {expanded !== undefined &&
          (isLoading ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
          ) : expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          ))}
        {trailing}
      </span>
    </button>
  );
}
