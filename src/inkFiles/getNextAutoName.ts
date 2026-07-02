import { normalizePath } from "obsidian";
import type { App, TFile } from "obsidian";
import { AUTO_NAME_PAD_WIDTH } from "../constants";
import { getInkDisplayName } from "./getInkDisplayName";
import { isInkFile } from "./isInkFile";

/**
 * Find the next free zero-padded auto name ("001", "002", …) among the ink
 * files in the attachment folder that `sourcePath` maps to.
 *
 * @param app - The Obsidian app, used to resolve the attachment folder and
 *   scan the vault.
 * @param sourcePath - The path of the note the ink is inserted into.
 * @returns The lowest unused auto name in that folder.
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

/**
 * The attachment folder new inks for a note land in.
 *
 * @param app - The Obsidian app, used to resolve the attachment setting.
 * @param sourcePath - The path of the note the ink is inserted into.
 * @returns The normalized folder path.
 */
function getInkFolderPath(app: App, sourcePath: string): string {
  const folder = app.fileManager.getNewFileParent(
    sourcePath,
    ".inkline-probe",
  );

  return normalizePath(folder.path);
}

/**
 * Check whether a file is an ink directly inside a folder.
 *
 * @param file - The vault file to test.
 * @param folderPath - The normalized folder path to match.
 * @returns Whether the file is an ink whose parent is exactly that folder.
 */
function isInkInFolder(file: TFile, folderPath: string): boolean {
  return isInkFile(file) && file.parent?.path === folderPath;
}

/**
 * Format a number as a zero-padded auto name.
 *
 * @param value - The auto-name number, starting at 1.
 * @returns The number padded to {@link AUTO_NAME_PAD_WIDTH} digits.
 */
function formatAutoName(value: number): string {
  return value.toString().padStart(AUTO_NAME_PAD_WIDTH, "0");
}
