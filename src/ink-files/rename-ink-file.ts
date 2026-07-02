import type { App, TFile } from "obsidian";
import { buildInkPath } from "./build-ink-path";
import { previewRenameStem } from "./preview-rename-stem";

/**
 * Rename an ink to the stem `name` slugs to (see previewRenameStem) and
 * return the renamed file. Renaming to the current path is a no-op.
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
