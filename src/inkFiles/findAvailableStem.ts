import type { App } from "obsidian";
import { buildInkPath } from "./buildInkPath";

/**
 * Find the first collision-free ink filename stem in a folder.
 *
 * @param app - The Obsidian app, used to check for existing files.
 * @param folderPath - The folder the ink path is built in.
 * @param stem - The desired stem.
 * @param currentPath - Optional path to exempt from collision checks, so a
 *   file renamed to its own name is a no-op instead of a collision.
 * @returns The first of `stem`, `stem-2`, `stem-3`, … whose ink path is
 *   free in the folder.
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
