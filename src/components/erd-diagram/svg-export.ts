import { slugForFileName } from "@/lib/export";

/**
 * Turning the on-screen diagram into a file that stands on its own.
 *
 * The two things that made the old export unreadable: an inline <svg> carries
 * no xmlns of its own — the HTML parser supplies it — so serialising it with
 * outerHTML produced markup that no viewer recognised as SVG, and every colour
 * in the diagram is a var(--color-…) that means nothing outside the app's
 * stylesheet.
 */

/** Resolves a CSS colour of any syntax to something every SVG viewer accepts */
function literalColour(value: string, probe: CanvasRenderingContext2D | null): string | null {
  if (!probe) return null;
  const sentinel = "#010203";
  probe.fillStyle = sentinel;
  probe.fillStyle = value;
  // Unparseable values leave fillStyle untouched
  return probe.fillStyle === sentinel && value !== sentinel ? null : String(probe.fillStyle);
}

function inlineCustomProperties(markup: string, scope: Element): string {
  const styles = getComputedStyle(scope);
  const probe = document.createElement("canvas").getContext("2d");

  return markup.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => {
    const raw = styles.getPropertyValue(name).trim();
    if (!raw) return whole;
    return literalColour(raw, probe) ?? raw;
  });
}

/**
 * What the diagram is of, in the order you would say it out loud. Anything a
 * file system would rather not see becomes a dash, since a database or schema
 * may be named with spaces, slashes or quotes.
 */
export function erdFileName(database: string, schema: string): string {
  const parts = [database, schema].map(slugForFileName).filter(Boolean);
  return `${[...parts, "erd"].join("-")}.svg`;
}

export function serialiseERD(svg: SVGSVGElement, width: number, height: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // The pan and zoom belong to the viewport, not to the drawing
  clone.removeAttribute("style");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const markup = inlineCustomProperties(new XMLSerializer().serializeToString(clone), svg);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`;
}
