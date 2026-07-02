import type { App, TFile } from "obsidian";
import { buildInkPath } from "./buildInkPath";
import { previewRenameStem } from "./previewRenameStem";

/**
 * Rename an ink to the stem `name` slugs to (see `previewRenameStem`).
 *
 * @remarks
 * Renaming to the current path is a no-op. The rename goes through
 * Obsidian's file manager, so links to the ink are updated.
 *
 * @param app - The Obsidian app performing the rename.
 * @param file - The ink file to rename.
 * @param name - The requested display name.
 * @returns The renamed file; throws when the renamed file cannot be found
 *   afterwards.
 */
export async function renameInkFile(
  app: App,
  file: TFile,
  name: string,
): Promise<TFile> {
  const folderPath = file.parent?.path ?? "";
  const newPath = buildInkPath(folderPath, previewRenameStem(app, file, name));

  if (newPath === file.path) {
    return file;
  }

  await app.fileManager.renameFile(file, newPath);

  const renamedFile = app.vault.getFileByPath(newPath);
  if (!renamedFile) {
    throw new Error(`Could not find renamed ink file: ${newPath}`);
  }

  return renamedFile;
}
