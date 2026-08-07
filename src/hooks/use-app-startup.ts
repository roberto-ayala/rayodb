import { useEffect, useRef } from "react";
import { startBackgroundUpdateCheck } from "@/lib/updater";
import { useProjectStore } from "@/stores/project-store";

export function useAppStartup() {
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const projects = useProjectStore((s) => s.projects);
  const connect = useProjectStore((s) => s.connect);
  const autoConnected = useRef(false);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Open the connections flagged with "Connect on startup", once per session.
  useEffect(() => {
    if (autoConnected.current) return;
    const ids = Object.keys(projects);
    if (ids.length === 0) return;
    autoConnected.current = true;
    for (const id of ids) {
      if (projects[id]?.autoConnect === "true") void connect(id);
    }
  }, [projects, connect]);

  useEffect(() => {
    startBackgroundUpdateCheck();
  }, []);
}
