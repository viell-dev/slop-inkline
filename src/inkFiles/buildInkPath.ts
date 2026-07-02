import { normalizePath } from "obsidian";
import { INK_EXTENSION } from "../constants";

export function buildInkPath(folderPath: string, stem: string): string {
  return normalizePath(
    folderPath
      ? `${folderPath}/${stem}${INK_EXTENSION}`
      : `${stem}${INK_EXTENSION}`,
  );
}
