import { PanelCard, tableClasses } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import type { IndexUsageRow } from "./types";

interface IndexesTabProps {
  indexUsage: IndexUsageRow[];
  unusedIndexCount: number;
}

export function IndexesTab({ indexUsage, unusedIndexCount }: IndexesTabProps) {
  return (
    <div className="space-y-2">
      {unusedIndexCount > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-900/20">
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            {unusedIndexCount} unused index{unusedIndexCount !== 1 ? "es" : ""} found -- consider
            removing to save space and improve write performance
          </span>
        </div>
      )}
      <PanelCard>
        <div className={tableClasses.wrapper}>
          <table className={tableClasses.table}>
            <thead>
              <tr className={tableClasses.head}>
                {["Schema", "Table", "Index", "Size", "Scans", "Status", "Definition"].map((h) => (
                  <th
                    key={h}
                    className="px-2 py-1.5 text-left text-3xs font-semibold text-muted-foreground whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {indexUsage.map((row, idx) => (
                <tr
                  key={`${row.schema}.${row.table}.${row.index}-${idx}`}
                  className={tableClasses.row}
                >
                  <td className={cn(tableClasses.td, "text-muted-foreground")}>{row.schema}</td>
                  <td className={cn(tableClasses.td, "font-medium")}>{row.table}</td>
                  <td className={tableClasses.td}>{row.index}</td>
                  <td className={tableClasses.td}>{row.size}</td>
                  <td className={tableClasses.td}>{parseInt(row.scans, 10).toLocaleString()}</td>
                  <td className="px-2 py-1">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-3xs",
                        row.status === "unused" &&
                          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                        row.status === "rarely_used" &&
                          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                        row.status === "active" &&
                          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                      )}
                    >
                      {row.status === "rarely_used" ? "rarely used" : row.status}
                    </span>
                  </td>
                  <td
                    className="max-w-[400px] truncate px-2 py-1 text-3xs text-muted-foreground"
                    title={row.definition}
                  >
                    {row.definition}
                  </td>
                </tr>
              ))}
              {indexUsage.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                    No non-primary indexes found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </div>
  );
}
