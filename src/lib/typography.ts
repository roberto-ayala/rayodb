const FALLBACK_CODE_FONT_SIZE = 12;

/**
 * Pixel size of --text-code, for the surfaces that take a number instead of a
 * class: Monaco, xterm and the results grid canvas. Keeps them on the same
 * scale as the rest of the UI, so editor text and toolbar labels match.
 */
export function codeFontSize(): number {
  if (typeof window === "undefined") return FALLBACK_CODE_FONT_SIZE;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--text-code").trim();
  if (!raw) return FALLBACK_CODE_FONT_SIZE;
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return FALLBACK_CODE_FONT_SIZE;
  if (raw.endsWith("rem")) {
    const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Math.round(value * (Number.isNaN(rootSize) ? 16 : rootSize));
  }
  return Math.round(value);
}

export const CODE_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
