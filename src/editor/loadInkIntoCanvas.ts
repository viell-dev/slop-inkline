import type { App, TFile } from "obsidian";
import { IMAGE_SIZE, SURFACE_SIZE } from "../constants";
import { loadImage } from "../canvas/loadImage";
import { clampImageSize } from "../ink/clampImageSize";
import { snapAspectToWidthStep } from "../ink/snapAspectToWidthStep";
import type { WidthStep } from "../ink/widthStep";

/** Dependencies of {@link loadInkIntoCanvas}. */
export interface LoadInkDeps {
  /** The Obsidian app, used to read the file's bytes. */
  app: App;
  /** The 2D context of the (already white) drawing surface. */
  ctx: CanvasRenderingContext2D;
  /**
   * Receives the file's own export resolution, once known.
   *
   * @param size - The stored height clamped to the valid range, in pixels.
   */
  onExportSize(size: number): void;
  /**
   * Receives the width step recovered from the file's aspect ratio.
   *
   * @param step - The recovered width step.
   */
  onLoadedStep(step: WidthStep): void;
}

/**
 * Draw an existing ink file onto the (already white) drawing surface.
 *
 * @remarks
 * Always edit on the square: a previously cropped file is scaled to the
 * surface height and re-centered into its width-step band so editing
 * continues. The aspect ratio snaps to the exact step so the band lands on
 * the same (fractional) surface coordinates the export cropped from,
 * making save/reload cycles geometrically drift-free. A file with
 * unreadable dimensions leaves the surface blank.
 *
 * @param deps - The load's dependencies and callbacks.
 * @param file - The `.ink.png` vault file to load.
 * @returns A promise that resolves once the image is on the surface.
 */
export async function loadInkIntoCanvas(
  deps: LoadInkDeps,
  file: TFile,
): Promise<void> {
  const data = await deps.app.vault.readBinary(file);
  const blob = new Blob([data], { type: "image/png" });
  const url = URL.createObjectURL(blob);

  try {
    const image = await loadImage(url);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      return;
    }

    deps.onExportSize(resolveExportSize(sourceHeight));
    const step = snapAspectToWidthStep(sourceWidth / sourceHeight);
    deps.onLoadedStep(step);

    const drawWidth = SURFACE_SIZE * step;
    const offsetX = (SURFACE_SIZE - drawWidth) / 2;
    deps.ctx.drawImage(image, offsetX, 0, drawWidth, SURFACE_SIZE);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The export resolution for a loaded ink: the file's own size, clamped to
 * the shared valid range.
 *
 * @remarks
 * Keeping the file's own size means inks are never shrunk or grown on
 * save. The configured image size only applies to newly created inks,
 * which start from a blank in-memory canvas at that size.
 *
 * @param loadedHeight - The loaded image's height, in pixels.
 * @returns The clamped size, or the default {@link IMAGE_SIZE} when the
 *   height is unusable.
 */
function resolveExportSize(loadedHeight: number): number {
  if (!Number.isFinite(loadedHeight) || loadedHeight <= 0) {
    return IMAGE_SIZE;
  }

  return clampImageSize(loadedHeight);
}
