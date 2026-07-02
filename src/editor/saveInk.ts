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

export interface SaveInkDeps {
  app: App;
  canvasEl: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  nameInputEl: HTMLInputElement;
  /** Present when the editor was opened for a not-yet-created ink. */
  newInk?: NewInkTarget;
  getFile(): TFile | null;
  setFile(file: TFile): void;
  getExportSize(): number;
  /** Width step to export at; called after the surface is flattened. */
  detectStep(): WidthStep;
  /** Lets queued undo/redo restores land before the surface is read. */
  awaitHistory(): Promise<void>;
  /** Called when a rename (part of saving) succeeds. */
  onRename?: (file: TFile) => void;
}

export interface SavedInk {
  file: TFile;
  step: WidthStep;
}

/**
 * Flatten, crop, and write the drawing surface: rename an existing file to
 * the name input first (a failed rename keeps the save going under the old
 * name), then export to the file's own resolution and either overwrite the
 * existing ink or create the new one.
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

async function writeExistingInk(
  deps: SaveInkDeps,
  file: TFile,
  data: ArrayBuffer,
): Promise<TFile> {
  await deps.app.vault.modifyBinary(file, data);
  return file;
}

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
 * centered band of the given width step. The source band uses exact
 * fractional coordinates so it matches where loadInkIntoCanvas re-centers
 * the file. Run after flattenCanvasToGrayscale so the margins are flat
 * white.
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
