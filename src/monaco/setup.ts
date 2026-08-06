import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import pgWorker from "monaco-sql-languages/esm/languages/pgsql/pgsql.worker?worker";

import "monaco-sql-languages/esm/languages/pgsql/pgsql.contribution";
import { LanguageIdEnum } from "monaco-sql-languages/esm/common/constants";
import { setupLanguageFeatures } from "monaco-sql-languages/esm/setupLanguageFeatures";
import { themeColorHex } from "@/lib/theme-color";
import { registerContextAwareCompletions } from "./completion-provider";

// @ts-expect-error MonacoEnvironment is attached to global scope at runtime
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "pgsql") {
      return new pgWorker();
    }
    return new editorWorker();
  },
};

loader.config({ monaco });

setupLanguageFeatures(LanguageIdEnum.PG, {
  completionItems: {
    enable: false, // Disabled: our custom provider handles completions
  },
  diagnostics: true,
  definitions: true,
  references: true,
});

registerContextAwareCompletions(monaco);

/**
 * Editor surfaces come from the theme tokens, so the editor sits on the same
 * greys as the panels around it. Syntax colours stay literal: they are their
 * own palette, tuned for reading SQL.
 */
export function defineEditorThemes() {
  const surfaces = (dark: boolean) => ({
    "editor.background": themeColorHex("--editor-bg"),
    "editor.foreground": themeColorHex("--foreground"),
    "editor.lineHighlightBackground": themeColorHex("--editor-line"),
    "editor.selectionBackground": `${themeColorHex("--primary")}${dark ? "40" : "30"}`,
    "editor.inactiveSelectionBackground": `${themeColorHex("--primary")}20`,
    "editorCursor.foreground": themeColorHex("--primary"),
    "editorLineNumber.foreground": themeColorHex("--muted-foreground"),
    "editorLineNumber.activeForeground": themeColorHex("--foreground"),
    "editorIndentGuide.background": themeColorHex("--border"),
    "editorIndentGuide.activeBackground": themeColorHex("--muted-foreground"),
    "editorGutter.background": themeColorHex("--editor-bg"),
    "editorWidget.background": themeColorHex("--popover"),
    "editorWidget.border": themeColorHex("--border"),
    "editorSuggestWidget.background": themeColorHex("--popover"),
    "editorSuggestWidget.border": themeColorHex("--border"),
    "editorSuggestWidget.selectedBackground": themeColorHex("--accent"),
    "editorSuggestWidget.highlightForeground": themeColorHex("--primary"),
    "input.background": themeColorHex("--input"),
    "input.border": themeColorHex("--border"),
    "scrollbarSlider.background": `${themeColorHex("--border")}80`,
    "scrollbarSlider.hoverBackground": `${themeColorHex("--muted-foreground")}60`,
    "scrollbarSlider.activeBackground": `${themeColorHex("--muted-foreground")}80`,
  });

  monaco.editor.defineTheme("rsql-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "1a1a2e" },
      { token: "keyword", foreground: "7c3aed", fontStyle: "bold" },
      { token: "keyword.sql", foreground: "7c3aed", fontStyle: "bold" },
      { token: "operator.sql", foreground: "7c3aed" },
      { token: "string", foreground: "059669" },
      { token: "string.sql", foreground: "059669" },
      { token: "number", foreground: "b45309" },
      { token: "number.sql", foreground: "b45309" },
      { token: "comment", foreground: "9999a8", fontStyle: "italic" },
      { token: "comment.sql", foreground: "9999a8", fontStyle: "italic" },
      { token: "identifier", foreground: "1a1a2e" },
      { token: "identifier.sql", foreground: "1a1a2e" },
      { token: "type", foreground: "2563eb" },
      { token: "predefined.sql", foreground: "2563eb" },
      { token: "delimiter", foreground: "666680" },
    ],
    colors: surfaces(false),
  });

  monaco.editor.defineTheme("rsql-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "d4d0e8" },
      { token: "keyword", foreground: "a78bfa", fontStyle: "bold" },
      { token: "keyword.sql", foreground: "a78bfa", fontStyle: "bold" },
      { token: "operator.sql", foreground: "a78bfa" },
      { token: "string", foreground: "34d399" },
      { token: "string.sql", foreground: "34d399" },
      { token: "number", foreground: "fbbf24" },
      { token: "number.sql", foreground: "fbbf24" },
      { token: "comment", foreground: "807c96", fontStyle: "italic" },
      { token: "comment.sql", foreground: "807c96", fontStyle: "italic" },
      { token: "identifier", foreground: "d4d0e8" },
      { token: "identifier.sql", foreground: "d4d0e8" },
      { token: "type", foreground: "60a5fa" },
      { token: "predefined.sql", foreground: "60a5fa" },
      { token: "delimiter", foreground: "8888a0" },
    ],
    colors: surfaces(true),
  });
}

defineEditorThemes();
