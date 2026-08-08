import { toast } from "sonner";
import type { StateCreator } from "zustand";
import { useQueryStore } from "@/stores/query-store";
import { useTabStore } from "@/stores/tab-store";
import { deleteProject as deleteProjectApi, getProjects, insertProject } from "@/tauri";
import type { DriverType, ProjectConnectionStatus, ProjectDetails, ProjectMap } from "@/types";
import { ProjectConnectionStatus as PCS } from "@/types";
import { clearProjectMetadata } from "./connection";
import type { ProjectState } from "./index";

export type CoreSlice = {
  projects: ProjectMap;
  status: Record<string, ProjectConnectionStatus>;
  connectionErrors: Record<string, string>;
  loadProjects: () => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  saveConnection: (name: string, details: ProjectDetails) => Promise<void>;
  updateConnection: (name: string, details: ProjectDetails) => Promise<void>;
  renameConnection: (oldName: string, newName: string, details: ProjectDetails) => Promise<void>;
  addDatabaseToServer: (sourceProjectId: string, name: string, database: string) => Promise<void>;
};

export function parseProjectDetails(arr: string[]): ProjectDetails {
  return {
    driver: (arr[0] ?? "PGSQL") as DriverType,
    username: arr[1] ?? "",
    password: arr[2] ?? "",
    database: arr[3] ?? "",
    host: arr[4] ?? "",
    port: arr[5] ?? "",
    ssl: arr[6] ?? "false",
    sshEnabled: arr[7] ?? "false",
    sshHost: arr[8] ?? "",
    sshPort: arr[9] ?? "22",
    sshUser: arr[10] ?? "",
    sshPassword: arr[11] ?? "",
    sshKeyPath: arr[12] ?? "",
    autoConnect: arr[13] ?? "false",
    options: arr[14] ?? "",
  };
}

function serializeProjectDetails(details: ProjectDetails): string[] {
  return [
    details.driver,
    details.username,
    details.password,
    details.database,
    details.host,
    details.port,
    details.ssl,
    details.sshEnabled ?? "false",
    details.sshHost ?? "",
    details.sshPort ?? "22",
    details.sshUser ?? "",
    details.sshPassword ?? "",
    details.sshKeyPath ?? "",
    details.autoConnect ?? "false",
    details.options ?? "",
  ];
}

export const createCoreSlice: StateCreator<
  ProjectState,
  [["zustand/immer", never]],
  [],
  CoreSlice
> = (set, get) => ({
  projects: {},
  status: {},
  connectionErrors: {},

  loadProjects: async () => {
    try {
      const raw = await getProjects();
      const projects: ProjectMap = {};
      for (const [id, arr] of Object.entries(raw)) {
        projects[id] = parseProjectDetails(arr);
      }
      set({ projects });
    } catch (err) {
      console.error("Failed to load projects, retrying in 500ms...", err);
      // Retry once after a short delay — handles race where
      // the Tauri backend hasn't finished setup yet.
      await new Promise((r) => setTimeout(r, 500));
      try {
        const raw = await getProjects();
        const projects: ProjectMap = {};
        for (const [id, arr] of Object.entries(raw)) {
          projects[id] = parseProjectDetails(arr);
        }
        set({ projects });
      } catch (retryErr) {
        console.error("Failed to load projects after retry:", retryErr);
      }
    }
  },

  deleteProject: async (projectId: string) => {
    await deleteProjectApi(projectId);
    await get().loadProjects();
    set((s) => {
      s.status[projectId] = PCS.Disconnected;
    });
  },

  saveConnection: async (name: string, details: ProjectDetails) => {
    await insertProject(name, serializeProjectDetails(details));
    await get().loadProjects();
  },

  updateConnection: async (name: string, details: ProjectDetails) => {
    await insertProject(name, serializeProjectDetails(details));
    await get().loadProjects();
  },

  /**
   * The connection name is its primary key, so renaming means moving the row —
   * and everything keyed by it: the live pools, the cached schema tree, the open
   * tabs and the saved queries.
   */
  renameConnection: async (oldName: string, newName: string, details: ProjectDetails) => {
    if (oldName === newName) {
      await get().updateConnection(newName, details);
      return;
    }
    if (get().projects[newName]) {
      toast.error(`A connection named "${newName}" already exists`);
      return;
    }

    const wasConnected = get().status[oldName] === PCS.Connected;
    if (wasConnected || get().status[oldName] === PCS.Connecting) {
      await get().disconnect(oldName);
    }

    await insertProject(newName, serializeProjectDetails(details));
    await deleteProjectApi(oldName);
    await get().loadProjects();

    set((s) => {
      delete s.status[oldName];
      delete s.connectionErrors[oldName];
      clearProjectMetadata(s, oldName);
    });

    useTabStore.getState().remapProjectId(oldName, newName);
    await useQueryStore.getState().remapProject(oldName, newName);

    if (wasConnected) await get().connect(newName);
  },

  addDatabaseToServer: async (sourceProjectId: string, name: string, database: string) => {
    const { projects } = get();
    const source = projects[sourceProjectId];
    if (!source) return;
    const details = { ...source, database };
    await get().saveConnection(name, details);
  },
});
