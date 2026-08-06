import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { QueryResult } from "@/types";

interface PinnedResult {
  columns: string[];
  rows: string[][];
  label: string;
}

export type ThemeMode = "auto" | "light" | "dark";

/** Accent presets; only the hue changes, so lightness and chroma stay tuned */
export const ACCENTS: { id: string; label: string; hue: number }[] = [
  { id: "blue", label: "Blue", hue: 265 },
  { id: "violet", label: "Violet", hue: 300 },
  { id: "teal", label: "Teal", hue: 195 },
  { id: "green", label: "Green", hue: 150 },
  { id: "amber", label: "Amber", hue: 75 },
  { id: "rose", label: "Rose", hue: 15 },
];

interface UIState {
  /** What the user picked; "auto" follows the system */
  themeMode: ThemeMode;
  /** What is actually applied right now */
  theme: "light" | "dark";
  accentHue: number;
  sidebarWidth: number;
  editorHeight: number;
  connectionModalOpen: boolean;
  viewMode: "grid" | "record";
  selectedRow: number;
  pinnedResult: PinnedResult | null;

  setThemeMode: (mode: ThemeMode) => void;
  setAccentHue: (hue: number) => void;
  /** Re-resolves "auto" after the system appearance changes */
  syncSystemTheme: () => void;
  setSidebarWidth: (delta: number) => void;
  setEditorHeight: (delta: number) => void;
  setConnectionModalOpen: (open: boolean) => void;
  setViewMode: (mode: "grid" | "record") => void;
  setSelectedRow: (row: number | ((prev: number) => number)) => void;
  pinResult: (result: QueryResult, label: string) => void;
  clearPinnedResult: () => void;
}

export function systemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function applyAccent(hue: number) {
  document.documentElement.style.setProperty("--accent-hue", String(hue));
}

/** Narrowest the connections sidebar may get, in px */
export const SIDEBAR_MIN_WIDTH = 300;

export const useUIStore = create<UIState>()(
  persist(
    immer((set) => ({
      themeMode: "auto",
      theme: systemTheme(),
      accentHue: ACCENTS[0].hue,
      sidebarWidth: SIDEBAR_MIN_WIDTH,
      editorHeight: 50,
      connectionModalOpen: false,
      viewMode: "grid",
      selectedRow: 0,
      pinnedResult: null,

      setThemeMode: (mode) => {
        const theme = mode === "auto" ? systemTheme() : mode;
        applyTheme(theme);
        set({ themeMode: mode, theme });
      },

      setAccentHue: (hue) => {
        applyAccent(hue);
        set({ accentHue: hue });
      },

      syncSystemTheme: () => {
        set((s) => {
          if (s.themeMode !== "auto") return;
          s.theme = systemTheme();
          applyTheme(s.theme);
        });
      },

      setSidebarWidth: (delta) => {
        set((s) => {
          s.sidebarWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(700, s.sidebarWidth + delta));
        });
      },

      setEditorHeight: (delta) => {
        const containerHeight = window.innerHeight - 48 - 24;
        const deltaPercent = (delta / containerHeight) * 100;
        set((s) => {
          s.editorHeight = Math.max(20, Math.min(80, s.editorHeight + deltaPercent));
        });
      },

      setConnectionModalOpen: (open) => set({ connectionModalOpen: open }),

      setViewMode: (mode) => set({ viewMode: mode }),

      setSelectedRow: (row) => {
        set((s) => {
          s.selectedRow = typeof row === "function" ? row(s.selectedRow) : row;
        });
      },

      pinResult: (result, label) => {
        set((s) => {
          s.pinnedResult = { columns: result.columns, rows: result.rows, label };
        });
      },

      clearPinnedResult: () => set({ pinnedResult: null }),
    })),
    {
      name: "rsql-ui",
      // Only the choices worth surviving a restart
      partialize: (s) => ({
        themeMode: s.themeMode,
        accentHue: s.accentHue,
        sidebarWidth: s.sidebarWidth,
        editorHeight: s.editorHeight,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const theme = state.themeMode === "auto" ? systemTheme() : state.themeMode;
        applyTheme(theme);
        applyAccent(state.accentHue);
        useUIStore.setState({ theme });
      },
    },
  ),
);
