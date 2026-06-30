import { App, normalizePath, TFile, TFolder } from "obsidian";
import { InklineSettings } from "./settings";

export type CanvasPresetId = "symbol" | "wide-symbol" | "short-word";

export interface CanvasPreset {
  id: CanvasPresetId;
  name: string;
  width: number;
  height: number;
}

export interface CreatedInkFile {
  file: TFile;
  name: string;
  path: string;
  width: number;
  height: number;
}

export const CANVAS_PRESETS: Record<CanvasPresetId, CanvasPreset> = {
  symbol: {
    id: "symbol",
    name: "Symbol",
    width: 256,
    height: 256,
  },
  "wide-symbol": {
    id: "wide-symbol",
    name: "Wide symbol",
    width: 512,
    height: 256,
  },
  "short-word": {
    id: "short-word",
    name: "Short word",
    width: 1024,
    height: 256,
  },
};

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
        .map((file) => file.basename)
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
    presetId: CanvasPresetId,
    sourcePath: string,
  ): Promise<CreatedInkFile> {
    const preset = CANVAS_PRESETS[presetId];
    const folderPath = await this.getInkFolderPath(sourcePath);
    await this.ensureFolder(folderPath);

    const displayName = name.trim();
    const stem = this.slugify(displayName) || await this.getNextAutoName(sourcePath);
    const finalStem = this.findAvailableStem(folderPath, stem);
    const path = normalizePath(`${folderPath}/${finalStem}.png`);
    const data = await this.createBlankPng(preset.width, preset.height);
    const file = await this.app.vault.createBinary(path, data);

    return {
      file,
      name: finalStem === stem ? displayName || finalStem : finalStem,
      path,
      width: preset.width,
      height: preset.height,
    };
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    return this.app.vault.readBinary(file);
  }

  async writeBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    await this.app.vault.modifyBinary(file, data);
  }

  async renameInkFile(file: TFile, name: string): Promise<TFile> {
    const folderPath = file.parent?.path ?? "";
    const stem = this.slugify(name) || file.basename;
    const finalStem = this.findAvailableStem(folderPath, stem, file.path);
    const newPath = normalizePath(folderPath ? `${folderPath}/${finalStem}.png` : `${finalStem}.png`);

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
    const subfolder = this.normalizedSubfolder();
    const parentPath = file.parent?.path ?? "";

    return (
      file.extension.toLowerCase() === "png" &&
      (
        parentPath === subfolder ||
        parentPath.endsWith(`/${subfolder}`) ||
        this.isLegacyRootAutoFile(file, parentPath)
      )
    );
  }

  slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\.png$/i, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private async getInkFolderPath(sourcePath: string): Promise<string> {
    const subfolder = this.normalizedSubfolder();
    const probePath = await this.app.fileManager.getAvailablePathForAttachment(
      ".inkline-probe",
      sourcePath,
    );
    const attachmentFolderPath = dirname(probePath);

    return normalizePath(attachmentFolderPath ? `${attachmentFolderPath}/${subfolder}` : subfolder);
  }

  private findAvailableStem(folderPath: string, stem: string, currentPath?: string): string {
    let suffix = 1;
    let candidate = stem;

    while (
      this.pathExists(
        normalizePath(folderPath ? `${folderPath}/${candidate}.png` : `${candidate}.png`),
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
    return file.extension.toLowerCase() === "png" && file.parent?.path === folderPath;
  }

  private isLegacyRootAutoFile(file: TFile, parentPath: string): boolean {
    return parentPath === "" && /^\d+$/.test(file.basename);
  }

  private formatAutoName(value: number): string {
    return value.toString().padStart(3, "0");
  }

  private normalizedSubfolder(): string {
    const subfolder = normalizePath(this.getSettings().attachmentSubfolder.trim());
    return subfolder || "inkline";
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

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("Could not export blank PNG."));
        }
      }, "image/png");
    });

    return blob.arrayBuffer();
  }
}

export function createMarkdownImage(name: string, path: string): string {
  return `![${escapeAltText(name)}](${formatMarkdownDestination(path)})`;
}

function dirname(path: string): string {
  const normalizedPath = normalizePath(path);
  const index = normalizedPath.lastIndexOf("/");
  return index === -1 ? "" : normalizedPath.slice(0, index);
}

function escapeAltText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function formatMarkdownDestination(path: string): string {
  if (!/[\s()<>]/.test(path)) {
    return path;
  }

  return `<${path.replace(/>/g, "%3E")}>`;
}
