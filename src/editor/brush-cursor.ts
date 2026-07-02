import type { InkTool } from "./ink-tool";

/**
 * CSS cursor value showing the brush footprint as an SVG data URI. A white
 * halo under a thin black line keeps the outline readable on any canvas
 * color, since a static cursor image cannot invert the pixels below.
 */
export function brushCursor(diameter: number, tool: InkTool): string {
  const padding = 3;
  const size = Math.ceil(diameter) + padding * 2;
  const center = size / 2;
  const hotspot = Math.round(center);
  const radius = diameter / 2;
  const dash = tool === "eraser" ? ` stroke-dasharray="3 3"` : "";
  const circle = (stroke: string, width: number, extra = ""): string =>
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" ` +
    `stroke="${stroke}" stroke-opacity="0.9" stroke-width="${width}"${extra}/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" ` +
    `height="${size}" viewBox="0 0 ${size} ${size}">` +
    circle("white", 3) +
    circle("black", 1, dash) +
    `</svg>`;

  return (
    `url('data:image/svg+xml,${encodeURIComponent(svg)}') ` +
    `${hotspot} ${hotspot}, crosshair`
  );
}
