import { App, normalizePath, TFile } from "obsidian";

const INK_EXTENSION = ".ink.png";

// Exported/stored resolution of an ink. The whole square maps to the inline
// display height, so this is the source the browser downsamples to glyph size;
// it is kept small on purpose because detail finer than the inline size is
// invisible anyway. The editor draws on a larger surface and downsamples to
// this on save (see SURFACE_SIZE in ink-editor-modal.ts).
export const IMAGE_SIZE = 192;
// The stored resolution is configurable (an advanced setting). Clamp to a sane
// range: too small loses all detail, and the upper bound must not exceed the
// editor's SURFACE_SIZE (ink-editor-modal.ts) so exporting is always a
// downsample, never an upscale.
export const MIN_IMAGE_SIZE = 96;
export const MAX_IMAGE_SIZE = 576;

export function clampImageSize(value: number): number {
  if (!Number.isFinite(value)) {
    return IMAGE_SIZE;
  }

  return Math.min(Math.max(Math.round(value), MIN_IMAGE_SIZE), MAX_IMAGE_SIZE);
}

// Width steps a drawing can export at, as fractions of the square. A drawing
// is cropped to the centered band of the smallest step that contains all of
// its ink; the last step is the full square. The editor derives the crop
// guides, ink-extent detection, and per-file export width from this table.
// Width is recovered purely from the PNG aspect ratio (no metadata), so the
// steps must stay distinguishable after export rounding — see
// snapAspectToWidthStep and WIDTH_STEP_EPSILON_RATIO.
export const WIDTH_STEPS = [0.4, 0.6, 0.8, 1] as const;
export type WidthStep = (typeof WIDTH_STEPS)[number];
export const FULL_WIDTH_STEP: WidthStep = WIDTH_STEPS[WIDTH_STEPS.length - 1];

// Containment tolerance for snapping ink to a width step, as a fraction of the
// square. It absorbs the geometry noise of a save/reload cycle so a drawing
// saved at step w always re-detects as step w:
// - detection scans whole pixel columns, so a band edge at a fractional
//   x-position can mark the partially covered boundary column as ink
//   (up to 1 px per side);
// - resampling on export/reload can bleed antialiased ink about 1 px past the
//   original extent (never past the drawn band).
// That totals about 2 px per side on the drawing surface; 0.008 of the 576 px
// surface is ~4.6 px, leaving headroom without visibly clipping ink that gets
// snapped inward.
export const WIDTH_STEP_EPSILON_RATIO = 0.008;

/**
 * Snap outward to the smallest width step whose centered band contains all
 * ink, given the maximum horizontal distance of any ink from the vertical
 * center line as a fraction of the square's width.
 */
export function snapWidthStep(inkHalfWidthFraction: number): WidthStep {
  for (const step of WIDTH_STEPS) {
    if (inkHalfWidthFraction <= step / 2 + WIDTH_STEP_EPSILON_RATIO) {
      return step;
    }
  }

  return FULL_WIDTH_STEP;
}

/**
 * The width step a stored PNG was exported at, recovered from its aspect
 * ratio. Export widths round to whole pixels, so the ratio deviates from the
 * step by at most half a pixel of the stored height; snapping to the nearest
 * step removes that error before the image is re-centered onto the square.
 */
export function snapAspectToWidthStep(aspectRatio: number): WidthStep {
  let best = FULL_WIDTH_STEP;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const step of WIDTH_STEPS) {
    const distance = Math.abs(aspectRatio - step);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }

  return best;
}

export interface CreatedInkFile {
  file: TFile;
  name: string;
  path: string;
  width: number;
  height: number;
}

export class InkFileService {
  constructor(private readonly app: App) {}

  async getNextAutoName(sourcePath: string): Promise<string> {
    const folderPath = await this.getInkFolderPath(sourcePath);
    const usedNumbers = new Set(
      this.app.vault
        .getFiles()
        .filter((file) => this.isPngInFolder(file, folderPath))
        .map((file) => this.getDisplayName(file))
        .filter((basename) => /^\d+$/.test(basename)),
    );

    let next = 1;
    while (usedNumbers.has(this.formatAutoName(next))) {
      next += 1;
    }

    return this.formatAutoName(next);
  }

