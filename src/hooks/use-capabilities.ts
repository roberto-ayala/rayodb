import type { DriverCapabilities } from "@/lib/database-driver/capabilities";
import { useDriverCapabilities } from "@/stores/capability-store";
import { useProjectStore } from "@/stores/project-store";

/**
 * What the engine behind `projectId` supports. Gate UI on this rather than on
 * the driver name, so the next engine needs no new conditionals here.
 */
export function useCapabilities(projectId: string | undefined): DriverCapabilities {
  const driver = useProjectStore((s) => (projectId ? s.projects[projectId]?.driver : undefined));
  return useDriverCapabilities(driver);
}
