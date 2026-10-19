// Creating, inserting, and editing symbols in the vault: the editor's work
// with files and notes.

import { MarkdownView, Notice, TFile, normalizePath, type App } from "obsidian";
import { inkExtension } from "../format/ink-file.ts";
import { openInk } from "../ink/canvas.ts";
import { emptyDocument } from "../ink/document.ts";
import {
  fingerprintOf,
  type CreatedFile,
  type DraftStore,
} from "../editor/drafts.ts";
import { InkEditorModal, type EditorOptions } from "../editor/modal.ts";
import { visibleWidth } from "../editor/view.ts";
import { capturePoint, findPoint, type InsertionPoint } from "./insertion.ts";
import { embedFromLink, nextNumberName, symbolStem } from "./names.ts";

/** What the plugin lends the editors it opens. */
export interface EditorHost {
  readonly app: App;
  /** Tracks open editors, so that unloading can close them. */
  readonly lifecycle: NonNullable<EditorOptions["lifecycle"]>;
  /** The vault's drafts. */
  readonly drafts: DraftStore;
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
 * A Markdown view showing `file`, preferring `preferred`. A closed tab's view
 * can still name its file, so only views still in the workspace count.
 */
function liveView(
  app: App,
  file: TFile,
  preferred: MarkdownView,
): MarkdownView | undefined {
  const views = app.workspace
    .getLeavesOfType("markdown")
    .map((leaf) => leaf.view)
    .filter(
      (view): view is MarkdownView =>
        view instanceof MarkdownView && view.file === file,
    );
  return views.find((view) => view === preferred) ?? views[0];
}

function appendedNotice(file: TFile): void {
  new Notice(
    `The note changed where the symbol was going, so it was added at the end of ${file.basename}.`,
  );
}

/**
 * Inserts an embed into the target note at the position found again from its
 * surrounding text: through a live editor of the note when there is one,
 * since it may hold changes not yet on disk, otherwise into the note's file.
 * When the position cannot be found, the embed goes at the end of the note,
 * and a notice says so.
 */
async function insertEmbed(
  app: App,
  target: Target,
  embed: string,
): Promise<void> {
  const { file, point } = target;
  const view = liveView(app, file, target.view);
  if (view !== undefined) {
    const editor = view.editor;
    const text = editor.getValue();
    const at = findPoint(text, point);
    if (at !== undefined) {
      editor.replaceRange(embed, editor.offsetToPos(at));
      return;
    }
    const gap = text === "" || text.endsWith("\n") ? "" : "\n";
    editor.replaceRange(`${gap}${embed}\n`, editor.offsetToPos(text.length));
    appendedNotice(file);
    return;
  }
  const outcome = { appended: false };
  await app.vault.process(file, (text) => {
    const at = findPoint(text, point);
    if (at !== undefined) return text.slice(0, at) + embed + text.slice(at);
    outcome.appended = true;
    const gap = text === "" || text.endsWith("\n") ? "" : "\n";
    return `${text}${gap}${embed}\n`;
  });
  if (outcome.appended) appendedNotice(file);
}

/**
 * The file at `claim`'s path, if it still holds what was last written there:
 * one that an interrupted first save made, and nothing has changed since.
 */
async function claimedFile(
  app: App,
  claim: CreatedFile,
): Promise<TFile | undefined> {
  const file = app.vault.getFileByPath(claim.path);
  if (file === null) return undefined;
  const bytes = new Uint8Array(await app.vault.readBinary(file));
  return (await fingerprintOf(bytes)) === claim.fingerprint ? file : undefined;
}

/**
 * Opens the editor for a new symbol in the note `view` shows, at its cursor.
 * Nothing is created until the first save, which creates the file and then
 * inserts its embed. If the insertion fails, the file is kept and the next
 * save tries the insertion again; later saves update the file.
 *
 * Until the embed is inserted, the editor's draft names the file the first
 * save made, or is making, so that a draft restored after an interruption
 * finishes that save: it writes over that file, if it is unchanged, rather
 * than make another, and inserts the embed once.
 */
export function insertSymbol(host: EditorHost, view: MarkdownView): void {
  const { app } = host;
  const note = view.file;
  if (note === null) return;
  const editor = view.editor;
  const target: Target = {
    view,
    file: note,
    point: capturePoint(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
  };
  /** The symbol's file once made, and a fingerprint of what it holds. */
  let made: { readonly file: TFile; fingerprint: string } | undefined;
  /** A file being made, or one that a restored draft's first save made. */
  let claim: CreatedFile | undefined;
  let inserted = false;
  new InkEditorModal(app, {
    title: "New symbol",
    document: emptyDocument,
    center: visibleWidth / 2,
    drafts: {
      store: host.drafts,
      // Once inserted, the symbol is its file, whatever the note does.
      target: () => {
        if (made !== undefined && inserted) {
          return { kind: "file", path: made.file.path };
        }
        const file =
          made === undefined
            ? claim
            : { path: made.file.path, fingerprint: made.fingerprint };
        return file === undefined
          ? { kind: "new", note: note.path }
          : { kind: "new", note: note.path, file };
      },
      restored: (draft) => {
        if (made === undefined && draft.target.kind === "new") {
          claim = draft.target.file;
        }
      },
    },
    lifecycle: host.lifecycle,
    write: async (bytes) => {
      stillAlive(host);
      const fingerprint = await fingerprintOf(bytes);
      if (made === undefined && claim !== undefined) {
        const file = await claimedFile(app, claim);
        if (file !== undefined) made = { file, fingerprint: claim.fingerprint };
      }
      stillAlive(host);
      if (made === undefined) {
        const path = await newSymbolPath(app, note.path);
        stillAlive(host);
        // Named before it exists, in case Inkline is disabled meanwhile.
        claim = { path, fingerprint };
        const file = await app.vault.createBinary(path, toBuffer(bytes));
        made = { file, fingerprint };
      } else {
        // Recorded first, so that a draft kept meanwhile names these bytes.
        const before = made.fingerprint;
        made.fingerprint = fingerprint;
        try {
          await app.vault.modifyBinary(made.file, toBuffer(bytes));
        } catch (error) {
          made.fingerprint = before;
          throw error;
        }
      }
      if (inserted) return;
      // Once Inkline is disabled, the editor's draft finishes the insertion.
      stillAlive(host);
      await insertEmbed(
        app,
        target,
        embedFromLink(
          app.fileManager.generateMarkdownLink(made.file, note.path),
        ),
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
  let fingerprint;
  try {
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    opened = await openInk(bytes);
    fingerprint = await fingerprintOf(bytes);
  } catch (error) {
    new Notice(`Could not open ${file.name}: ${message(error)}`);
    return;
  }
  // Inkline may have been disabled while the file was read.
  if (!host.alive()) return;
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
    drafts: {
      store: host.drafts,
      // The file's path follows renames.
      target: () => ({ kind: "file", path: file.path }),
      fingerprint,
    },
    lifecycle: host.lifecycle,
    write: async (saved) => {
      stillAlive(host);
      await app.vault.modifyBinary(file, toBuffer(saved));
    },
  }).open();
}
