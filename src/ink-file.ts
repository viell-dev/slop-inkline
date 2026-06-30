import { App, normalizePath, TFile, TFolder } from "obsidian";
import { canvasToPngArrayBuffer } from "./canvas";
import { InklineSettings } from "./settings";

const INK_EXTENSION = ".ink.png";

// The editor always works on a square canvas. A drawing that stays within the
// centered narrow band is exported at NARROW_WIDTH; anything wider is exported
// as the full square. See ink-editor-modal.ts for the crop guides and detection.
export const CANVAS_SIZE = 300;
export const NARROW_WIDTH = 180;

export interface CreatedInkFile {
  file: TFile;
  name: string;
  path: string;
  width: number;
  height: number;
}

export class InkFileService {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => InklineSettings,
  ) {}

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

  async createBlankInkFile(
    name: string,
    sourcePath: string,
  ): Promise<CreatedInkFile> {
    const folderPath = await this.getInkFolderPath(sourcePath);
    await this.ensureFolder(folderPath);

    const displayName = name.trim();
    const stem = this.slugify(displayName) || await this.getNextAutoName(sourcePath);
    const finalStem = this.findAvailableStem(folderPath, stem);
    const path = this.buildInkPath(folderPath, finalStem);
    const data = await this.createBlankPng(CANVAS_SIZE, CANVAS_SIZE);
    const file = await this.app.vault.createBinary(path, data);

    return {
      file,
      name: finalStem === stem ? displayName || finalStem : finalStem,
      path,
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
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
    const folderPath = file.parent?.path ?? "";
    const stem = this.slugify(name) || file.basename;
    const finalStem = this.findAvailableStem(folderPath, stem, file.path);
    const newPath = this.buildInkPath(folderPath, finalStem);

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

  private async getInkFolderPath(sourcePath: string): Promise<string> {
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

  private async ensureFolder(folderPath: string): Promise<void> {
    const normalizedPath = normalizePath(folderPath);
    if (!normalizedPath || this.app.vault.getFolderByPath(normalizedPath)) {
      return;
    }

    const segments = normalizedPath.split("/");
    let current = "";

    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);

      if (existing instanceof TFolder) {
        continue;
      }

      await this.app.vault.createFolder(current);
    }
  }

  private async createBlankPng(width: number, height: number): Promise<ArrayBuffer> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not create a canvas rendering context.");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    return canvasToPngArrayBuffer(canvas);
  }
}

function dirname(path: string): string {
  const normalizedPath = normalizePath(path);
  const index = normalizedPath.lastIndexOf("/");
  return index === -1 ? "" : normalizedPath.slice(0, index);
}
