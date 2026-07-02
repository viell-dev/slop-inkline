import { SURFACE_SIZE } from "../constants";

/**
 * Size the canvas to the fixed drawing surface and fill it white.
 *
 * @param canvasEl - The canvas element to initialize.
 * @returns The 2D context every other editor piece draws through; throws
 *   when the browser cannot create one.
 */
export function initializeInkSurface(
  canvasEl: HTMLCanvasElement,
): CanvasRenderingContext2D {
  canvasEl.width = SURFACE_SIZE;
  canvasEl.height = SURFACE_SIZE;

  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Could not create a canvas rendering context.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SURFACE_SIZE, SURFACE_SIZE);
  return ctx;
}
