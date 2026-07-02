import { normalizePath } from "obsidian";
import { INK_EXTENSION } from "../constants";

/**
 * Build the normalized vault path of an ink file from its folder and stem.
 *
 * @param folderPath - The folder the ink lives in; "" for the vault root.
 * @param stem - The filename stem, without the `.ink.png` extension.
 * @returns The normalized `folder/stem.ink.png` path.
 */
export function buildInkPath(folderPath: string, stem: string): string {
  return normalizePath(
    folderPath
      ? `${folderPath}/${stem}${INK_EXTENSION}`
      : `${stem}${INK_EXTENSION}`,
  );
}
