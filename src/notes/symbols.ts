// Creating, inserting, and editing symbols in the vault: the editor's work
// with files and notes.

import {
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  TFile,
  getLinkpath,
  normalizePath,
  type App,
} from "obsidian";
import { inkExtension, isInkPath } from "../format/ink-file.ts";
import { openInk } from "../ink/canvas.ts";
import { emptyDocument } from "../ink/document.ts";
import {
  fingerprintOf,
  type CreatedFile,
  type DraftStore,
} from "../editor/drafts.ts";
import {
  InkEditorModal,
  type EditorOptions,
  type SymbolCopy,
  type SymbolFile,
} from "../editor/modal.ts";
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
 * A file that a new symbol's first save made, or was making: by its path,
 * and, once it is found, as the vault's file, which follows renames.
 */
interface Claim extends CreatedFile {
  readonly file?: TFile;
}

/** Whether `file` is still the vault's file at its path. */
function present(app: App, file: TFile): boolean {
  return app.vault.getFileByPath(file.path) === file;
}

/** The symbol file at `path`, as the editor reads it again. */
function symbolFile(app: App, path: string): SymbolFile {
  return {
    path,
    read: async () => {
      const file = app.vault.getFileByPath(path);
      return file === null
        ? undefined
        : new Uint8Array(await app.vault.readBinary(file));
    },
  };
}

/**
 * Writes a symbol's bytes to its file, or, once that was deleted, to a new
 * file at its path, with the folders it needs; returns the file written.
 */
async function writeSymbol(
  app: App,
  file: TFile,
  bytes: Uint8Array,
): Promise<TFile> {
  const now = present(app, file) ? file : app.vault.getFileByPath(file.path);
  if (now !== null) {
    await app.vault.modifyBinary(now, toBuffer(bytes));
    return now;
  }
  const folder = parentPath(file.path);
  if (folder !== "" && app.vault.getAbstractFileByPath(folder) === null) {
    await app.vault.createFolder(folder);
  }
  return app.vault.createBinary(file.path, toBuffer(bytes));
}

/**
 * The claimed file and a fingerprint of what it holds, if that is what was
 * last written there, or what it held before a write that may not have
 * happened: one that an interrupted first save made, unchanged since. A file
 * that changes while it is read is left alone.
 */
async function claimedFile(
  app: App,
  claim: Claim,
): Promise<{ file: TFile; fingerprint: string } | undefined> {
  const file = claim.file ?? app.vault.getFileByPath(claim.path);
  if (file === null || !present(app, file)) return undefined;
  const { mtime, size } = file.stat;
  const bytes = new Uint8Array(await app.vault.readBinary(file));
  const fingerprint = await fingerprintOf(bytes);
  if (fingerprint !== claim.fingerprint && fingerprint !== claim.previous) {
    return undefined;
  }
  return present(app, file) &&
    file.stat.mtime === mtime &&
    file.stat.size === size
    ? { file, fingerprint }
    : undefined;
}

/**
 * Whether the target note already embeds `file`, as when an interrupted
 * first save inserted it before its draft could say so: its text, live or on
 * disk, holds the embed Inkline inserts, or one that the metadata cache
 * resolves to the file. A link that does not embed the file does not count.
 */
async function embeds(
  app: App,
  target: Target,
  file: TFile,
  embed: string,
): Promise<boolean> {
  const note = target.file;
  const view = liveView(app, note, target.view);
  const text = view?.editor.getValue() ?? (await app.vault.read(note));
  if (text.includes(embed)) return true;
  // The cache may lag the text, so an embed counts only if it is still there.
  return (app.metadataCache.getFileCache(note)?.embeds ?? []).some(
    (cached) =>
      text.includes(cached.original) &&
      app.metadataCache.getFirstLinkpathDest(
        getLinkpath(cached.link),
        note.path,
      ) === file,
  );
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
  /**
   * The symbol's file once made, a fingerprint of what was last written
   * there, and of what it held before while that write is under way.
   */
  let made:
    | {
        file: TFile;
        fingerprint: string;
        previous: string | undefined;
      }
    | undefined;
  /** A file being made, or one that a restored draft's first save made. */
  let claim: Claim | undefined;
  /** Whether `made` came from a claim, and so may be in the note already. */
  let adopted = false;
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
            ? claim && {
                path: claim.file?.path ?? claim.path,
                fingerprint: claim.fingerprint,
                ...(claim.previous === undefined
                  ? {}
                  : { previous: claim.previous }),
              }
            : {
                path: made.file.path,
                fingerprint: made.fingerprint,
                ...(made.previous === undefined
                  ? {}
                  : { previous: made.previous }),
              };
        return file === undefined
          ? { kind: "new", note: note.path }
          : { kind: "new", note: note.path, file };
      },
      restored: (draft) => {
        if (made !== undefined || draft.target.kind !== "new") return;
        const created = draft.target.file;
        const found =
          created === undefined ? null : app.vault.getFileByPath(created.path);
        claim =
          created === undefined || found === null
            ? created
            : { ...created, file: found };
      },
    },
    lifecycle: host.lifecycle,
    copyFrom: (closed) => copySymbol(host, closed),
    file: () => made && symbolFile(app, made.file.path),
    // Until the embed is inserted, the draft is kept before each write, so
    // that it names the file and the bytes even after a crash. If storage
    // refuses it, the write goes ahead: the file then holds the drawing.
    // The editor learns what the file holds as soon as it is adopted or
    // written, so that a later failure leaves it still compared.
    write: async (bytes, _record, keepDraft, holds) => {
      stillAlive(host);
      const fingerprint = await fingerprintOf(bytes);
      if (made === undefined && claim !== undefined) {
        const claimed = await claimedFile(app, claim);
        if (claimed !== undefined) {
          made = { ...claimed, previous: undefined };
          adopted = true;
          holds(claimed.fingerprint);
        }
      }
      stillAlive(host);
      if (made === undefined) {
        const path = await newSymbolPath(app, note.path);
        stillAlive(host);
        claim = { path, fingerprint };
        keepDraft();
        const file = await app.vault.createBinary(path, toBuffer(bytes));
        made = { file, fingerprint, previous: undefined };
        holds(fingerprint);
      } else {
        // A draft kept meanwhile names both, since the file holds either.
        const before = made.fingerprint;
        made.fingerprint = fingerprint;
        made.previous = before;
        if (!inserted) keepDraft();
        try {
          made.file = await writeSymbol(app, made.file, bytes);
          holds(fingerprint);
        } catch (error) {
          made.fingerprint = before;
          throw error;
        } finally {
          made.previous = undefined;
        }
      }
      if (inserted) return;
      // Once Inkline is disabled, the editor's draft finishes the insertion.
      stillAlive(host);
      const embed = embedFromLink(
        app.fileManager.generateMarkdownLink(made.file, note.path),
      );
      if (!adopted || !(await embeds(app, target, made.file, embed))) {
        stillAlive(host);
        await insertEmbed(app, target, embed);
      }
      inserted = true;
    },
  }).open();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Asks which of the vault's symbols to start from, by its path. */
