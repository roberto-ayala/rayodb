import {
  CheckCircle2,
  Clock,
  Diff,
  Edit3,
  GitBranch,
  History,
  Loader2,
  Map as MapIcon,
  Pin,
  Rows3,
  Search,
  Square,
  Table2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";
import { hasGeometryColumn } from "../results-map";
import { ToolbarEdit } from "./toolbar-edit";
import { ToolbarExport } from "./toolbar-export";
import type { PanelView, ToolbarProps } from "./types";

export function ResultsToolbar(props: ToolbarProps) {
  const {
    panelView,
    setPanelView,
    result,
    columns,
    filteredRows,
    searchTerm,
    setSearchTerm,
    filteredCount,
    setViewMode,
    hasExplain,
    isExecuting,
    isEditing,
    editState,
    editableTable,
    isCommitting,
    editError,
    onEnterEdit,
    onCommit,
    onDeleteRows,
    onConfirmDelete,
    onCancelDelete,
    pendingDeleteCount,
    onDiscard,
    onCancel,
    virtualQuery,
  } = props;

  const pinnedResult = useUIStore((s) => s.pinnedResult);
  const pinResult = useUIStore((s) => s.pinResult);
  const clearPinnedResult = useUIStore((s) => s.clearPinnedResult);

  // panelView is the single source of truth for which view is on screen;
  // viewMode only remembers which of grid/record to return to.
  const views: { id: PanelView; label: string; icon: typeof Table2; disabled?: boolean }[] = [
    { id: "grid", label: "Grid", icon: Table2 },
    {
      id: "record",
      label: "Record",
      icon: Rows3,
      disabled: !result?.rows.length || !!virtualQuery,
    },
    ...(hasExplain ? [{ id: "explain" as const, label: "Explain", icon: GitBranch }] : []),
    { id: "history", label: "History", icon: History },
    ...(result && hasGeometryColumn(columns, filteredRows)
      ? [{ id: "map" as const, label: "Map", icon: MapIcon }]
      : []),
  ];

  return (
    <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* Panel tabs — segmented control */}
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
          {views.map(({ id, label, icon: Icon, disabled }) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => {
                setPanelView(id);
                if (id === "grid" || id === "record") setViewMode(id);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40",
                panelView === id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        {/* Result stats */}
        {panelView !== "history" && result && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isExecuting ? (
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-success" />
            )}
            <span>
              {virtualQuery
                ? `${virtualQuery.totalRows.toLocaleString()} rows (virtual)`
                : searchTerm
                  ? `${filteredCount.toLocaleString()} / ${result.rows.length.toLocaleString()} rows`
                  : `${result.rows.length.toLocaleString()} rows`}
              {result.capped && !virtualQuery && (
                <span className="text-warning ml-1">(capped at 500K)</span>
              )}
            </span>
            <span className="text-muted-foreground/50">&bull;</span>
            <Clock className="h-3 w-3" />
            <span>{result.time.toFixed(0)}ms</span>
            {isEditing && editState?.cellEdits.size ? (
              <>
                <span className="text-muted-foreground/50">&bull;</span>
                <span className="text-amber-500 font-medium">
                  {editState.cellEdits.size} edit{editState.cellEdits.size !== 1 ? "s" : ""}
                </span>
              </>
            ) : null}
            {isEditing && editState?.deletedRows.size ? (
              <>
                <span className="text-muted-foreground/50">&bull;</span>
                <span className="text-destructive font-medium">
                  {editState.deletedRows.size} delete{editState.deletedRows.size !== 1 ? "s" : ""}
                </span>
              </>
            ) : null}
          </div>
        )}

        {/* Stop button — visible while executing */}
        {isExecuting && onCancel && (
          <Button variant="destructive" size="sm" onClick={onCancel} className="">
            <Square className="h-3 w-3" />
            Stop
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Edit mode controls */}
        {isEditing ? (
          <ToolbarEdit
            editState={editState}
            editError={editError}
            isCommitting={isCommitting}
            pendingDeleteCount={pendingDeleteCount}
            onCommit={onCommit}
            onDeleteRows={onDeleteRows}
            onConfirmDelete={onConfirmDelete}
            onCancelDelete={onCancelDelete}
            onDiscard={onDiscard}
          />
        ) : (
          <>
            {/* Edit button */}
            {panelView !== "history" && editableTable && result && result.rows.length > 0 && (
              <Button
                variant="subtle"
                size="sm"
                onClick={onEnterEdit}
                className=""
                title="Edit table data inline"
              >
                <Edit3 className="h-3 w-3" />
                Edit
              </Button>
            )}

            {/* Pin / Diff */}
            {panelView !== "history" && result && result.rows.length > 0 && !virtualQuery && (
              <>
                {pinnedResult ? (
                  <div className="flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 text-xs text-primary">
                    <Pin className="h-3 w-3" />
                    <span>Pinned: {pinnedResult.label}</span>
                    <button
                      type="button"
                      onClick={clearPinnedResult}
                      className="hover:text-destructive ml-1"
                      title="Clear pinned result"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() =>
                      pinResult(
                        { columns, rows: filteredRows, time: result.time },
                        `${filteredRows.length} rows`,
                      )
                    }
                    className=""
                    title="Pin current results for later diff comparison"
                  >
                    <Pin className="h-3 w-3" />
                    Pin
                  </Button>
                )}
                {pinnedResult && (
                  <Button
                    variant={panelView === "diff" ? "default" : "subtle"}
                    size="sm"
                    onClick={() => setPanelView(panelView === "diff" ? "grid" : "diff")}
                    className=""
                  >
                    <Diff className="h-3 w-3" />
                    Diff
                  </Button>
                )}
              </>
            )}

            {/* Export dropdown */}
            {panelView !== "history" && result && result.rows.length > 0 && !virtualQuery && (
              <ToolbarExport columns={columns} filteredRows={filteredRows} hasResult={!!result} />
            )}

            {/* Search */}
            {panelView !== "history" && result && !virtualQuery && (
              <div className="relative flex items-center">
                <Search className="absolute left-2 h-3 w-3 text-muted-foreground pointer-events-none" />
                <Input
                  size="sm"
                  type="text"
                  placeholder="Search results..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-48 pl-7 pr-7"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
