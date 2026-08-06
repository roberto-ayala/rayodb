import {
  type GridCell,
  GridCellKind,
  type GridColumn,
  type Item,
  type Theme,
} from "@glideapps/glide-data-grid";
import { themeColor } from "@/lib/theme-color";
import { CODE_FONT_FAMILY, codeFontSize } from "@/lib/typography";
import * as virtualCache from "@/lib/virtual-cache";
import type { VirtualQuery } from "@/types";

export const MIN_COL_WIDTH = 80;
export const MAX_COL_WIDTH = 400;
export const CHAR_WIDTH = 7.5;
export const PADDING = 24;
export const GRID_ROW_HEIGHT = 32;

// Pre-allocated static cell for unloaded virtual rows — avoids GC pressure
export const LOADING_CELL: GridCell = {
  kind: GridCellKind.Text,
  data: "",
  displayData: "…",
  allowOverlay: false,
  readonly: true,
  themeOverride: { textDark: "#888", textLight: "#666" },
};

export const DELETED_OVERRIDE = {
  bgCell: "rgba(239, 68, 68, 0.1)",
  textDark: "#999",
  textLight: "#999",
};

export function buildModifiedOverride(theme: string) {
  return { bgCell: theme === "dark" ? "rgba(245, 158, 11, 0.15)" : "rgba(245, 158, 11, 0.1)" };
}

export const FK_OVERRIDE = { textDark: "hsl(220, 70%, 50%)", textLight: "hsl(220, 70%, 65%)" };

export function computeGridColumns(columns: string[], rows: string[][]): GridColumn[] {
  const sampleRows = rows.slice(0, 100);
  return columns.map((col, colIdx) => {
    let maxLen = col.length + 2;
    for (const row of sampleRows) {
      const cellLen = (row[colIdx] ?? "").length;
      if (cellLen > maxLen) maxLen = cellLen;
    }
    const width = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, maxLen * CHAR_WIDTH + PADDING));
    return { title: col, id: col, width };
  });
}

export function computeFkColIndices(
  columns: string[],
  fkColumns?: Map<string, { schema: string; table: string; column: string }>,
): Set<number> {
  if (!fkColumns || fkColumns.size === 0) return new Set<number>();
  const s = new Set<number>();
  columns.forEach((col, idx) => {
    if (fkColumns.has(col)) s.add(idx);
  });
  return s;
}

export interface CellContentContext {
  rows: string[][];
  cellEdits?: Map<string, string>;
  deletedRows?: Set<number>;
  isEditing?: boolean;
  fkColIndices: Set<number>;
  virtualQuery?: VirtualQuery;
  onPageNeeded?: (pageIndex: number) => void;
  deletedOverride: typeof DELETED_OVERRIDE;
  modifiedOverride: ReturnType<typeof buildModifiedOverride>;
  fkOverride: typeof FK_OVERRIDE;
}

export function buildCellContent(cell: Item, ctx: CellContentContext): GridCell {
  const [colIdx, rowIdx] = cell;
  const {
    rows,
    cellEdits,
    deletedRows,
    isEditing,
    fkColIndices,
    virtualQuery,
    onPageNeeded,
    deletedOverride,
    modifiedOverride,
    fkOverride,
  } = ctx;

  // Virtual mode: read from cache
  if (virtualQuery) {
    const pageIndex = Math.floor(rowIdx / virtualQuery.pageSize);
    const row = virtualCache.getRow(virtualQuery.queryId, rowIdx, virtualQuery.pageSize);
    if (!row) {
      onPageNeeded?.(pageIndex);
      const fallbackRow = rows[rowIdx];
      if (!fallbackRow) return LOADING_CELL;
      const value = fallbackRow[colIdx] ?? "";
      return {
        kind: GridCellKind.Text,
        data: value,
        displayData: value,
        allowOverlay: false,
        readonly: true,
      };
    }
    const value = row[colIdx] ?? "";
    return {
      kind: GridCellKind.Text,
      data: value,
      displayData: value,
      allowOverlay: false,
      readonly: true,
    };
  }

  const key = `${rowIdx}:${colIdx}`;
  const isModified = cellEdits?.has(key);
  const isDeleted = deletedRows?.has(rowIdx);
  const isFK = fkColIndices.has(colIdx) && !isEditing;
  const value = isModified ? (cellEdits?.get(key) ?? "") : (rows[rowIdx]?.[colIdx] ?? "");

  const baseCell: GridCell = {
    kind: GridCellKind.Text,
    data: value,
    displayData: isFK && value !== "null" ? `${value} →` : value,
    allowOverlay: !!isEditing && !isDeleted,
    readonly: !isEditing || !!isDeleted,
    themeOverride: isDeleted
      ? deletedOverride
      : isModified
        ? modifiedOverride
        : isFK && value !== "null"
          ? fkOverride
          : undefined,
  };

  return baseCell;
}

/**
 * Resolve a theme token to a concrete color. The grid paints on canvas, which
 * cannot read CSS variables, so values are read from the document and
 * normalised through a 2d context — the tokens are oklch, which the grid's own
 * colour maths does not parse.
 */
export function buildGridTheme(_theme: string): Partial<Theme> {
  return {
    accentColor: themeColor("--primary"),
    accentLight: themeColor("--primary", 0.12),
    bgCell: themeColor("--card"),
    bgCellMedium: themeColor("--muted", 0.35),
    bgHeader: themeColor("--table-header"),
    bgHeaderHasFocus: themeColor("--accent"),
    bgHeaderHovered: themeColor("--accent", 0.7),
    borderColor: themeColor("--border"),
    drilldownBorder: themeColor("--border"),
    fontFamily: CODE_FONT_FAMILY,
    headerFontStyle: `600 ${codeFontSize()}px`,
    baseFontStyle: `${codeFontSize()}px`,
    textDark: themeColor("--foreground"),
    textMedium: themeColor("--muted-foreground"),
    textLight: themeColor("--muted-foreground", 0.7),
    textHeader: themeColor("--foreground"),
    textHeaderSelected: themeColor("--primary"),
    bgBubble: themeColor("--muted"),
    bgBubbleSelected: themeColor("--primary"),
    textBubble: themeColor("--foreground"),
  };
}
