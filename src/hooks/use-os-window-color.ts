import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

/**
 * Paints --os-window with the colour macOS gives the window chrome, so the top
 * and status bars match the surrounding OS instead of approximating it. Outside
 * Tauri, or on platforms without the notion, the variable keeps its CSS
 * fallback and nothing changes.
 */
export function useOsWindowColor() {
  useEffect(() => {
    let cancelled = false;

    const apply = async () => {
      try {
        const color = await invoke<string | null>("os_window_background");
        if (!cancelled && color) {
          document.documentElement.style.setProperty("--os-window", color);
        }
      } catch {
        // Not running under Tauri — the fallback in index.css stands
      }
    };

    void apply();

    const unlisten = getCurrentWindow()
      .onThemeChanged(() => void apply())
      .catch(() => undefined);

    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn?.());
    };
  }, []);
}
