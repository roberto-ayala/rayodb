import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export type ExportFormat = "csv" | "json" | "sql" | "markdown" | "xml";

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeSQL(value: string): string {
  if (value === "null" || value === "NULL") return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function escapeXML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toCSV(columns: string[], rows: string[][]): string {
  const header = columns.map(escapeCSV).join(",");
  const body = rows.map((r) => r.map(escapeCSV).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function toJSON(columns: string[], rows: string[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, string> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

export function toSQL(columns: string[], rows: string[][], tableName = "table_name"): string {
  if (rows.length === 0) return `-- No rows to export`;
  const colList = columns.map((c) => `"${c}"`).join(", ");
  return rows
    .map((row) => {
      const vals = row.map(escapeSQL).join(", ");
      return `INSERT INTO "${tableName}" (${colList}) VALUES (${vals});`;
    })
    .join("\n");
}

export function toMarkdown(columns: string[], rows: string[][]): string {
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`)
    .join("\n");
  return `${header}\n${separator}\n${body}`;
}

export function toXML(columns: string[], rows: string[][]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<resultset>"];
  for (const row of rows) {
    lines.push("  <row>");
    columns.forEach((col, i) => {
      lines.push(`    <${col}>${escapeXML(row[i])}</${col}>`);
    });
    lines.push("  </row>");
  }
  lines.push("</resultset>");
  return lines.join("\n");
}

const formatters: Record<
  ExportFormat,
  (cols: string[], rows: string[][], table?: string) => string
> = {
  csv: toCSV,
  json: toJSON,
  sql: toSQL,
  markdown: toMarkdown,
  xml: toXML,
};

const extensions: Record<ExportFormat, string> = {
  csv: "csv",
  json: "json",
  sql: "sql",
  markdown: "md",
  xml: "xml",
};

const filterNames: Record<ExportFormat, string> = {
  csv: "CSV Files",
  json: "JSON Files",
  sql: "SQL Files",
  markdown: "Markdown Files",
  xml: "XML Files",
};

/**
 * Writing through the Tauri dialog rather than an anchor download: the webview
 * fires no download indicator and can drop the click entirely, and this way the
 * user picks the destination and knows it happened.
 */
export async function saveTextFile(
  defaultName: string,
  filterName: string,
  extension: string,
  content: string,
): Promise<string | null> {
  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: filterName, extensions: [extension] }],
  });

  if (!filePath) return null; // user cancelled

  await invoke("save_text_file", { path: filePath, contents: content });
  return filePath;
}

/** Anything a file system would rather not see becomes a dash */
export function slugForFileName(value: string): string {
  return value
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Local time, most significant first, so a folder of exports sorts itself. Down
 * to the second because two exports a minute apart is normal and two in the
 * same second is not.
 */
function timestamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * What the rows are and when they were taken: export.csv said neither, so a
 * folder of them was a pile of files that had to be opened to be told apart.
 */
export function resultsFileName(
  extension: string,
  database?: string,
  source?: string,
  now?: Date,
): string {
  const parts = [database, source ?? "query"].filter(Boolean).map((p) => slugForFileName(p ?? ""));
  return `${[...parts.filter(Boolean), timestamp(now)].join("-")}.${extension}`;
}

export async function exportResults(
  format: ExportFormat,
  columns: string[],
  rows: string[][],
  context?: { database?: string; source?: string },
) {
  const content = formatters[format](columns, rows, context?.source);
  const ext = extensions[format];
  await saveTextFile(
    resultsFileName(ext, context?.database, context?.source),
    filterNames[format],
    ext,
    content,
  );
}

export function copyToClipboard(
  format: ExportFormat,
  columns: string[],
  rows: string[][],
  tableName?: string,
): Promise<void> {
  const content = formatters[format](columns, rows, tableName);
  return navigator.clipboard.writeText(content);
}
