import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { IndentGuides } from "./indent-guides";

export function SectionHeader({
  indent,
  label,
  icon,
  expanded,
  onClick,
  onContextMenu,
}: {
  indent: number;
  label: string;
  icon: React.ReactNode;
  sectionKey?: string;
  expanded: boolean;
  onClick: () => void;
  /** Carries the category's own action — creating the first object of its kind */
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="relative flex w-full items-center gap-1.5 py-0.5 text-left hover:bg-sidebar-accent transition-colors rounded-sm whitespace-nowrap"
      style={{ paddingLeft: `${indent}px` }}
    >
      <IndentGuides indent={indent} />
      <span className="shrink-0">{icon}</span>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {expanded ? (
        <ChevronDown className="ml-auto mr-1 h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="ml-auto mr-1 h-3 w-3 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
