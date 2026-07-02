import { brushCursor } from "./brushCursor";
import type { InkTool } from "./inkTool";
import { surfaceLineWidth } from "./surfaceLineWidth";

/**
 * Render the brush footprint as the real canvas cursor, scaled to the
 * on-screen canvas size. Using the native cursor avoids the jitter of a DOM
 * element chasing pointer events.
 */
export function applyBrushCursor(
  canvasEl: HTMLCanvasElement,
  tool: InkTool,
  brushInlinePx: number,
): void {
  const rect = canvasEl.getBoundingClientRect();
  const scale =
    canvasEl.width && rect.width ? rect.width / canvasEl.width : 1;
  const diameter = Math.max(surfaceLineWidth(brushInlinePx) * scale, 1);
  canvasEl.style.cursor = brushCursor(diameter, tool);
}
