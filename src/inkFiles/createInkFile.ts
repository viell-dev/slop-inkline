import { normalizePath } from "obsidian";
import type { App } from "obsidian";
import { buildInkPath } from "./buildInkPath";
import type { CreatedInkFile } from "./createdInkFile";
import { findAvailableStem } from "./findAvailableStem";
import { getNextAutoName } from "./getNextAutoName";
import { slugifyInkName } from "./slugifyInkName";

export interface NewInkFile {
  name: string;
  sourcePath: string;
  data: ArrayBuffer;
  width: number;
  height: number;
}

/**
 * Create a new `.ink.png` in the attachment folder that `sourcePath` maps
 * to, slugging the display name (auto-numbered when the slug is empty) and
 * suffixing on collision.
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

function dirname(path: string): string {
  const normalizedPath = normalizePath(path);
  const index = normalizedPath.lastIndexOf("/");
  return index === -1 ? "" : normalizedPath.slice(0, index);
}
