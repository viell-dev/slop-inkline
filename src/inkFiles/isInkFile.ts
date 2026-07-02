import type { TFile } from "obsidian";
import { INK_EXTENSION } from "../constants";

export function isInkFile(file: TFile): boolean {
  return file.path.toLowerCase().endsWith(INK_EXTENSION);
}
