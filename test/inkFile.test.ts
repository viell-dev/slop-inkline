import { describe, expect, it } from "vitest";
import { TFile, TFolder } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import { IMAGE_SIZE } from "../src/constants";
import { clampImageSize } from "../src/ink/clampImageSize";
import { getInkDisplayName } from "../src/inkFiles/getInkDisplayName";
import { getNextAutoName } from "../src/inkFiles/getNextAutoName";
import { previewRenameStem } from "../src/inkFiles/previewRenameStem";
import { slugifyInkName } from "../src/inkFiles/slugifyInkName";

interface MockAppOptions {
  attachmentFolder: string;
  files: TFile[];
  folders?: TFolder[];
}

function createMockApp(options: MockAppOptions): App {
  const abstractFiles = new Map<string, TAbstractFile>();
  for (const folder of options.folders ?? []) {
    abstractFiles.set(folder.path, folder);
  }
  for (const file of options.files) {
    abstractFiles.set(file.path, file);
    if (file.parent) {
      abstractFiles.set(file.parent.path, file.parent);
    }
  }

  return {
    vault: {
      getFiles: () => options.files,
      getAbstractFileByPath: (path) => abstractFiles.get(path) ?? null,
      getFolderByPath: (path) => {
        const file = abstractFiles.get(path);
        return file instanceof TFolder ? file : null;
      },
      getFileByPath: (path) => {
        const file = abstractFiles.get(path);
        return file instanceof TFile ? file : null;
      },
      createBinary: async (path) => {
        const name = path.split("/").pop() ?? path;
        const file = new TFile(path, name, null);
        options.files.push(file);
        abstractFiles.set(path, file);
        return file;
      },
      readBinary: async () => new ArrayBuffer(0),
      modifyBinary: async () => undefined,
      delete: async (file) => {
        abstractFiles.delete(file.path);
      },
      createFolder: async (path) => {
        const folder = new TFolder(path, path.split("/").pop() ?? path);
        abstractFiles.set(path, folder);
        return folder;
      },
    },
    fileManager: {
      getNewFileParent: () => {
        const existing = abstractFiles.get(options.attachmentFolder);
        return existing instanceof TFolder
          ? existing
          : new TFolder(options.attachmentFolder, options.attachmentFolder);
      },
      getAvailablePathForAttachment: async (filename) => (
        options.attachmentFolder
          ? `${options.attachmentFolder}/${filename}`
          : filename
      ),
      renameFile: async (file, newPath) => {
        abstractFiles.delete(file.path);
        file.path = newPath;
        file.name = newPath.split("/").pop() ?? newPath;
        abstractFiles.set(newPath, file);
      },
    },
  };
}

function inkFile(folder: TFolder, name: string): TFile {
  return new TFile(`${folder.path}/${name}`, name, folder);
}

describe("clampImageSize", () => {
  it("rounds finite values and clamps to the supported range", () => {
    expect(clampImageSize(128.6)).toBe(129);
    expect(clampImageSize(12)).toBe(96);
    expect(clampImageSize(1000)).toBe(576);
    expect(clampImageSize(Number.NaN)).toBe(IMAGE_SIZE);
  });
});

describe("slugifyInkName", () => {
  it("normalizes display names into ink filename stems", () => {
    expect(slugifyInkName("  Café sketch.ink.png  ")).toBe("cafe-sketch");
    expect(slugifyInkName("Symbols & arrows.png")).toBe("symbols-arrows");
    expect(slugifyInkName("!!!")).toBe("");
  });

  it("uses the slugified filename as the display name fallback", () => {
    const folder = new TFolder("ink", "ink");

    expect(getInkDisplayName(inkFile(folder, "Café Symbol.ink.png"))).toBe(
      "cafe-symbol",
    );
  });
});

describe("previewRenameStem", () => {
  it("previews rename stems with collision suffixes, excluding the file itself", () => {
    const folder = new TFolder("ink", "ink");
    const files = [
      inkFile(folder, "cafe.ink.png"),
      inkFile(folder, "taken.ink.png"),
    ];
    const app = createMockApp({ attachmentFolder: "ink", files });

    expect(previewRenameStem(app, files[0], "Café")).toBe("cafe");
    expect(previewRenameStem(app, files[0], "Taken")).toBe("taken-2");
    expect(previewRenameStem(app, files[0], "!!!")).toBe("cafe");
  });
});

describe("getNextAutoName", () => {
  it("returns the first zero-padded number when no ink files exist", async () => {
    const app = createMockApp({ attachmentFolder: "attachments", files: [] });

    await expect(getNextAutoName(app, "note.md")).resolves.toBe("001");
  });

  it("skips used numeric stems in the attachment folder only", async () => {
    const folder = new TFolder("attachments", "attachments");
    const otherFolder = new TFolder("other", "other");
    const app = createMockApp({
      attachmentFolder: "attachments",
      files: [
        inkFile(folder, "001.ink.png"),
        inkFile(folder, "002.ink.png"),
        inkFile(folder, "not-number.ink.png"),
        inkFile(folder, "004.png"),
        inkFile(otherFolder, "003.ink.png"),
      ],
    });

    await expect(getNextAutoName(app, "note.md")).resolves.toBe("003");
  });
});
