import type { TFile } from "obsidian";
import { INK_EXTENSION } from "../constants";

/**
 * Check whether a vault file is an Inkline ink.
 *
 * @param file - The vault file to test.
 * @returns Whether the file's path ends with the `.ink.png` extension
 *   (case-insensitive).
 */
export function isInkFile(file: TFile): boolean {
  return file.path.toLowerCase().endsWith(INK_EXTENSION);
}