class SymbolChoice extends FuzzySuggestModal<TFile> {
  readonly #symbols: readonly TFile[];
  readonly #chosen: (file: TFile | undefined) => void;
  #done = false;

  constructor(
    app: App,
    symbols: readonly TFile[],
    chosen: (file: TFile | undefined) => void,
  ) {
    super(app);
    this.#symbols = symbols;
    this.#chosen = chosen;
    this.setPlaceholder("Start from which symbol?");
  }

  override getItems(): TFile[] {
    return [...this.#symbols];
  }

  override getItemText(file: TFile): string {
    return file.path;
  }

  override onChooseItem(file: TFile): void {
    this.#done = true;
    this.#chosen(file);
  }

  override onClose(): void {
    // A choice closes the modal before it is reported, so wait for it.
    void Promise.resolve().then(() => {
      if (!this.#done) this.#chosen(undefined);
    });
  }
}

/**
 * Asks which symbol to start a new one from, and opens it for editing as a
 * copy; undefined when none is chosen, or with a notice when the choice
 * cannot be opened. When `closed` aborts, as when the editor that asked
 * closes, the choice closes and nothing is opened.
 */
async function copySymbol(
  host: EditorHost,
  closed: AbortSignal,
): Promise<SymbolCopy | undefined> {
  const { app } = host;
  const symbols = app.vault
    .getFiles()
    .filter((file) => isInkPath(file.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (symbols.length === 0) {
    new Notice("There are no symbols to start from yet.");
    return undefined;
  }
  // Read as a call: the signal can abort while this waits.
  const ended = (): boolean => closed.aborted;
  if (ended()) return undefined;
  const file = await new Promise<TFile | undefined>((resolve) => {
    const choice = new SymbolChoice(app, symbols, resolve);
    closed.addEventListener(
      "abort",
      () => {
        choice.close();
      },
      { once: true },
    );
    choice.open();
  });
  if (file === undefined || ended() || !host.alive()) return undefined;
  let opened;
  try {
    opened = await openInk(new Uint8Array(await app.vault.readBinary(file)));
  } catch (error) {
    new Notice(`Could not open ${file.name}: ${message(error)}`);
    return undefined;
  }
  if (ended()) return undefined;
  if (opened.kind === "newer-version") {
    new Notice(
      `${file.name} was saved by a newer version of Inkline. Update Inkline to start from it.`,
    );
    return undefined;
  }
  return {
    name: symbolStem(file.name) ?? file.basename,
    ink: opened,
  };
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
  /** The symbol's file: the one opened, or the one a save made again. */
  let symbol = file;
  new InkEditorModal(app, {
    title: symbolStem(file.name) ?? file.basename,
    document: opened.document,
    ...(opened.base === undefined ? {} : { base: opened.base }),
    carried: opened.carried,
    center: opened.width / 2,
    width: opened.width,
    fingerprint,
    drafts: {
      store: host.drafts,
      // The file's path follows renames.
      target: () => ({ kind: "file", path: symbol.path }),
    },
    lifecycle: host.lifecycle,
    file: () => symbolFile(app, symbol.path),
    write: async (saved) => {
      stillAlive(host);
      symbol = await writeSymbol(app, symbol, saved);
    },
  }).open();
}
