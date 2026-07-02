import { Notice } from "obsidian";
import type { App, TFile } from "obsidian";
import { SURFACE_SIZE } from "../constants";
import { canvasToPngArrayBuffer } from "../canvas/canvasToPngArrayBuffer";
import { flattenCanvasToGrayscale } from "../canvas/flattenCanvasToGrayscale";
import { createInkFile } from "../inkFiles/createInkFile";
import { getInkDisplayName } from "../inkFiles/getInkDisplayName";
import { renameInkFile } from "../inkFiles/renameInkFile";
import type { WidthStep } from "../ink/widthStep";
import type { NewInkTarget } from "./newInkTarget";

/** Dependencies of {@link saveInk}. */
export interface SaveInkDeps {
  /** The Obsidian app performing the vault IO. */
  app: App;
  /** The drawing canvas the export reads from. */
  canvasEl: HTMLCanvasElement;
  /** The 2D context of that canvas, used for flattening. */
  ctx: CanvasRenderingContext2D;
  /** The name input; its value drives renames and new-file naming. */
  nameInputEl: HTMLInputElement;
  /** Present when the editor was opened for a not-yet-created ink. */
  newInk?: NewInkTarget;
  /**
   * Read the file being edited; `null` before the first save of a new
   * ink.
   */
  getFile(): TFile | null;
  /**
   * Record the file the editor now edits (after a rename or creation).
   *
   * @param file - The current vault file.
   */
  setFile(file: TFile): void;
  /** Read the resolution to export at, in pixels per side. */
  getExportSize(): number;
  /**
   * Detect the width step to export at; called after the surface is
   * flattened.
   *
   * @returns The step the export crops to.
   */
  detectStep(): WidthStep;
  /**
   * Wait for queued undo/redo restores to land before the surface is
   * read.
   *
   * @returns A promise that resolves once the history queue is drained.
   */
  awaitHistory(): Promise<void>;
  /**
   * Called when a rename (part of saving) succeeds.
   *
   * @param file - The renamed vault file.
   */
  onRename?: (file: TFile) => void;
}

/** The result of a successful save. */
export interface SavedInk {
  /** The vault file the drawing was written to. */
  file: TFile;
  /** The width step the export was cropped to. */
  step: WidthStep;
}

/**
 * Flatten, crop, and write the drawing surface.
 *
 * @remarks
 * An existing file is first renamed to the name input's value (a failed
 * rename shows a notice and keeps the save going under the old name),
 * then the surface is exported at the file's own resolution and either
 * overwrites the existing ink or creates the new one.
 *
 * @param deps - The save's dependencies and callbacks.
 * @returns The saved file and the width step it was exported at.
 */
export async function saveInk(deps: SaveInkDeps): Promise<SavedInk> {
  // Let any queued undo/redo restore finish so the flatten and export below
  // read the surface the user actually sees.
  await deps.awaitHistory();

  const file = await renameFromInput(deps);
  flattenCanvasToGrayscale(deps.ctx);

  const step = deps.detectStep();
  const exportedCanvas = exportCanvas(deps, step);
  const data = await canvasToPngArrayBuffer(exportedCanvas);
  const savedFile = file
    ? await writeExistingInk(deps, file, data)
    : await createNewInk(deps, data, exportedCanvas.width, exportedCanvas.height);

  return { file: savedFile, step };
}

/**
 * Rename the edited file to the name input's value, when both exist and
 * differ.
 *
 * @remarks
 * An empty or unchanged input resets itself to the current display name.
 * A failed rename shows a notice, resets the input, and returns the
 * original file so the save continues under the old name.
 *
 * @param deps - The save's dependencies.
 * @returns The (possibly renamed) file, or `null` for a not-yet-created
 *   ink.
 */
async function renameFromInput(deps: SaveInkDeps): Promise<TFile | null> {
  const file = deps.getFile();
  if (!file) {
    return null;
  }

  const nextName = deps.nameInputEl.value.trim();
  if (!nextName || nextName === getInkDisplayName(file)) {
    deps.nameInputEl.value = getInkDisplayName(file);
    return file;
  }

  try {
    const renamedFile = await renameInkFile(deps.app, file, nextName);
    deps.setFile(renamedFile);
    deps.nameInputEl.value = getInkDisplayName(renamedFile);
    deps.onRename?.(renamedFile);
    return renamedFile;
  } catch (error) {
    // Keep the drawing save going under the old name, but make the failed
    // rename visible instead of silently aborting the whole save.
    new Notice(`Could not rename ink: ${errorMessage(error)}`);
    deps.nameInputEl.value = getInkDisplayName(file);
    return file;
  }
}

/**
 * Overwrite an existing ink file with the exported PNG bytes.
 *
 * @param deps - The save's dependencies.
 * @param file - The vault file to overwrite.
 * @param data - The encoded PNG bytes.
 * @returns The unchanged file.
 */
async function writeExistingInk(
  deps: SaveInkDeps,
  file: TFile,
  data: ArrayBuffer,
): Promise<TFile> {
  await deps.app.vault.modifyBinary(file, data);
  return file;
}

/**
 * Create the new ink file described by the editor's new-ink target.
 *
 * @param deps - The save's dependencies; `deps.newInk` must be present.
 * @param data - The encoded PNG bytes.
 * @param width - The exported image width, in pixels.
 * @param height - The exported image height, in pixels.
 * @returns The created file; the editor is switched to it and the target's
 *   `onCreate` callback is invoked.
 */
async function createNewInk(
  deps: SaveInkDeps,
  data: ArrayBuffer,
  width: number,
  height: number,
): Promise<TFile> {
  const newInk = deps.newInk;
  if (!newInk) {
    throw new Error("Missing new ink target.");
  }

  const created = await createInkFile(deps.app, {
    name: deps.nameInputEl.value,
    sourcePath: newInk.sourcePath,
    data,
    width,
    height,
  });

  deps.setFile(created.file);
  deps.nameInputEl.value = getInkDisplayName(created.file);
  newInk.onCreate?.(created);

  return created.file;
}

/**
 * Downsample the drawing surface to the file's export size, cropped to the
 * centered band of the given width step.
 *
 * @remarks
 * The source band uses exact fractional coordinates so it matches where
 * `loadInkIntoCanvas` re-centers the file. Run after
 * `flattenCanvasToGrayscale` so the margins are flat white. Falls back to
 * the uncropped surface canvas when a 2D context cannot be created.
 *
 * @param deps - The save's dependencies.
 * @param step - The width step to crop to.
 * @returns The canvas holding the export-sized image.
 */
function exportCanvas(deps: SaveInkDeps, step: WidthStep): HTMLCanvasElement {
  const out = document.createElement("canvas");
  const ctx = out.getContext("2d");
  if (!ctx) {
    return deps.canvasEl;
  }

  const size = deps.getExportSize();
  const sourceWidth = SURFACE_SIZE * step;
  const sourceX = (SURFACE_SIZE - sourceWidth) / 2;
  out.width = Math.round(size * step);
  out.height = size;
  ctx.drawImage(
    deps.canvasEl,
    sourceX,
    0,
    sourceWidth,
    SURFACE_SIZE,
    0,
    0,
    out.width,
    size,
  );

  return out;
}

/**
 * Extract a human-readable message from a thrown value.
 *
 * @param error - The thrown value.
 * @returns The error's message, or its string form for non-Error values.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
