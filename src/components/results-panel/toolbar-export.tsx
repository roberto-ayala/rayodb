import { Copy, Download } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { copyToClipboard, type ExportFormat, exportResults } from "@/lib/export";
import { parseSelectTable } from "@/lib/sql-utils";
import { useProjectStore } from "@/stores/project-store";
import { useActiveTab } from "@/stores/tab-store";

interface ToolbarExportProps {
  columns: string[];
  filteredRows: string[][];
  hasResult: boolean;
}

export function ToolbarExport({ columns, filteredRows, hasResult }: ToolbarExportProps) {
  const activeTab = useActiveTab();
  const projects = useProjectStore((s) => s.projects);

  /** The file is named after where the rows came from, when it can be told */
  const context = () => {
    const projectId = activeTab?.projectId;
    const parsed = activeTab?.editorValue ? parseSelectTable(activeTab.editorValue) : null;
    return {
      database: projectId ? (projects[projectId]?.database ?? projectId) : undefined,
      source: parsed?.table,
    };
  };
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const handleExport = (format: ExportFormat) => {
    if (!hasResult) return;
    void exportResults(format, columns, filteredRows, context());
    setExportOpen(false);
  };

  const handleCopy = (format: ExportFormat) => {
    if (!hasResult) return;
    void copyToClipboard(format, columns, filteredRows);
    setExportOpen(false);
  };

  return (
    <div className="relative" ref={exportRef}>
      <Button variant="subtle" size="sm" onClick={() => setExportOpen(!exportOpen)}>
        <Download className="h-3 w-3" />
        Export
      </Button>
      {exportOpen &&
        createPortal(
          <>
            <div
              className="fixed inset-0"
              style={{ zIndex: 9998 }}
              onClick={() => setExportOpen(false)}
            />
            <div
              className="fixed w-52 rounded-md border border-border bg-popover shadow-md py-1"
              style={{
                zIndex: 9999,
                top: (() => {
                  const r = exportRef.current?.getBoundingClientRect();
                  return r ? r.bottom + 4 : 0;
                })(),
                left: (() => {
                  const r = exportRef.current?.getBoundingClientRect();
                  return r ? Math.max(0, r.right - 208) : 0;
                })(),
              }}
            >
              <div className="px-2 py-1 text-3xs font-semibold text-muted-foreground uppercase tracking-wider">
                Download
              </div>
              {(["csv", "json", "sql", "markdown", "xml"] as ExportFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => handleExport(fmt)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  <Download className="h-3 w-3 text-muted-foreground" />
                  {fmt.toUpperCase()}
                </button>
              ))}
              <div className="border-t border-border my-1" />
              <div className="px-2 py-1 text-3xs font-semibold text-muted-foreground uppercase tracking-wider">
                Copy to clipboard
              </div>
              {(["csv", "json", "sql", "markdown"] as ExportFormat[]).map((fmt) => (
                <button
                  key={`copy-${fmt}`}
                  type="button"
                  onClick={() => handleCopy(fmt)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  <Copy className="h-3 w-3 text-muted-foreground" />
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
