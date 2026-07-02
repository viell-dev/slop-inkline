import type { App, TFile } from "obsidian";
import { findAvailableStem } from "./find-available-stem";
import { getInkDisplayName } from "./get-ink-display-name";
import { slugifyInkName } from "./slugify-ink-name";

/**
 * The filename stem an existing ink would get if renamed to `name` right
 * now: slugified, keeping the current display name when the slug is empty,
 * with the collision suffix it would receive in its folder. Pure lookup,
 * no vault IO; renameInkFile resolves its target the same way.
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
