import type { App, TFile } from "obsidian";
import { findAvailableStem } from "./findAvailableStem";
import { getInkDisplayName } from "./getInkDisplayName";
import { slugifyInkName } from "./slugifyInkName";

/**
 * The filename stem an existing ink would get if renamed to `name` right
 * now.
 *
 * @remarks
 * Pure lookup, no vault IO. The name is slugified (keeping the current
 * display name when the slug is empty) and given the collision suffix it
 * would receive in its folder; `renameInkFile` resolves its target the
 * same way.
 *
 * @param app - The Obsidian app, used for collision lookups.
 * @param file - The ink file that would be renamed.
 * @param name - The requested display name.
 * @returns The collision-free stem the rename would use.
 */
export function previewRenameStem(
  app: App,
  file: TFile,
  name: string,
): string {
  const folderPath = file.parent?.path ?? "";
  const stem = slugifyInkName(name) || getInkDisplayName(file);
  return findAvailableStem(app, folderPath, stem, file.path);
}
