import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DriverFactory } from "@/lib/database-driver";
import { saveTextFile } from "@/lib/export";
import { useProjectStore } from "@/stores/project-store";
import type { ColumnDetail, IndexDetail } from "@/types";
import {
  createGestureHandlers,
  createHandleMouseDown,
  createHandleMouseMove,
  createHandleMouseUp,
  createHandleWheel,
  ERDStatusBar,
  ERDToolbar,
  MAX_ZOOM,
  MIN_ZOOM,
} from "./interactions";
import { layoutTables } from "./layout";
import { ERDDefs, ERDFKLines, ERDGridBackground, ERDTableBoxes } from "./rendering";
import { erdFileName, serialiseERD } from "./svg-export";
import { useTableDetails } from "./table-details";
import type { ERDColumn, ERDProps, ForeignKey } from "./types";

export function ERDDiagram({ projectId, schema }: ERDProps) {
  const [fks, setFks] = useState<ForeignKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [tablePositions, setTablePositions] = useState<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState<{ type: "pan" | "table"; tableName?: string } | null>(
    null,
  );
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const detailsLoadedRef = useRef(false);

  const tables = useProjectStore((s) => s.tables);
  const columnDetails = useProjectStore((s) => s.columnDetails);
  const indexes = useProjectStore((s) => s.indexes);
  const loadColumnDetails = useProjectStore((s) => s.loadColumnDetails);
  const loadIndexes = useProjectStore((s) => s.loadIndexes);
  const loadTables = useProjectStore((s) => s.loadTables);
  // The diagram may be opened, or restored from a previous session, before the
  // connection is up — so it reloads when the project reaches Connected
  const connectionStatus = useProjectStore((s) => s.status[projectId]);

  const key = `${projectId}::${schema}`;
  const schemaTables = tables[key] ?? [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: connectionStatus and reloadToken are triggers, not inputs — the effect exists to re-run when the project connects or the user retries
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    detailsLoadedRef.current = false;

    async function load() {
      // Read from store directly to avoid stale closure
      const d = useProjectStore.getState().projects[projectId];
      if (!d) {
        setLoading(false);
        return;
      }

      const driver = DriverFactory.getDriver(d.driver);

      let loadedFks: ForeignKey[] = [];
      const [tableResult, fkResult] = await Promise.allSettled([
        loadTables(projectId, schema),
        driver.loadForeignKeys(projectId, schema),
      ]);

      if (fkResult.status === "fulfilled") {
        loadedFks = fkResult.value;
      } else {
        console.warn("ERD: Failed to load foreign keys:", fkResult.reason);
      }

      // Without this the failure reads as an empty schema, which is a
      // different thing and sends you looking in the wrong place
      if (tableResult.status === "rejected") {
        const reason = tableResult.reason;
        if (!cancelled) {
          setLoadError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
        return;
      }

      if (cancelled) return;
      setFks(loadedFks);

      const currentTables = useProjectStore.getState().tables[`${projectId}::${schema}`] ?? [];
      if (currentTables.length === 0) {
        setLoading(false);
        return;
      }

      // Fire-and-forget: column details + indexes for each table
      const detailPromises = currentTables.map((t) => {
        const detailKey = `${projectId}::${schema}::${t.name}`;
        const state = useProjectStore.getState();
        const tasks: Promise<unknown>[] = [];
        if (!state.columnDetails[detailKey]) {
          tasks.push(loadColumnDetails(projectId, schema, t.name).catch(() => {}));
        }
        if (!state.indexes[detailKey]) {
          tasks.push(loadIndexes(projectId, schema, t.name).catch(() => {}));
        }
        return Promise.all(tasks);
      });

      Promise.all(detailPromises).finally(() => {
        if (!cancelled) detailsLoadedRef.current = true;
      });

      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    schema,
    connectionStatus,
    reloadToken,
    loadColumnDetails,
    loadTables,
    loadIndexes,
  ]);

  const detailsReady =
    schemaTables.length === 0 ||
    schemaTables.some((t) => {
      const detailKey = `${projectId}::${schema}::${t.name}`;
      return columnDetails[detailKey] != null;
    });

  const tableData = useMemo(() => {
    if (!detailsReady) return [];

    const fkColumns = new Set<string>();
    for (const fk of fks) {
      fkColumns.add(`${fk.sourceTable}.${fk.sourceColumn}`);
      fkColumns.add(`${fk.targetTable}.${fk.targetColumn}`);
    }

    return schemaTables.map((t) => {
      const detailKey = `${projectId}::${schema}::${t.name}`;
      const details: ColumnDetail[] = columnDetails[detailKey] ?? [];
      const idxs: IndexDetail[] = indexes[detailKey] ?? [];
      const pkCols = new Set(idxs.filter((i) => i.isPrimary).map((i) => i.columnName));

      const cols: ERDColumn[] = details.map((d) => ({
        name: d.name,
        type: d.dataType,
        nullable: d.nullable,
        isPK: pkCols.has(d.name),
        isFK: fkColumns.has(`${t.name}.${d.name}`),
      }));

      return { name: t.name, columns: cols };
    });
  }, [schemaTables, columnDetails, indexes, fks, projectId, schema, detailsReady]);

  const initialBoxes = useMemo(() => layoutTables(tableData, fks), [tableData, fks]);

  const boxes = useMemo(() => {
    if (tablePositions.size === 0) return initialBoxes;
    return initialBoxes.map((b) => {
      const pos = tablePositions.get(b.name);
      return pos ? { ...b, x: pos.x, y: pos.y } : b;
    });
  }, [initialBoxes, tablePositions]);

  const boxMap = useMemo(() => new Map(boxes.map((b) => [b.name, b])), [boxes]);

  const totalWidth = Math.max(800, ...boxes.map((b) => b.x + b.width + 60));
  const totalHeight = Math.max(600, ...boxes.map((b) => b.y + b.height + 60));

  const { connectedTables, connectedFKs } = useTableDetails(hoveredTable, fks);

  // The handler reads the live view through a ref, so it can be attached once
  const viewRef = useRef({ zoom, pan });
  viewRef.current = { zoom, pan };
  /**
   * The listeners go on through the ref rather than an effect: the diagram
   * renders a spinner first, so on mount there is no element to attach to and
   * an effect would never run again once one appeared.
   *
   * They are also native rather than React's own, because React registers
   * wheel handlers passively — preventDefault there does nothing, and the
   * webview would zoom itself on a pinch.
   */
  const attachViewport = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (!el) return;

    const onWheel = createHandleWheel(containerRef, viewRef, setZoom, setPan);
    const gesture = createGestureHandlers(containerRef, viewRef, setZoom, setPan);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", gesture.onStart, { passive: false });
    el.addEventListener("gesturechange", gesture.onChange, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", gesture.onStart);
      el.removeEventListener("gesturechange", gesture.onChange);
      containerRef.current = null;
    };
  }, []);

  /**
   * Rebuilt each render on purpose. Memoising them with an empty dependency
   * list froze the first render's values, and on the first render the diagram
   * is still loading: boxMap was empty, so no table could ever be picked up,
   * and dragging was null, so no movement was ever acted on.
   */
  const handleMouseDown = createHandleMouseDown(pan, zoom, boxMap, setDragging, setDragStart);
  const handleMouseMove = createHandleMouseMove(
    dragging,
    dragStart,
    zoom,
    setPan,
    setTablePositions,
  );
  const handleMouseUp = createHandleMouseUp(setDragging);

  /** The buttons zoom about the middle of the view, as the wheel does about the pointer */
  const zoomBy = useCallback((factor: number) => {
    const el = containerRef.current;
    const { zoom, pan } = viewRef.current;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    if (next === zoom) return;
    const cx = el ? el.clientWidth / 2 : 0;
    const cy = el ? el.clientHeight / 2 : 0;
    const ratio = next / zoom;
    setPan({ x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio });
    setZoom(next);
  }, []);

  const fitToView = useCallback(() => {
    if (!containerRef.current || boxes.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / totalWidth;
    const scaleY = rect.height / totalHeight;
    const newZoom = Math.min(scaleX, scaleY) * 0.9;
    setZoom(Math.min(2, Math.max(0.1, newZoom)));
    setPan({ x: 10, y: 10 });
  }, [boxes, totalWidth, totalHeight]);

  const exportSVG = useCallback(async () => {
    if (!svgRef.current) return;
    try {
      const content = serialiseERD(svgRef.current, totalWidth, totalHeight);
      const database = useProjectStore.getState().projects[projectId]?.database ?? projectId;
      const filePath = await saveTextFile(
        erdFileName(database, schema),
        "SVG Image",
        "svg",
        content,
      );
      if (filePath) toast.success("Diagram exported", { description: filePath });
    } catch (err: unknown) {
      toast.error("Could not export the diagram", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [totalWidth, totalHeight, schema, projectId]);

  if (loading || (!detailsReady && schemaTables.length > 0)) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading ERD...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="text-sm text-destructive">Could not read schema "{schema}"</span>
        <span className="max-w-lg text-xs text-muted-foreground">{loadError}</span>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => setReloadToken((t) => t + 1)}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (boxes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <span className="text-sm">No tables found in schema "{schema}"</span>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <ERDToolbar zoomBy={zoomBy} fitToView={fitToView} exportSVG={exportSVG} />

      <ERDStatusBar boxCount={boxes.length} fkCount={fks.length} zoom={zoom} />

      <div
        ref={attachViewport}
        className="h-full cursor-grab active:cursor-grabbing bg-background"
        onMouseDown={(e) => handleMouseDown(e)}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${totalWidth} ${totalHeight}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <ERDDefs />

          <ERDGridBackground totalWidth={totalWidth} totalHeight={totalHeight} />

          <ERDFKLines
            fks={fks}
            boxMap={boxMap}
            hoveredTable={hoveredTable}
            connectedFKs={connectedFKs}
          />

          <ERDTableBoxes
            boxes={boxes}
            hoveredTable={hoveredTable}
            connectedTables={connectedTables}
            onMouseDown={handleMouseDown}
            onTableEnter={setHoveredTable}
            onTableLeave={() => setHoveredTable(null)}
          />
        </svg>
      </div>
    </div>
  );
}
