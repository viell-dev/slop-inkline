import { TFile } from "obsidian";
import type { App } from "obsidian";
import { AUTO_NAME_PAD_WIDTH } from "../constants";
import { getInkDisplayName } from "./getInkDisplayName";
import { isInkFile } from "./isInkFile";

/**
 * Find the next free zero-padded auto name ("001", "002", …) among the ink
 * files in the attachment folder that `sourcePath` maps to.
 *
 * @param app - The Obsidian app, used to resolve the attachment folder.
 * @param sourcePath - The path of the note the ink is inserted into.
 * @returns The lowest unused auto name in that folder.
 */
export async function getNextAutoName(
  app: App,
  sourcePath: string,
): Promise<string> {
  const folder = app.fileManager.getNewFileParent(
    sourcePath,
    ".inkline-probe",
  );
  const usedNumbers = new Set(
    folder.children
      .filter((child): child is TFile => child instanceof TFile)
      .filter((file) => isInkFile(file))
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
 * Format a number as a zero-padded auto name.
 *
 * @param value - The auto-name number, starting at 1.
 * @returns The number padded to {@link AUTO_NAME_PAD_WIDTH} digits.
 */
function formatAutoName(value: number): string {
  return value.toString().padStart(AUTO_NAME_PAD_WIDTH, "0");
}
