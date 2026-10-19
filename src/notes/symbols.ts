// Creating, inserting, and editing symbols in the vault: the editor's work
// with files and notes.

import {
  Notice,
  TFile,
  normalizePath,
  type App,
  type MarkdownView,
} from "obsidian";
import { inkExtension } from "../format/ink-file.ts";
import { openInk } from "../ink/canvas.ts";
import { emptyDocument } from "../ink/document.ts";
import { draftKey } from "../editor/drafts.ts";
import { InkEditorModal, type EditorOptions } from "../editor/modal.ts";
import { visibleWidth } from "../editor/view.ts";
import { capturePoint, findPoint, type InsertionPoint } from "./insertion.ts";
import { embedFromLink, nextNumberName, symbolStem } from "./names.ts";

/** What the plugin lends the editors it opens. */
export interface EditorHost {
  readonly app: App;
  /** Tracks open editors, so that unloading can close them. */
  readonly lifecycle: NonNullable<EditorOptions["lifecycle"]>;
  /** Whether the plugin is still loaded; nothing is written once it is not. */
  readonly alive: () => boolean;
}

/** An `ArrayBuffer` holding exactly these bytes, as the vault takes. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function stillAlive(host: EditorHost): void {
  if (!host.alive()) throw new Error("Inkline was disabled");
}

/**
 * Where a new symbol for the note at `sourcePath` goes: Obsidian's attachment
 * location for it, with the lowest number name that no file or folder there
 * already has.
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
    .map((child) => symbolStem(child.name))
    .filter((stem): stem is string => stem !== undefined);
  for (;;) {
    const stem = nextNumberName(taken);
    const name = `${stem}${inkExtension}`;
    const path = normalizePath(folder === "" ? name : `${folder}/${name}`);
    if (app.vault.getAbstractFileByPath(path) === null) return path;
    taken.push(stem);
  }
}

/** The note and position a new symbol's embed goes to. */
interface Target {
  readonly view: MarkdownView;
  readonly file: TFile;
  readonly point: InsertionPoint;
}

/**
 * Inserts an embed into the target note: in its editor when that still shows
 * the note, otherwise into the note's file, at the position found again from
 * its surrounding text. When the position cannot be found, the embed goes at
 * the end of the note, and a notice says so.
 */
async function insertEmbed(
  app: App,
  target: Target,
  embed: string,
): Promise<void> {
  const { view, file, point } = target;
  // A closed tab's view can still name its file, so it must also still be in
  // the workspace.
  const open = app.workspace
    .getLeavesOfType("markdown")
    .some((leaf) => leaf.view === view);
  if (open && view.file === file) {
    const editor = view.editor;
    const at = findPoint(editor.getValue(), point);
    if (at !== undefined) {
      editor.replaceRange(embed, editor.offsetToPos(at));
      return;
    }
  }
  const outcome = { appended: false };
  await app.vault.process(file, (text) => {
    const at = findPoint(text, point);
    if (at !== undefined) return text.slice(0, at) + embed + text.slice(at);
    outcome.appended = true;
    const gap = text === "" || text.endsWith("\n") ? "" : "\n";
    return `${text}${gap}${embed}\n`;
  });
  if (outcome.appended) {
    new Notice(
      `The note changed where the symbol was going, so it was added at the end of ${file.basename}.`,
    );
  }
}

/**
 * Opens the editor for a new symbol in the note `view` shows, at its cursor.
 * Nothing is created until the first save, which creates the file and then
 * inserts its embed. If the insertion fails, the file is kept and the next
 * save tries the insertion again; later saves update the file.
 */
export function insertSymbol(host: EditorHost, view: MarkdownView): void {
  const { app } = host;
  const file = view.file;
  if (file === null) return;
  const editor = view.editor;
  const target: Target = {
    view,
    file,
    point: capturePoint(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
  };
  let created: TFile | undefined;
  let inserted = false;
  new InkEditorModal(app, {
    title: "New symbol",
    document: emptyDocument,
    center: visibleWidth / 2,
    draft: { store: app, key: draftKey({ newIn: file.path }) },
    lifecycle: host.lifecycle,
    write: async (bytes) => {
      stillAlive(host);
      if (created === undefined) {
        created = await app.vault.createBinary(
          await newSymbolPath(app, file.path),
          toBuffer(bytes),
        );
      } else {
        await app.vault.modifyBinary(created, toBuffer(bytes));
      }
      if (inserted) return;
      stillAlive(host);
      await insertEmbed(
        app,
        target,
        embedFromLink(app.fileManager.generateMarkdownLink(created, file.path)),
      );
      inserted = true;
    },
  }).open();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Opens the editor for an existing symbol file, reporting any failure. */
export async function editSymbol(host: EditorHost, file: TFile): Promise<void> {
  const { app } = host;
  let opened;
  try {
    opened = await openInk(new Uint8Array(await app.vault.readBinary(file)));
  } catch (error) {
    new Notice(`Could not open ${file.name}: ${message(error)}`);
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
    draft: { store: app, key: draftKey({ file: file.path }) },
    lifecycle: host.lifecycle,
    write: async (saved) => {
      stillAlive(host);
      await app.vault.modifyBinary(file, toBuffer(saved));
    },
  }).open();
}
