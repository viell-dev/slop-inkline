import type { App } from "obsidian";
import { buildInkPath } from "./buildInkPath";

/**
 * The first stem in `stem`, `stem-2`, `stem-3`, … whose ink path is free in
 * the folder. `currentPath` exempts the file being renamed so renaming to its
 * own name is a no-op instead of a collision.
 */
export function findAvailableStem(
  app: App,
  folderPath: string,
  stem: string,
  currentPath?: string,
): string {
  const pathExists = (path: string): boolean =>
    path !== currentPath && app.vault.getAbstractFileByPath(path) !== null;

  let suffix = 1;
  let candidate = stem;

  while (pathExists(buildInkPath(folderPath, candidate))) {
    suffix += 1;
    candidate = `${stem}-${suffix}`;
  }

  return candidate;
}
