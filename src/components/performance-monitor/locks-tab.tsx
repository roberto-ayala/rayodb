import { PanelSection, tableClasses } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import type { LockRow } from "./types";

interface LocksTabProps {
  locks: LockRow[];
  waitingLocks: LockRow[];
}

export function LocksTab({ locks, waitingLocks }: LocksTabProps) {
  return (
    <div className="space-y-2">
      {waitingLocks.length > 0 && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 dark:border-yellow-700 dark:bg-yellow-900/20">
          <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">
            {waitingLocks.length} lock{waitingLocks.length !== 1 ? "s" : ""} waiting to be granted
          </span>
        </div>
      )}
      <PanelSection>
        <div className={tableClasses.wrapper}>
          <table className={tableClasses.table}>
            <thead>
              <tr className={tableClasses.head}>
                {[
                  "PID",
                  "User",
                  "Mode",
                  "Lock Type",
                  "Status",
                  "Relation",
                  "Duration",
                  "Query",
                ].map((h) => (
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
              {locks.map((row, idx) => (
                <tr
                  key={`${row.pid}-${row.mode}-${row.locktype}-${idx}`}
                  className={cn(
                    "hover:bg-muted/30",
                    row.status === "waiting" && "bg-yellow-50/50 dark:bg-yellow-900/10",
                  )}
                >
                  <td className={tableClasses.td}>{row.pid}</td>
                  <td className={tableClasses.td}>{row.user}</td>
                  <td className={tableClasses.td}>{row.mode}</td>
                  <td className={cn(tableClasses.td, "text-muted-foreground")}>{row.locktype}</td>
                  <td className="px-2 py-1">
                    <span
                      className={cn(
                        "inline-block rounded px-1.5 py-0.5 text-3xs",
                        row.status === "granted" &&
                          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                        row.status === "waiting" &&
                          "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className={tableClasses.td}>{row.relation || "-"}</td>
                  <td className={tableClasses.td}>{parseFloat(row.duration || "0").toFixed(1)}s</td>
                  <td
                    className="max-w-[300px] truncate px-2 py-1 text-3xs text-muted-foreground"
                    title={row.query}
                  >
                    {row.query}
                  </td>
                </tr>
              ))}
              {locks.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                    No active locks
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PanelSection>
    </div>
  );
}
