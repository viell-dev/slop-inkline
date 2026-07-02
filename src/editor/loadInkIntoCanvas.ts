import type { App, TFile } from "obsidian";
import { IMAGE_SIZE, SURFACE_SIZE } from "../constants";
import { loadImage } from "../canvas/loadImage";
import { clampImageSize } from "../ink/clampImageSize";
import { snapAspectToWidthStep } from "../ink/snapAspectToWidthStep";
import type { WidthStep } from "../ink/widthStep";

export interface LoadInkDeps {
  app: App;
  ctx: CanvasRenderingContext2D;
  /** The file's own export resolution, once known. */
  onExportSize(size: number): void;
  /** The width step recovered from the file's aspect ratio. */
  onLoadedStep(step: WidthStep): void;
}

/**
 * Draw an existing ink file onto the (already white) drawing surface.
 * Always edit on the square: a previously cropped file is scaled to the
 * surface height and re-centered into its width-step band so editing
 * continues. The aspect ratio snaps to the exact step so the band lands on
 * the same (fractional) surface coordinates the export cropped from, making
 * save/reload cycles geometrically drift-free.
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

// The export resolution for a loaded ink: keep the file's own size (so inks
// are never shrunk or grown on save), clamped to the shared valid range. The
// configured image size only applies to newly created inks, which start from
// a blank in-memory canvas at that size.
function resolveExportSize(loadedHeight: number): number {
  if (!Number.isFinite(loadedHeight) || loadedHeight <= 0) {
    return IMAGE_SIZE;
  }

  return clampImageSize(loadedHeight);
}
