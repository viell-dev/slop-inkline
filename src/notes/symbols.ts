// Creating, inserting, and editing symbols in the vault: the editor's work
// with files and notes.

import {
  Notice,
  TFile,
  normalizePath,
  type App,
  type Editor,
  type EditorPosition,
} from "obsidian";
import { inkExtension } from "../format/ink-file.ts";
import { openInk } from "../ink/canvas.ts";
import { emptyDocument } from "../ink/document.ts";
import { InkEditorModal } from "../editor/modal.ts";
import { visibleWidth } from "../editor/view.ts";
import { embedFromLink, nextNumberName, symbolStem } from "./names.ts";

/** An `ArrayBuffer` holding exactly these bytes, as the vault takes. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Where a new symbol for the note at `sourcePath` goes: Obsidian's attachment
 * location for it, with the lowest free number name in that folder.
 */
export async function newSymbolPath(
  app: App,
  sourcePath: string,
): Promise<string> {
  const probe = await app.fileManager.getAvailablePathForAttachment(
    `inkline${inkExtension}`,
    sourcePath,
  );
  const folder = parentPath(probe);
  const taken = (
    app.vault.getFolderByPath(folder === "" ? "/" : folder)?.children ?? []
  )
    .filter((child): child is TFile => child instanceof TFile)
    .map((file) => symbolStem(file.name))
    .filter((stem): stem is string => stem !== undefined);
  const name = `${nextNumberName(taken)}${inkExtension}`;
  const path = normalizePath(folder === "" ? name : `${folder}/${name}`);
  return app.vault.getAbstractFileByPath(path) === null
    ? path
    : app.fileManager.getAvailablePathForAttachment(name, sourcePath);
}

/**
 * Opens the editor for a new symbol. Nothing is created until the first
 * save, which creates the file and inserts its embed at `position`; later
 * saves update the file.
 */
export function insertSymbol(
  app: App,
  editor: Editor,
  sourcePath: string,
  position: EditorPosition = editor.getCursor(),
): void {
  let file: TFile | undefined;
  new InkEditorModal(app, {
    title: "New symbol",
    document: emptyDocument,
    center: visibleWidth / 2,
    write: async (bytes) => {
      if (file !== undefined) {
        await app.vault.modifyBinary(file, toBuffer(bytes));
        return;
      }
      const created = await app.vault.createBinary(
        await newSymbolPath(app, sourcePath),
        toBuffer(bytes),
      );
      file = created;
      editor.replaceRange(
        embedFromLink(
          app.fileManager.generateMarkdownLink(created, sourcePath),
        ),
        position,
      );
    },
  }).open();
}

/** Opens the editor for an existing symbol file. */
export async function editSymbol(app: App, file: TFile): Promise<void> {
  const bytes = new Uint8Array(await app.vault.readBinary(file));
  let opened;
  try {
    opened = await openInk(bytes);
  } catch (error) {
    new Notice(
      `Could not open ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  if (opened.kind === "newer-version") {
    new Notice(
      `${file.name} was saved by a newer version of Inkline. Update Inkline to edit it.`,
    );
    return;
  }
  new InkEditorModal(app, {
    title: symbolStem(file.name) ?? file.basename,
    document: opened.document,
    ...(opened.base === undefined ? {} : { base: opened.base }),
    carried: opened.carried,
    center: opened.width / 2,
    write: async (saved) => {
      await app.vault.modifyBinary(file, toBuffer(saved));
    },
  }).open();
}
