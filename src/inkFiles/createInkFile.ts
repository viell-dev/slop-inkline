import { normalizePath } from "obsidian";
import type { App } from "obsidian";
import { buildInkPath } from "./buildInkPath";
import type { CreatedInkFile } from "./createdInkFile";
import { findAvailableStem } from "./findAvailableStem";
import { getNextAutoName } from "./getNextAutoName";
import { slugifyInkName } from "./slugifyInkName";

/** The data needed to create a new ink file in the vault. */
export interface NewInkFile {
  /** The requested display name; slugified into the filename stem. */
  name: string;
  /** The path of the note the ink belongs to; picks the folder. */
  sourcePath: string;
  /** The encoded PNG bytes to write. */
  data: ArrayBuffer;
  /** The stored image width, in pixels. */
  width: number;
  /** The stored image height, in pixels. */
  height: number;
}

/**
 * Create a new `.ink.png` in the attachment folder that `sourcePath` maps
 * to.
 *
 * @remarks
 * The display name is slugified into the stem (auto-numbered when the slug
 * is empty) and suffixed on collision.
 *
 * @param app - The Obsidian app performing the vault IO.
 * @param ink - The new ink's name, context, and image data.
 * @returns The created file with its final name, path, and dimensions.
 */
export async function createInkFile(
  app: App,
  ink: NewInkFile,
): Promise<CreatedInkFile> {
  const folderPath = await getInkFolderPathForSave(app, ink.sourcePath);

  const displayName = ink.name.trim();
  const stem =
    slugifyInkName(displayName) || (await getNextAutoName(app, ink.sourcePath));
  const finalStem = findAvailableStem(app, folderPath, stem);
  const path = buildInkPath(folderPath, finalStem);
  const file = await app.vault.createBinary(path, ink.data);

  return {
    file,
    name: finalStem === stem ? displayName || finalStem : finalStem,
    path,
    width: ink.width,
    height: ink.height,
  };
}

/**
 * Resolve the attachment folder a new ink should be written to, creating
 * it when Obsidian's attachment settings require one that does not exist
 * yet.
 *
 * @param app - The Obsidian app, used to resolve the attachment path.
 * @param sourcePath - The path of the note the ink belongs to.
 * @returns The normalized folder path.
 */
async function getInkFolderPathForSave(
  app: App,
  sourcePath: string,
): Promise<string> {
  const probePath = await app.fileManager.getAvailablePathForAttachment(
    ".inkline-probe",
    sourcePath,
  );

  return normalizePath(dirname(probePath));
}

/**
 * The folder part of a vault path.
 *
 * @param path - The vault path to split.
 * @returns Everything before the last `/`, or "" for a root-level path.
 */
function dirname(path: string): string {
  const normalizedPath = normalizePath(path);
  const index = normalizedPath.lastIndexOf("/");
  return index === -1 ? "" : normalizedPath.slice(0, index);
}
