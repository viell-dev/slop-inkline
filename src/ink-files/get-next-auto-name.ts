import { normalizePath } from "obsidian";
import type { App, TFile } from "obsidian";
import { AUTO_NAME_PAD_WIDTH } from "../constants";
import { getInkDisplayName } from "./get-ink-display-name";
import { isInkFile } from "./is-ink-file";

/**
 * The next free zero-padded auto name ("001", "002", …) among the ink files
 * in the attachment folder that `sourcePath` maps to.
 */
export async function getNextAutoName(
  app: App,
  sourcePath: string,
): Promise<string> {
  const folderPath = getInkFolderPath(app, sourcePath);
  const usedNumbers = new Set(
    app.vault
      .getFiles()
      .filter((file) => isInkInFolder(file, folderPath))
      .map((file) => getInkDisplayName(file))
      .filter((basename) => /^\d+$/.test(basename)),
  );

  let next = 1;
  while (usedNumbers.has(formatAutoName(next))) {
    next += 1;
  }

  return formatAutoName(next);
}

function getInkFolderPath(app: App, sourcePath: string): string {
  const folder = app.fileManager.getNewFileParent(
    sourcePath,
    ".inkline-probe",
  );

  return normalizePath(folder.path);
}

function isInkInFolder(file: TFile, folderPath: string): boolean {
  return isInkFile(file) && file.parent?.path === folderPath;
}

function formatAutoName(value: number): string {
  return value.toString().padStart(AUTO_NAME_PAD_WIDTH, "0");
}
