import { useEffect, useRef } from "react";
import { DriverFactory } from "@/lib/database-driver";
import { startBackgroundUpdateCheck } from "@/lib/updater";
import { useCapabilityStore } from "@/stores/capability-store";
import { useProjectStore } from "@/stores/project-store";

export function useAppStartup() {
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const projects = useProjectStore((s) => s.projects);
  const connect = useProjectStore((s) => s.connect);
  const loadCapabilities = useCapabilityStore((s) => s.load);
  const loadDrivers = useCapabilityStore((s) => s.loadDrivers);
  const autoConnected = useRef(false);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Ahead of any connection, so the tree and tabs are gated from the first
  // render rather than filling in late.
  useEffect(() => {
    void loadDrivers();
    for (const driver of DriverFactory.getSupportedDrivers()) {
      void loadCapabilities(driver);
    }
  }, [loadCapabilities, loadDrivers]);

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
