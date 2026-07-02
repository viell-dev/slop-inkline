import type { TFile } from "obsidian";
import { slugifyInkName } from "./slugifyInkName";

/**
 * The name shown for an ink file.
 *
 * @param file - The ink file to name.
 * @returns The slugified filename, or the filename stem when slugging
 *   leaves nothing usable.
 */
export function getInkDisplayName(file: TFile): string {
  return slugifyInkName(file.name) || file.basename;
}
