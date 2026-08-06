import { PanelSection, tableClasses } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import type { ActivityRow } from "./types";

interface ActivityTabProps {
  activity: ActivityRow[];
}

export function ActivityTab({ activity }: ActivityTabProps) {
  return (
    <PanelSection>
      <div className={tableClasses.wrapper}>
        <table className={tableClasses.table}>
          <thead>
            <tr className={tableClasses.head}>
              {["PID", "User", "State", "Duration", "Wait", "Backend", "Client", "Query"].map(
                (h) => (
                  <th key={h} className={tableClasses.th}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {activity.map((row) => (
              <tr key={row.pid} className={tableClasses.row}>
                <td className={tableClasses.td}>{row.pid}</td>
                <td className={tableClasses.td}>{row.user}</td>
                <td className="px-2 py-1">
                  <span
                    className={cn(
                      "inline-block rounded px-1.5 py-0.5 text-3xs",
                      row.state === "active" &&
                        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                      row.state === "idle" &&
                        "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                      row.state === "idle in transaction" &&
                        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                    )}
                  >
                    {row.state}
                  </span>
                </td>
                <td className={tableClasses.td}>{parseFloat(row.durationSec).toFixed(1)}s</td>
                <td className={cn(tableClasses.td, "text-muted-foreground")}>
                  {row.waitEvent || "-"}
                </td>
                <td className={cn(tableClasses.td, "text-muted-foreground")}>{row.backendType}</td>
                <td className={cn(tableClasses.td, "text-muted-foreground")}>{row.clientAddr}</td>
                <td
                  className="max-w-[300px] truncate px-2 py-1 text-3xs text-muted-foreground"
                  title={row.query}
                >
                  {row.query}
                </td>
              </tr>
            ))}
            {activity.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                  No active connections
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PanelSection>
  );
}