  async createInkFile(
    name: string,
    sourcePath: string,
    data: ArrayBuffer,
    width: number,
    height: number,
  ): Promise<CreatedInkFile> {
    const folderPath = await this.getInkFolderPathForSave(sourcePath);

    const displayName = name.trim();
    const stem = this.slugify(displayName) || await this.getNextAutoName(sourcePath);
    const finalStem = this.findAvailableStem(folderPath, stem);
    const path = this.buildInkPath(folderPath, finalStem);
    const file = await this.app.vault.createBinary(path, data);

    return {
      file,
      name: finalStem === stem ? displayName || finalStem : finalStem,
      path,
      width,
      height,
    };
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    return this.app.vault.readBinary(file);
  }

  async writeBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    await this.app.vault.modifyBinary(file, data);
  }

  async deleteInkFile(file: TFile): Promise<void> {
    await this.app.vault.delete(file);
  }

  async renameInkFile(file: TFile, name: string): Promise<TFile> {
    const newPath = this.renameTargetPath(file, name);

    if (newPath === file.path) {
      return file;
    }

    await this.app.fileManager.renameFile(file, newPath);

    const renamedFile = this.app.vault.getFileByPath(newPath);
    if (!renamedFile) {
      throw new Error(`Could not find renamed ink file: ${newPath}`);
    }

    return renamedFile;
  }

  /**
   * The filename stem an existing ink would get if renamed to `name` right
   * now: slugified, keeping the current display name when the slug is empty,
   * with the collision suffix it would receive in its folder. Pure lookup,
   * no vault IO; renameInkFile resolves its target the same way.
   */
  previewRenameStem(file: TFile, name: string): string {
    const folderPath = file.parent?.path ?? "";
    const stem = this.slugify(name) || this.getDisplayName(file);
    return this.findAvailableStem(folderPath, stem, file.path);
  }

  isInkFile(file: TFile): boolean {
    return file.path.toLowerCase().endsWith(INK_EXTENSION);
  }

  slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\.ink\.png$/i, "")
      .replace(/\.png$/i, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  getDisplayName(file: TFile): string {
    return this.slugify(file.name) || file.basename;
  }

  private renameTargetPath(file: TFile, name: string): string {
    const folderPath = file.parent?.path ?? "";
    return this.buildInkPath(folderPath, this.previewRenameStem(file, name));
  }

  private getInkFolderPath(sourcePath: string): string {
    const folder = this.app.fileManager.getNewFileParent(
      sourcePath,
      ".inkline-probe",
    );

    return normalizePath(folder.path);
  }

  private async getInkFolderPathForSave(sourcePath: string): Promise<string> {
    const probePath = await this.app.fileManager.getAvailablePathForAttachment(
      ".inkline-probe",
      sourcePath,
    );
    const attachmentFolderPath = dirname(probePath);

    return normalizePath(attachmentFolderPath);
  }

  private findAvailableStem(folderPath: string, stem: string, currentPath?: string): string {
    let suffix = 1;
    let candidate = stem;

    while (
      this.pathExists(
        this.buildInkPath(folderPath, candidate),
        currentPath,
      )
    ) {
      suffix += 1;
      candidate = `${stem}-${suffix}`;
    }

    return candidate;
  }

  private pathExists(path: string, exceptPath?: string): boolean {
    return path !== exceptPath && this.app.vault.getAbstractFileByPath(path) !== null;
  }

  private isPngInFolder(file: TFile, folderPath: string): boolean {
    return this.isInkFile(file) && file.parent?.path === folderPath;
  }

  private formatAutoName(value: number): string {
    return value.toString().padStart(3, "0");
  }

  private buildInkPath(folderPath: string, stem: string): string {
    return normalizePath(folderPath ? `${folderPath}/${stem}${INK_EXTENSION}` : `${stem}${INK_EXTENSION}`);
  }

}

function dirname(path: string): string {
  const normalizedPath = normalizePath(path);
  const index = normalizedPath.lastIndexOf("/");
  return index === -1 ? "" : normalizedPath.slice(0, index);
}
