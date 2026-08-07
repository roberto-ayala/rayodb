import { Download, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import type { TableBox } from "./types";

export type DragState = { type: "pan" | "table"; tableName?: string } | null;
export type Point = { x: number; y: number };

interface ERDToolbarProps {
  zoomBy: (factor: number) => void;
  fitToView: () => void;
  exportSVG: () => void;
}

export function ERDToolbar({ zoomBy, fitToView, exportSVG }: ERDToolbarProps) {
  return (
    <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => zoomBy(1.2)}
        className="p-1.5 rounded bg-card border border-border hover:bg-accent transition-colors shadow-sm"
        title="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => zoomBy(0.8)}
        className="p-1.5 rounded bg-card border border-border hover:bg-accent transition-colors shadow-sm"
        title="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={fitToView}
        className="p-1.5 rounded bg-card border border-border hover:bg-accent transition-colors shadow-sm"
        title="Fit to view"
      >
        <Maximize className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={exportSVG}
        className="p-1.5 rounded bg-card border border-border hover:bg-accent transition-colors shadow-sm"
        title="Export SVG"
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ERDStatusBarProps {
  boxCount: number;
  fkCount: number;
  zoom: number;
}

export function ERDStatusBar({ boxCount, fkCount, zoom }: ERDStatusBarProps) {
  return (
    <div className="absolute bottom-3 right-3 z-20 text-xs text-muted-foreground bg-card/80 border border-border rounded px-2 py-0.5 flex gap-2">
      <span>{boxCount} tables</span>
      <span>{fkCount} FKs</span>
      <span>{Math.round(zoom * 100)}%</span>
    </div>
  );
}

// Pure handler factories — invoked inside useCallback in index.tsx so the
// hook order in the parent component is preserved exactly.

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;

/** Roughly 18% per mouse notch, and proportionally less for a trackpad nudge */
const ZOOM_PER_PIXEL = 0.002;

/** Wheel events arrive in pixels, lines or pages depending on the device */
function pixelDelta(value: number, mode: number): number {
  if (mode === 1) return value * 16;
  if (mode === 2) return value * 100;
  return value;
}

/**
 * The wheel pans and the modifier zooms, which is also what a trackpad sends:
 * two fingers arrive as a plain wheel, a pinch arrives as ctrl + wheel.
 *
 * Zoom follows the size of the gesture rather than counting events. A fixed
 * step per event is what made this unusable: one trackpad swipe fires dozens of
 * them, so a nudge compounded into an enormous jump.
 */
export function createHandleWheel(
  container: React.RefObject<HTMLDivElement | null>,
  view: React.RefObject<{ zoom: number; pan: Point }>,
  setZoom: React.Dispatch<React.SetStateAction<number>>,
  setPan: React.Dispatch<React.SetStateAction<Point>>,
) {
  return (e: WheelEvent) => {
    e.preventDefault();
    const { zoom, pan } = view.current;
    const dx = pixelDelta(e.deltaX, e.deltaMode);
    const dy = pixelDelta(e.deltaY, e.deltaMode);

    if (!e.ctrlKey && !e.metaKey) {
      setPan({ x: pan.x - dx, y: pan.y - dy });
      return;
    }

    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-dy * ZOOM_PER_PIXEL)));
    if (next === zoom) return;

    // Keep whatever is under the pointer under the pointer
    const rect = container.current?.getBoundingClientRect();
    const cx = rect ? e.clientX - rect.left : 0;
    const cy = rect ? e.clientY - rect.top : 0;
    const ratio = next / zoom;
    setPan({ x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio });
    setZoom(next);
  };
}

export function createHandleMouseDown(
  pan: Point,
  zoom: number,
  boxMap: Map<string, TableBox>,
  setDragging: React.Dispatch<React.SetStateAction<DragState>>,
  setDragStart: React.Dispatch<React.SetStateAction<Point>>,
) {
  return (e: React.MouseEvent, tableName?: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (tableName) {
      const box = boxMap.get(tableName);
      if (!box) return;
      setDragging({ type: "table", tableName });
      setDragStart({ x: e.clientX / zoom - box.x, y: e.clientY / zoom - box.y });
    } else {
      setDragging({ type: "pan" });
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };
}

export function createHandleMouseMove(
  dragging: DragState,
  dragStart: Point,
  zoom: number,
  setPan: React.Dispatch<React.SetStateAction<Point>>,
  setTablePositions: React.Dispatch<React.SetStateAction<Map<string, Point>>>,
) {
  return (e: React.MouseEvent) => {
    if (!dragging) return;
    if (dragging.type === "pan") {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    } else if (dragging.type === "table" && dragging.tableName) {
      const newX = e.clientX / zoom - dragStart.x;
      const newY = e.clientY / zoom - dragStart.y;
      setTablePositions((prev) => {
        const next = new Map(prev);
        next.set(dragging.tableName!, { x: Math.max(0, newX), y: Math.max(0, newY) });
        return next;
      });
    }
  };
}

export function createHandleMouseUp(setDragging: React.Dispatch<React.SetStateAction<DragState>>) {
  return () => {
    setDragging(null);
  };
}
