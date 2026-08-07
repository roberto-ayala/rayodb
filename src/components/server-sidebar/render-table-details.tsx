import { Columns3, Copy, Key } from "lucide-react";
import { I } from "./constants";
import type { SidebarRenderCtx } from "./types";

/**
 * Columns are the one piece of metadata worth reading while writing SQL, so
 * they live in the tree. Indexes, constraints, triggers, rules and policies are
 * consulted deliberately — they belong to the properties modal, which has the
 * room to show them properly.
 */
export function renderTableDetails(
  ctx: SidebarRenderCtx,
  pid: string,
  schema: string,
  tableName: string,
) {
  const { columnDetails, indexes, showMenu, copy } = ctx;
  const metaKey = `${pid}::${schema}::${tableName}`;
  const cols = columnDetails[metaKey];
  const pkCols = new Set(
    (indexes[metaKey] ?? []).filter((i) => i.isPrimary).map((i) => i.columnName),
  );

  if (!cols) return null;

  return cols.map((c) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: a column is a label, not a control — only its context menu acts
    <div
      key={c.name}
      className="relative flex items-center gap-1.5 py-0.5 hover:bg-sidebar-accent rounded-sm whitespace-nowrap"
      style={{ paddingLeft: `${I.section}px` }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenu(e, [
          {
            label: "Copy Column Name",
            icon: <Copy className="h-3 w-3" />,
            onClick: () => copy(c.name),
          },
        ]);
      }}
    >
      {pkCols.has(c.name) ? (
        <Key className="h-3 w-3 shrink-0 text-warning" />
      ) : (
        <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground/50" />
      )}
      <span className="text-xs text-foreground">{c.name}</span>
      <span className="text-3xs text-muted-foreground">{c.dataType}</span>
      {c.nullable && <span className="text-3xs text-muted-foreground/40">NULL</span>}
    </div>
  ));
}
