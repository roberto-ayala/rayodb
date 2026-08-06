const probe: CanvasRenderingContext2D | null =
  typeof document === "undefined"
    ? null
    : document.createElement("canvas").getContext("2d", { willReadFrequently: true });

/**
 * Resolve a theme token to a concrete color. Canvas and editor surfaces cannot
 * read CSS variables, and the tokens are oklch, which their own color handling
 * does not parse — so the value is painted to a pixel and read back.
 */
export function themeColor(name: string, alpha?: number): string {
  if (!probe) return "#000000";
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = raw;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Same value as a hex string, for APIs that reject rgb() — Monaco's themes */
export function themeColorHex(name: string): string {
  const rgb = themeColor(name);
  const parts = rgb.match(/\d+/g);
  if (!parts) return "#000000";
  return `#${parts
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("")}`;
}
