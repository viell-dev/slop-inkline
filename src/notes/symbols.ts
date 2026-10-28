// Creating, inserting, and editing symbols in the vault: the editor's work
// with files and notes.

import {
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  TFile,
  TFolder,
  getLinkpath,
  normalizePath,
  type App,
  type TAbstractFile,
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
  type EditorTools,
  type SymbolCopy,
  type SymbolFile,
  type SymbolUses,
} from "../editor/modal.ts";
import { visibleWidth } from "../editor/view.ts";
import {
  capturePoint,
  findPoint,
  replacedBefore,
  type InsertionPoint,
} from "./insertion.ts";
import { embedFor } from "./embeds.ts";
import { insertionAt } from "./links.ts";
import { shownGuides, type Settings } from "../settings.ts";
import {
  chooseRename,
  nextNumberName,
  symbolStem,
  type NameChoice,
} from "./names.ts";

/** What the plugin lends the editors it opens. */
export interface EditorHost {
  readonly app: App;
  /** Inkline's settings as they are now. */
  readonly settings: () => Settings;
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

/** The names of what a folder of the vault holds, `""` for its root. */
function namesIn(app: App, folder: string): string[] {
  return (
    app.vault.getFolderByPath(folder === "" ? "/" : folder)?.children ?? []
  ).map((child) => child.name);
}

/** The path of the file named `name` in `folder`. */
function pathIn(folder: string, name: string): string {
  return normalizePath(folder === "" ? name : `${folder}/${name}`);
}

/**
 * Throws if `folder` already holds something named `name`.ink.png, in any
 * letter case, as Windows and macOS read names, other than `own`.
 */
function claimName(app: App, folder: string, name: string, own?: TFile): void {
  const file = `${name}${inkExtension}`.toLowerCase();
  const taken = namesIn(app, folder).some(
    (other) =>
      other.toLowerCase() === file && pathIn(folder, other) !== own?.path,
  );
  if (taken) {
    const where = folder === "" ? "the vault's top folder" : folder;
    throw new Error(`${where} already has a symbol named ${name}`);
  }
}

/**
 * The name `typed` gives a symbol whose file is `file`, if it has one, or
 * throws with the reason it cannot be one. The file's own name, typed
 * again, keeps it.
 */
function chosen(typed: string, file?: TFile): NameChoice {
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
async function makeFolder(app: App, folder: string): Promise<string> {
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
 * the name `name` chose, or else the lowest number name that no file or folder
 * there already has. Throws if the folder has a symbol of that name already.
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
  if (name.kind === "name") {
    claimName(app, folder, name.name);
    return pathIn(folder, `${name.name}${inkExtension}`);
  }
  const taken = namesIn(app, folder)
    .map((child) => symbolStem(child))
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
 * A position inside a link or embed moves to just past it, so that the embed
 * never splits one, with a space first after a bare web address, which only
 * a space ends. When the position cannot be found, the embed goes at the
 * end of the note, and a notice says so. Returns the point just after the
 * embed, where the next symbol's embed goes.
 */
async function insertEmbed(
  app: App,
  target: Target,
  embed: string,
): Promise<InsertionPoint> {
  const { file, point } = target;
  const view = liveView(app, file, target.view);
  if (view !== undefined) {
    const editor = view.editor;
    const text = editor.getValue();
    const found = findPoint(text, point);
    // Never inside a link or embed, which the embed would split.
    const place = found === undefined ? undefined : insertionAt(text, found);
    if (place !== undefined) {
      const inserted = place.before + embed;
      editor.replaceRange(inserted, editor.offsetToPos(place.at));
      return capturePoint(editor.getValue(), place.at + inserted.length);
    }
    const gap = text === "" || text.endsWith("\n") ? "" : "\n";
    editor.replaceRange(`${gap}${embed}\n`, editor.offsetToPos(text.length));
    appendedNotice(file);
    return capturePoint(
      editor.getValue(),
      text.length + gap.length + embed.length,
    );
  }
  const outcome: { appended: boolean; after?: InsertionPoint } = {
    appended: false,
  };
  await app.vault.process(file, (text) => {
    const found = findPoint(text, point);
    const place = found === undefined ? undefined : insertionAt(text, found);
    if (place !== undefined) {
      const { at, before } = place;
      const inserted = text.slice(0, at) + before + embed + text.slice(at);
      outcome.after = capturePoint(inserted, at + before.length + embed.length);
      return inserted;
    }
    outcome.appended = true;
    const gap = text === "" || text.endsWith("\n") ? "" : "\n";
    const appended = `${text}${gap}${embed}\n`;
    outcome.after = capturePoint(
      appended,
      text.length + gap.length + embed.length,
    );
    return appended;
  });
  if (outcome.appended) appendedNotice(file);
  if (outcome.after === undefined) throw new Error("the note did not change");
  return outcome.after;
}

/**
 * Has the embed Inkline inserted just before `point` in the target note
 * follow its symbol's rename, from `was` to `now`: puts `now` in place of
 * `was` if Obsidian left it, or finds where `now` ends if Obsidian already
 * rewrote it. Works through a live editor of the note when there is one,
 * otherwise in the note's file. Returns the point just after the embed, where
 * the next symbol's goes, or undefined if neither is there any more.
 */
async function followRename(
  app: App,
  target: Target,
  point: InsertionPoint,
  was: string,
  now: string,
): Promise<InsertionPoint | undefined> {
  const { file } = target;
  const moved = replacedBefore(point, was, now);
  /** Where the embed is in `text`, and whether it is still the old one. */
  const locate = (
    text: string,
  ): { start: number; old: boolean } | undefined => {
    const end = findPoint(text, point);
    if (end !== undefined && text.slice(end - was.length, end) === was) {
      return { start: end - was.length, old: true };
    }
    const renamed = findPoint(text, moved);
    if (
      renamed !== undefined &&
      text.slice(renamed - now.length, renamed) === now
    ) {
      return { start: renamed - now.length, old: false };
    }
    return undefined;
  };
  const view = liveView(app, file, target.view);
  if (view !== undefined) {
    const editor = view.editor;
    const found = locate(editor.getValue());
    if (found === undefined) return undefined;
    if (found.old) {
      editor.replaceRange(
        now,
        editor.offsetToPos(found.start),
        editor.offsetToPos(found.start + was.length),
      );
    }
    return capturePoint(editor.getValue(), found.start + now.length);
  }
  let after: InsertionPoint | undefined;
  await app.vault.process(file, (text) => {
    const found = locate(text);
    if (found === undefined) return text;
    const replaced = found.old
      ? text.slice(0, found.start) + now + text.slice(found.start + was.length)
      : text;
    after = capturePoint(replaced, found.start + now.length);
    return replaced;
  });
  return after;
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
 * Where `file` goes to take the name `name` chose, in its own folder, or
 * undefined to keep its name, as an empty name does for a symbol that has
 * one. Throws if another file there has that name.
 */
function renamedPath(
  app: App,
  file: TFile,
  name: NameChoice,
): string | undefined {
  if (name.kind !== "name" || symbolStem(file.name) === name.name) {
    return undefined;
  }
  const folder = parentPath(file.path);
  claimName(app, folder, name.name, file);
  return pathIn(folder, `${name.name}${inkExtension}`);
}

/**
 * How many links the vault's notes have to the file at `path`, embeds
 * among them, and how many notes they are in, as Obsidian last indexed them.
 */
function usesOf(app: App, path: string): SymbolUses {
  let links = 0;
  let notes = 0;
  for (const targets of Object.values(app.metadataCache.resolvedLinks)) {
    const count = targets[path] ?? 0;
    if (count <= 0) continue;
    links += count;
    notes++;
  }
  return { links, notes };
}

/**
 * Renames a symbol without writing its drawing, using the editor's name
 * rules and Obsidian's link updates. A deleted or replaced file is refused.
 * Throws on failure, so the caller can keep the requested name to retry.
 */
export async function renameSymbol(
  app: App,
  file: TFile,
  typed: string,
): Promise<void> {
  if (!present(app, file) || !isInkPath(file.path)) {
    throw new Error("The symbol is no longer in the vault.");
  }
  const path = renamedPath(app, file, chosen(typed, file));
  if (path !== undefined) await app.fileManager.renameFile(file, path);
}

/**
 * Gives `file` the path `renamedPath` found, through Obsidian, so that the
 * links to it follow as its settings say; returns whether it succeeded or
 * no rename was requested. The drawing is written by then, so a rename that
 * fails says so in a notice and leaves the file as it is, rather than
 * failing the save.
 */
async function rename(
  app: App,
  file: TFile,
  path: string | undefined,
): Promise<boolean> {
  if (path === undefined) return true;
  try {
    await app.fileManager.renameFile(file, path);
    return true;
  } catch (error) {
    new Notice(
      `${file.name} is saved, but could not be renamed: ${message(error)}`,
    );
    return false;
  }
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
 * Where the target note already embeds `file`, as when an interrupted first
 * save inserted it before its draft could say so: the point just after the
 * embed Inkline inserts, or after one that the metadata cache resolves to the
 * file, however it is written, in the note's text, live or on disk. That is
 * where the next symbol's embed goes. Undefined when the note has no such
 * embed; a link that does not embed the file does not count.
 */
async function existingEmbed(
  app: App,
  target: Target,
  file: TFile,
  embed: string,
): Promise<InsertionPoint | undefined> {
  const note = target.file;
  const view = liveView(app, note, target.view);
  const text = view?.editor.getValue() ?? (await app.vault.read(note));
  const at = text.indexOf(embed);
  if (at !== -1) return capturePoint(text, at + embed.length);
  // The cache may lag the text, so an embed counts only if it is still there.
  for (const cached of app.metadataCache.getFileCache(note)?.embeds ?? []) {
    const found = text.indexOf(cached.original);
    if (
      found !== -1 &&
      app.metadataCache.getFirstLinkpathDest(
        getLinkpath(cached.link),
        note.path,
      ) === file
    ) {
      return capturePoint(text, found + cached.original.length);
    }
  }
  return undefined;
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
  const note = view.file;
  if (note === null) return;
  const editor = view.editor;
  newSymbol(host, {
    view,
    file: note,
    point: capturePoint(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
  });
}

/**
 * The tools an editor starts with when it follows no other: the pen, with
 * the brush and guides the settings choose, and no grid.
 */
function startingTools(settings: Settings): EditorTools {
  return {
    tool: "pen",
    sizeIndex: settings.brushSize,
    grid: false,
    guides: settings.guides,
  };
}

/**
 * Opens the editor for a new symbol whose embed goes to `target`, as
 * {@link insertSymbol} describes, starting with `tools` when it follows
 * another. Its Next opens one more, whose embed follows this one's.
 */
function newSymbol(
  host: EditorHost,
  target: Target,
  tools?: EditorTools,
): void {
  const { app } = host;
  const note = target.file;
  /** Where the next symbol's embed goes, once this one's is in the note. */
  let after: InsertionPoint | undefined;
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
    tools: tools ?? startingTools(host.settings()),
    guideLines: () => shownGuides(host.settings()),
    gridCells: () => host.settings().gridCells,
    next: (chosen) => {
      if (after === undefined || !host.alive()) {
        // No editor takes the picture over.
        chosen.picture?.image.close();
        return;
      }
      newSymbol(host, { ...target, point: after }, chosen);
    },
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
    write: async (bytes, _record, keepDraft, holds, typed) => {
      stillAlive(host);
      // Checked before anything is written, so that a refused name leaves
      // the vault as it was.
      const name = chosen(typed, made?.file);
      // Compare the requested name and the file's name together, before a
      // hash can yield to an external rename. An unchanged name keeps that
      // rename instead of taking the file back to its name before the save.
      let renaming =
        made === undefined ? undefined : renamedPath(app, made.file, name);
      let named = true;
      const fingerprint = await fingerprintOf(bytes);
      if (made === undefined && claim !== undefined) {
        const claimed = await claimedFile(app, claim);
        if (claimed !== undefined) {
          made = { ...claimed, previous: undefined };
          adopted = true;
          holds(claimed.fingerprint);
          renaming = renamedPath(app, made.file, name);
        }
      }
      stillAlive(host);
      if (made === undefined) {
        const path = await newSymbolPath(
          app,
          note.path,
          name,
          host.settings().symbolFolder,
        );
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
        if (renaming !== undefined) {
          // Obsidian updates the links it knows of, as its settings say. The
          // embed just inserted, which its cache can lack for a moment after,
          // or which the answer to its question can leave as it was, follows
          // the symbol it was inserted for, and the next symbol goes after it.
          const was = inserted ? embedFor(app, made.file, note.path) : "";
          const from = made.file.path;
          stillAlive(host);
          named = await rename(app, made.file, renaming);
          // A rename that failed left the file, and its embed, as they were.
          if (inserted && after !== undefined && made.file.path !== from) {
            stillAlive(host);
            const now = embedFor(app, made.file, note.path);
            after = (await followRename(app, target, after, was, now)) ?? after;
          }
        }
      }
      if (inserted) return named;
      // Once Inkline is disabled, the editor's draft finishes the insertion.
      stillAlive(host);
      const embed = embedFor(app, made.file, note.path);
      const existing = adopted
        ? await existingEmbed(app, target, made.file, embed)
        : undefined;
      if (existing === undefined) {
        stillAlive(host);
        after = await insertEmbed(app, target, embed);
      } else {
        after = existing;
      }
      inserted = true;
      return named;
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
    title: "Symbol",
    tools: startingTools(host.settings()),
    guideLines: () => shownGuides(host.settings()),
    gridCells: () => host.settings().gridCells,
    name: symbolStem(file.name) ?? file.basename,
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
    write: async (saved, _record, _keepDraft, _holds, typed) => {
      stillAlive(host);
      const renaming = renamedPath(app, symbol, chosen(typed, symbol));
      symbol = await writeSymbol(app, symbol, saved);
      stillAlive(host);
      return rename(app, symbol, renaming);
    },
    uses: () => usesOf(app, symbol.path),
  }).open();
}
