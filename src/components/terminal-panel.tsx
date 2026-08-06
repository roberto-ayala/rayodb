import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import { useUIStore } from "@/stores/ui-store";
import "@xterm/xterm/css/xterm.css";
import { themeColor } from "@/lib/theme-color";
import { CODE_FONT_FAMILY, codeFontSize } from "@/lib/typography";

interface TerminalPanelProps {
  terminalId: string;
}

export function TerminalPanel({ terminalId }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const theme = useUIStore((s) => s.theme);

  const getTermTheme = useCallback(() => {
    if (theme === "dark") {
      return {
        background: themeColor("--editor-bg"),
        foreground: themeColor("--foreground"),
        cursor: themeColor("--primary"),
        cursorAccent: themeColor("--editor-bg"),
        selectionBackground: themeColor("--primary", 0.3),
        black: "#16141f",
        red: "#ef4444",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#818cf8",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e0eb",
        brightBlack: "#6b6880",
        brightRed: "#f87171",
        brightGreen: "#6ee7b7",
        brightYellow: "#fde68a",
        brightBlue: "#a5b4fc",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f5f3ff",
      };
    }
    return {
      background: themeColor("--editor-bg"),
      foreground: themeColor("--foreground"),
      cursor: themeColor("--primary"),
      cursorAccent: themeColor("--editor-bg"),
      selectionBackground: themeColor("--primary", 0.15),
      black: "#1a1830",
      red: "#dc2626",
      green: "#16a34a",
      yellow: "#ca8a04",
      blue: "#4f46e5",
      magenta: "#9333ea",
      cyan: "#0891b2",
      white: "#f5f3ff",
      brightBlack: "#8b85a0",
      brightRed: "#ef4444",
      brightGreen: "#22c55e",
      brightYellow: "#eab308",
      brightBlue: "#6366f1",
      brightMagenta: "#a855f7",
      brightCyan: "#06b6d4",
      brightWhite: "#ffffff",
    };
  }, [theme]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: CODE_FONT_FAMILY,
      fontSize: codeFontSize(),
      lineHeight: 1.3,
      theme: getTermTheme(),
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    // Measure after the browser has laid the container out, or fit() sees zero
    requestAnimationFrame(() => fitAddon.fit());

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    if (!spawnedRef.current) {
      spawnedRef.current = true;
      const cols = term.cols;
      const rows = term.rows;

      invoke("terminal_spawn", { id: terminalId, cols, rows }).catch((err) => {
        term.writeln(`\r\nFailed to spawn terminal: ${err}\r\n`);
      });
    }

    const dataUnlisten = listen<string>(`terminal-data-${terminalId}`, (event) => {
      term.write(event.payload);
    });

    const exitUnlisten = listen(`terminal-exit-${terminalId}`, () => {
      term.writeln("\r\n[Process exited]");
    });

    const dataDisposable = term.onData((data) => {
      invoke("terminal_write", { id: terminalId, data }).catch(() => {});
    });

    const resizeObs = new ResizeObserver(() => {
      fitAddon.fit();
      const cols = term.cols;
      const rows = term.rows;
      invoke("terminal_resize", { id: terminalId, cols, rows }).catch(() => {});
    });
    resizeObs.observe(containerRef.current);

    return () => {
      dataDisposable.dispose();
      resizeObs.disconnect();
      dataUnlisten.then((fn) => fn());
      exitUnlisten.then((fn) => fn());
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, getTermTheme]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getTermTheme();
    }
  }, [getTermTheme]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden px-2 py-1"
      style={{ backgroundColor: "var(--editor-bg)" }}
    />
  );
}
