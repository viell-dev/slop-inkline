// Where a new symbol's file goes in the vault, and what a name typed for a
// symbol makes of it: the folder made for it, the number or name it takes
// there, and whether another file already has that name. The rules for names
// are in names.ts; this applies them to the vault as it is.

import {
  normalizePath,
  TFile,
  TFolder,
  type App,
  type TAbstractFile,
} from "obsidian";
import { inkExtension } from "../format/ink-file.ts";
import {
  chooseRename,
  linkedNames,
  nextNumberName,
  symbolStem,
  type NameChoice,
} from "./names.ts";
import { namesIn, parentPath } from "./symbol-writes.ts";

/** The path of the file named `name` in `folder`. */
export function pathIn(folder: string, name: string): string {
  return normalizePath(folder === "" ? name : `${folder}/${name}`);
}

/**
 * Whether `folder` already holds something named `name`.ink.png, in any
 * letter case, as Windows and macOS read names, other than `own`.
 */
export function nameTaken(
  app: App,
  folder: string,
  name: string,
  own?: TFile,
): boolean {
  const file = `${name}${inkExtension}`.toLowerCase();
  return namesIn(app.vault, folder).some(
    (other) =>
      other.toLowerCase() === file && pathIn(folder, other) !== own?.path,
  );
}

/** Throws if `folder` already holds a symbol named `name`, as {@link nameTaken}. */
export function claimName(
  app: App,
  folder: string,
  name: string,
  own?: TFile,
): void {
  if (nameTaken(app, folder, name, own)) {
    const where = folder === "" ? "the vault's top folder" : folder;
    throw new Error(`${where} already has a symbol named ${name}`);
  }
}

/**
 * The name `typed` gives a symbol whose file is `file`, if it has one, or
 * throws with the reason it cannot be one. The file's own name, typed
 * again, keeps it.
 */
export function chosen(typed: string, file?: TFile): NameChoice {
  const own = file === undefined ? "" : (symbolStem(file.name) ?? "");
  const choice = chooseRename(typed, own);
  if (choice.kind === "refused") throw new Error(choice.reason);
  return choice;
}

/**
 * Makes `folder` in the vault, with the folders it is in, unless it is there
 * already, and returns its path. A folder there already whose name differs
 * only in letter case stands in for it, as Windows and macOS read names, so
 * that a vault moved between systems keeps one folder. Throws if a file
 * stands where it, or a folder it is in, would be.
 */
export async function makeFolder(app: App, folder: string): Promise<string> {
  let made = "";
  for (const part of folder.split("/")) {
    const path = made === "" ? part : `${made}/${part}`;
    const within =
      made === "" ? app.vault.getRoot() : app.vault.getFolderByPath(made);
    const same = (child: TAbstractFile): boolean =>
      child.name.normalize("NFC").toLowerCase() === part.toLowerCase();
    // A folder before a file, as a case-sensitive system can hold both.
    const found =
      app.vault.getAbstractFileByPath(path) ??
      within?.children.find(
        (child) => child instanceof TFolder && same(child),
      ) ??
      within?.children.find(same) ??
      null;
    if (found instanceof TFile) {
      throw new Error(
        `${found.path} is a file, so the symbol folder cannot be made there`,
      );
    }
    if (found !== null) {
      made = found.path;
      continue;
    }
    try {
      await app.vault.createFolder(path);
    } catch (error) {
      // Another save can have made it meanwhile.
      if (app.vault.getFolderByPath(path) === null) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `the symbol folder ${path} could not be made: ${reason}`,
        );
      }
    }
    made = path;
  }
  return made;
}

/**
 * Where a new symbol for the note at `sourcePath` goes: `symbolFolder`, made if
 * need be, or Obsidian's attachment location for it when that is empty, under
 * the name {@link symbolPathIn} gives it there.
 */
export async function newSymbolPath(
  app: App,
  sourcePath: string,
  name: NameChoice = { kind: "number" },
  symbolFolder = "",
): Promise<string> {
  let folder = symbolFolder;
  if (folder === "") {
    const probe = await app.fileManager.getAvailablePathForAttachment(
      `inkline${inkExtension}`,
      sourcePath,
    );
    folder = parentPath(probe);
  } else {
    folder = await makeFolder(app, folder);
  }
  return symbolPathIn(app, folder, name);
}

/**
 * The path of a new symbol in `folder`, `""` for the vault's top, under the
 * name `name` chose, or else the lowest number name that no file or folder
 * there already has, and that no link Obsidian cannot resolve names there, so
 * that a note still embedding a deleted symbol does not show the new one in its
 * place. Throws if the folder has a symbol of that name already.
 */
export function symbolPathIn(
  app: App,
  folder: string,
  name: NameChoice,
): string {
  if (name.kind === "name") {
    claimName(app, folder, name.name);
    return pathIn(folder, `${name.name}${inkExtension}`);
  }
  const taken = [
    ...namesIn(app.vault, folder)
      .map((child) => symbolStem(child))
      .filter((stem): stem is string => stem !== undefined),
    ...linkedNames(app.metadataCache.unresolvedLinks, folder),
  ];
  for (;;) {
    const stem = nextNumberName(taken);
    const name = `${stem}${inkExtension}`;
    const path = normalizePath(folder === "" ? name : `${folder}/${name}`);
    if (app.vault.getAbstractFileByPath(path) === null) return path;
    taken.push(stem);
  }
}
