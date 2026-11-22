// Creating, inserting, and editing symbols in the vault: the editor's work
// with files and notes.

import {
  ConfirmationModal,
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  SuggestModal,
  TFile,
  TFolder,
  getLinkpath,
  normalizePath,
  prepareSimpleSearch,
  type App,
  type FuzzyMatch,
  type TAbstractFile,
} from "obsidian";
import { inkExtension, isInkPath } from "../format/ink-file.ts";
import { readChunks } from "../format/png.ts";
import { toBase64 } from "../format/record.ts";
import { readFileText, readText, type SymbolText } from "../format/text.ts";
import {
  decodePng,
  drawableBase,
  openInk,
  openPicture,
  saveInk,
  type EditableInk,
} from "../ink/canvas.ts";
import { emptyDocument } from "../ink/document.ts";
import {
  drawingOf,
  fingerprintOf,
  sameTarget,
  type CreatedFile,
  type Draft,
  type DraftStore,
} from "../editor/drafts.ts";
import {
  createdFile,
  findOrphans,
  folderOf,
  orphanName,
  orphanPlace,
  recoveredName,
  recoveryQuestion,
  whyListed,
  type Orphan,
  type Unopened,
} from "../editor/recovery.ts";
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
  lineAtEnd,
  replacedBefore,
  sameText,
  writeAt,
  type InsertionPoint,
} from "./insertion.ts";
import { embedFor } from "./embeds.ts";
import {
  changedText,
  changeFile,
  RenameDisturbed,
  saveFile,
  stoppable,
  unreadableText,
  watchRename,
  watchSave,
  WriteQueue,
  type DiskLine,
  type RenameWait,
  type SaveWait,
} from "./file-writes.ts";
import { insertionAt } from "./links.ts";
import { shownGuides, type Settings } from "../settings.ts";
import {
  chooseRename,
  linkedNames,
  nextNumberName,
  symbolStem,
  type NameChoice,
} from "./names.ts";
import {
  matchSymbols,
  renderSymbol,
  SymbolSearch,
  type SymbolMatch,
  type SymbolTexts,
} from "./suggest.ts";
import { isBlank, type TextChanges } from "./text-fields.ts";
import { markNotice } from "../notices.ts";

/**
 * How long, in milliseconds, to go on looking at an editor that a rename left
 * with the old embed: long enough for its own save, two seconds after an edit,
 * to come and go. Running out writes nothing.
 */
const settleLimit = 5000;

/** How often, in milliseconds, to look. */
const settleCheck = 20;

/**
 * How long, in milliseconds, opening a symbol goes on before a notice says so.
 * An ordinary symbol takes a tenth of this, and one near the format's limit a
 * second or more, while Obsidian goes on answering.
 */
const openingNoticeAfter = 300;

/**
 * Every write over a symbol's file, from the library and the editor alike, so
 * that one's read, check, and write cannot fall between another's, whatever
 * happens to the file meanwhile. A file a first save makes has nothing to go
 * between: it was not there to read.
 */
const writes = new WriteQueue();

/**
 * Why a save is refused once it has written, when its file was deleted, or
 * another put at its path, by something asked of the disk ahead of the write.
 */
const replacedAsWritten =
  "the file was deleted or replaced as it was written, so what is at its path may hold this save";

/**
 * Obsidian's line of disk operations, where this version of Obsidian keeps it,
 * or undefined, which leaves a save as it was without this. None of it is in
 * Obsidian's API, so this is the one place that reads it, and anything of
 * another shape counts as missing (#10). It can go once Obsidian's API has a
 * write that writes a file only if it is still the one at its path.
 *
 * In Obsidian 1.13.4 and 1.15.1, the desktop's file system adapter runs every
 * read, write, existence check, and deletion of a vault's files in one promise
 * chain, `promise`, which each joins at its end as it is asked: `readBinary` and
 * `modifyBinary` ask the adapter at once, with the file's path. Whatever joins
 * the chain while a save reads its file therefore runs before the save's write,
 * and only once it runs does the vault drop a file deleted or add one created.
 */
function diskLine(app: App): DiskLine | undefined {
  const { adapter } = app.vault;
  const last = (): unknown => Reflect.get(adapter, "promise");
  if (!(last() instanceof Promise)) return undefined;
  const ignore = (): void => undefined;
  return {
    last,
    settle: async () => {
      const queued = last();
      if (queued instanceof Promise) await queued.then(ignore, ignore);
    },
  };
}

/**
 * The look an editor's save takes at its file, in the save's turn: the first
 * read of a symbol asked meanwhile notes what the disk's line had last been
 * asked once it was. Inkline's saves take turns, so one look is under way at a
 * time. Another editor's read can come first, which only notes an earlier
 * point, so that the save looks again.
 */
let looking: { asked: unknown } | undefined;

/**
 * The symbols Obsidian is renaming for Inkline, from the call to its
 * `renameFile` until that ends, which lasts as long as its question about
 * links. A second rename of one of them is refused at once, as a failed rename
 * is, rather than waiting behind the first for as long as that takes.
 *
 * This covers Inkline's own renames of one symbol, not every rename Obsidian
 * puts off. Asked for a rename of any file while it is moving the files of
 * another, Obsidian takes it into that one: it says it has renamed the file at
 * once, and moves it once the other's moves end, so nothing could tell whether
 * the name was given. {@link renameSaved} asks only once Obsidian is moving
 * nothing, where {@link moveWaits} can see that. Where it cannot,
 * {@link watchMove} finds the file not yet moved when Obsidian says it is done.
 */
const beingRenamed = new WeakSet<TFile>();

/** Throws if Obsidian is renaming `file` for Inkline, as {@link beingRenamed}. */
function notBeingRenamed(file: TFile): void {
  if (beingRenamed.has(file)) {
    throw new Error("Obsidian is still renaming this symbol.");
  }
}

/** What the plugin lends the editors it opens. */
export interface EditorHost {
  readonly app: App;
  /** Inkline's settings as they are now. */
  readonly settings: () => Settings;
  /** Tracks open editors, so that unloading can close them. */
  readonly lifecycle: NonNullable<EditorOptions["lifecycle"]>;
  /** The vault's drafts. */
  readonly drafts: DraftStore;
  /** What the vault's symbols say about themselves, as far as it is read. */
  readonly texts: SymbolTexts;
  /** Aborts as the plugin unloads; nothing is written once it has. */
  readonly unloaded: AbortSignal;
}

/** An `ArrayBuffer` holding exactly these bytes, as the vault takes. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Throws once `unloaded` has aborted, as Inkline unloads, so that nothing more
 * is written.
 */
function stillAlive(unloaded: AbortSignal): void {
  if (unloaded.aborted) throw new Error("Inkline was disabled");
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
 * Whether `folder` already holds something named `name`.ink.png, in any
 * letter case, as Windows and macOS read names, other than `own`.
 */
function nameTaken(
  app: App,
  folder: string,
  name: string,
  own?: TFile,
): boolean {
  const file = `${name}${inkExtension}`.toLowerCase();
  return namesIn(app, folder).some(
    (other) =>
      other.toLowerCase() === file && pathIn(folder, other) !== own?.path,
  );
}

/** Throws if `folder` already holds a symbol named `name`, as {@link nameTaken}. */
function claimName(app: App, folder: string, name: string, own?: TFile): void {
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
function symbolPathIn(app: App, folder: string, name: NameChoice): string {
  if (name.kind === "name") {
    claimName(app, folder, name.name);
    return pathIn(folder, `${name.name}${inkExtension}`);
  }
  const taken = [
    ...namesIn(app, folder)
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

/** The note and position a new symbol's embed goes to. */
interface Target {
  readonly view: MarkdownView;
  readonly file: TFile;
  readonly point: InsertionPoint;
}

/**
 * A Markdown view showing `file` in an editor, preferring `preferred`. A closed
 * tab's view can still name its file, so only views still in the workspace
 * count. A view in Reading view keeps an editor out of sight, whose changes
 * never reach the note, so it does not count either.
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
        view instanceof MarkdownView &&
        view.file === file &&
        view.getMode() === "source",
    );
  return views.find((view) => view === preferred) ?? views[0];
}

/**
 * Whether Live Preview is editing a table cell in `view`. Obsidian's API does
 * not say, so this looks for the cell's own editor, an editor in one of the
 * wrappers Obsidian gives a table's cells, which goes once the cell closes.
 */
function cellOpen(view: MarkdownView): boolean {
  return (
    view.contentEl.querySelector(".table-cell-wrapper .cm-content") !== null
  );
}

/**
 * Gives `view`'s editor the focus at its cursor if nothing has it, as when the
 * table cell it was in has closed. Setting the cursor where it is opens that
 * cell again, around it.
 */
function takeFocus(view: MarkdownView): void {
  const { containerEl, editor } = view;
  if (containerEl.doc.activeElement !== containerEl.doc.body) return;
  editor.focus();
  editor.setCursor(editor.getCursor());
}

function appendedNotice(file: TFile): void {
  markNotice(
    new Notice(
      `The note changed where the symbol was going, so it was added at the end of ${file.basename}.`,
    ),
  );
}

/**
 * The point `end` in the text of `view`'s editor just after a change to it,
 * as that read `was` before. Obsidian passes a change inside a table cell that
 * Live Preview is editing to the cell's own editor, which takes it on a timer
 * of its window, and can pad the table's columns as it does, moving what lay
 * around the point: the note's cursor says where it is then.
 */
async function pointAfterChange(
  view: MarkdownView,
  was: string,
  end: number,
): Promise<InsertionPoint> {
  const { editor } = view;
  if (editor.getValue() !== was) return capturePoint(editor.getValue(), end);
  await new Promise((resolve) => {
    view.containerEl.win.setTimeout(resolve);
  });
  return capturePoint(
    editor.getValue(),
    editor.posToOffset(editor.getCursor()),
  );
}

/**
 * Thrown when the note an embed is for is no longer the vault's file at its
 * path: deleted, as by sync or on another device, or deleted and another put
 * in its place, which must not take an embed meant for the first.
 */
class NoteGone extends Error {
  constructor(note: TFile) {
    super(`${note.basename} was deleted`);
    this.name = "NoteGone";
  }
}

/**
 * Changes the text of the file of `note` as `change` says, or throws
 * {@link NoteGone} and writes nothing once the note is no longer the vault's
 * file at its path. A note put at that path since is another, so the check is
 * made again inside Obsidian's `process`, between its read and its write.
 */
async function processNote(
  app: App,
  note: TFile,
  change: (text: string) => string,
): Promise<void> {
  if (!present(app, note)) throw new NoteGone(note);
  await app.vault.process(note, (text) => {
    if (!present(app, note)) throw new NoteGone(note);
    return change(text);
  });
}

/**
 * Inserts an embed into the target note at the position found again from its
 * surrounding text: through a live editor of the note when there is one,
 * since it may hold changes not yet on disk, otherwise into the note's file,
 * whose line breaks stay as they are. A position inside a link or embed moves
 * to just past it, so that the embed never splits one, with a space first
 * after a bare web address, which only a space ends. When the position cannot
 * be found, the embed goes at the end of the note, and a notice says so. As
 * after a typed character, the cursor of the editor that took the embed lands
 * just after it; the text of a selection stays, as the embed goes beside it.
 * Returns the point just after the embed, where the next symbol's embed goes.
 *
 * `open` says that no modal is over the note as this writes, so that the
 * person can type in it at once. A table cell being edited then must not take
 * the embed as Obsidian passes it on, a moment later and computed against the
 * cell's text as it was: a key in that moment changes the cell, and the embed
 * is lost (#415). So the change goes to the note's own text, as Obsidian's
 * reload does, which closes the cell's editor first, and the note gets the
 * focus at the new cursor in the same step, which opens the cell again around
 * it. The next key then goes after the embed.
 */
async function insertEmbed(
  app: App,
  target: Target,
  embed: string,
  open = false,
): Promise<InsertionPoint> {
  const { file, point } = target;
  if (!present(app, file)) throw new NoteGone(file);
  const view = liveView(app, file, target.view);
  if (view !== undefined) {
    const editor = view.editor;
    const text = editor.getValue();
    const found = findPoint(text, point);
    // Never inside a link or embed, which the embed would split.
    const place = found === undefined ? undefined : insertionAt(text, found);
    const origin = open && cellOpen(view) ? "set" : undefined;
    if (place !== undefined) {
      const inserted = place.before + embed;
      writeAt(editor, place.at, inserted, "", origin);
      if (open) takeFocus(view);
      return pointAfterChange(view, text, place.at + inserted.length);
    }
    const { before, after } = lineAtEnd(text);
    writeAt(editor, text.length, before + embed, after, origin);
    if (open) takeFocus(view);
    appendedNotice(file);
    return pointAfterChange(
      view,
      text,
      text.length + before.length + embed.length,
    );
  }
  const outcome: { appended: boolean; after?: InsertionPoint } = {
    appended: false,
  };
  await processNote(app, file, (text) => {
    const found = findPoint(text, point);
    const place = found === undefined ? undefined : insertionAt(text, found);
    if (place !== undefined) {
      const { at, before } = place;
      const inserted = text.slice(0, at) + before + embed + text.slice(at);
      outcome.after = capturePoint(inserted, at + before.length + embed.length);
      return inserted;
    }
    outcome.appended = true;
    const { before, after } = lineAtEnd(text);
    const appended = `${text}${before}${embed}${after}`;
    outcome.after = capturePoint(
      appended,
      text.length + before.length + embed.length,
    );
    return appended;
  });
  if (outcome.appended) appendedNotice(file);
  if (outcome.after === undefined) throw new Error("the note did not change");
  return outcome.after;
}

/**
 * Saves every open note whose editor holds text its file lacks, or throws
 * without going on if one cannot be saved. A save that fails rejects, and on
 * Obsidian 1.13 one that comes during another returns before its text is
 * written, so the file is read again to be sure.
 *
 * Each read waits, and a note found saved can be typed in while a later one is
 * read. So this returns a check, which waits for nothing, of whether every open
 * note's editor still holds the text found saved in it; a note opened since, or
 * one whose tab shows another note now, has not been looked at, and fails it.
 * Once `unloaded` aborts, it saves no more notes, and throws.
 */
async function saveOpenNotes(
  app: App,
  unloaded: AbortSignal,
): Promise<() => boolean> {
  const found = new Map<MarkdownView, { file: TFile; text: string }>();
  for (const { view } of app.workspace.getLeavesOfType("markdown")) {
    if (!(view instanceof MarkdownView) || view.file === null) continue;
    const { file } = view;
    /** What the editor holds, if the file holds it too. */
    const saved = async (): Promise<string | undefined> => {
      const text = await app.vault.read(file);
      const shown = view.getViewData();
      return sameText(text, shown) ? shown : undefined;
    };
    let text = await saved();
    if (text === undefined) {
      stillAlive(unloaded);
      // Obsidian reports a save that fails, and keeps the editor's text.
      text = await view.save().then(saved, () => undefined);
    }
    if (text === undefined) {
      throw new Error(`the note ${file.basename} could not be saved first`);
    }
    found.set(view, { file, text });
  }
  return () =>
    app.workspace.getLeavesOfType("markdown").every(({ view }) => {
      if (!(view instanceof MarkdownView) || view.file === null) return true;
      const seen = found.get(view);
      return seen?.file === view.file && seen.text === view.getViewData();
    });
}

/**
 * How many times a rename goes through the open notes, for one typed in while
 * they were being saved, before it gives up.
 */
const notePasses = 3;

/**
 * Waits for `waiting`, or until `unloaded` aborts, whichever comes first. The
 * signal lasts as long as Inkline does, so this stops listening to it once the
 * wait ends.
 */
async function unlessUnloaded(
  waiting: Promise<void>,
  unloaded: AbortSignal,
): Promise<void> {
  if (unloaded.aborted) return;
  let unload = (): void => undefined;
  const aborted = new Promise<void>((resolve) => {
    unload = resolve;
  });
  unloaded.addEventListener("abort", unload, { once: true });
  try {
    await Promise.race([waiting, aborted]);
  } finally {
    unloaded.removeEventListener("abort", unload);
  }
}

/** The notes that link to the file at `path`, as Obsidian last indexed them. */
function notesLinking(app: App, path: string): Set<string> {
  const notes = new Set<string>();
  const { resolvedLinks } = app.metadataCache;
  for (const [note, targets] of Object.entries(resolvedLinks)) {
    if ((targets[path] ?? 0) > 0) notes.add(note);
  }
  return notes;
}

/**
 * A rename of a symbol's file, as {@link renamingOf} checked it: the file, the
 * path it had then, and the name it takes in that path's folder.
 */
export interface Renaming {
  readonly file: TFile;
  /** Where the file was when its new name was checked. */
  readonly from: string;
  /** The file's name then, which notices call it by. */
  readonly fileName: string;
  /** The new name, without `.ink.png`. */
  readonly name: string;
  /** The new path, in the folder of `from`. */
  readonly to: string;
}

/**
 * Throws unless `renaming` still holds as it was checked: its file is still the
 * vault's file at the path it had then, which one deleted, replaced by another
 * file at that path, or renamed elsewhere is not, and no other file in that
 * folder has come by the new name. The name's own rules depend only on what was
 * typed and the file's name, which that keeps as it was.
 */
function confirmRenaming(app: App, renaming: Renaming): void {
  const { file, from, name } = renaming;
  if (app.vault.getFileByPath(from) !== file) {
    throw new Error(
      present(app, file)
        ? `the file was renamed to ${file.path} meanwhile`
        : "the file was deleted or replaced meanwhile",
    );
  }
  claimName(app, parentPath(from), name, file);
}

/**
 * What Obsidian's `renameFile` waits for before it moves a file, as far as
 * {@link moveWaits} can see it.
 */
interface MoveWaits {
  /**
   * Whether `renameFile`, called now, would reach its move without waiting for
   * anything: no rename moving files, none queued or asking about links, and
   * the index caught up with the whole vault. Waits for nothing.
   */
  readonly clear: () => boolean;
  /**
   * Waits for the renames queued now, and then for the index, as `renameFile`
   * would. More can start meanwhile, so {@link MoveWaits.clear} is asked
   * again once it ends.
   */
  readonly settle: () => Promise<void>;
}

/**
 * What Obsidian's `renameFile` waits for, where this version of Obsidian keeps
 * it, or undefined, which leaves a rename as it was without this. None of it is
 * in Obsidian's API, so this is the one place that reads it, and anything of
 * another shape counts as missing (#10). It can go once Obsidian's API has a
 * rename that moves a file only if it is still at its path, or a way to know
 * that `renameFile` will not wait.
 *
 * In Obsidian 1.13.4 and 1.15.0, `renameFile` hands the move to the file
 * manager's `runAsyncLinkUpdate`. While another rename is moving its files,
 * which `inProgressUpdates` shows, that takes the move into that rename and
 * resolves at once. Otherwise it queues the move on `updateQueue`, a promise
 * chain behind every rename still moving files or asking about links, and then
 * waits for the metadata cache's `onCleanCache`, which is when `isCacheClean`
 * finds every file indexed and its links resolved. Only then does `vault.rename`
 * move whatever is at the file's path, without checking that it is still the
 * file. With all of that clear, `renameFile` reaches `vault.rename` within
 * microtasks, before any event, timer, or person can come between, and that
 * takes the file's path at once. The disk still does first what Obsidian had
 * begun to do before, which {@link watchMove} hears of.
 *
 * The public `resolved` event cannot stand in for this: it comes only when the
 * links were being resolved, so a wait for it, with the cache already clean,
 * would never end, and it says nothing of the index or the queue.
 */
function moveWaits(app: App): MoveWaits | undefined {
  const cache = app.metadataCache;
  const manager = app.fileManager;
  const isCacheClean: unknown = Reflect.get(cache, "isCacheClean");
  const onCleanCache: unknown = Reflect.get(cache, "onCleanCache");
  const queue: unknown = Reflect.get(manager, "updateQueue");
  /** The promise that the last rename queued ends with. */
  const last = (): unknown =>
    typeof queue === "object" && queue !== null
      ? Reflect.get(queue, "promise")
      : undefined;
  /** An array while a rename moves its files, of those taken into it. */
  const moving = (): unknown => Reflect.get(manager, "inProgressUpdates");
  const idle = moving();
  if (
    typeof isCacheClean !== "function" ||
    typeof onCleanCache !== "function" ||
    !(last() instanceof Promise) ||
    !(idle === null || Array.isArray(idle))
  ) {
    return undefined;
  }
  const clean = (): boolean => Boolean(Reflect.apply(isCacheClean, cache, []));
  const ignore = (): void => undefined;
  /** The last queued rename's promise, once it was seen to end. */
  let ended: unknown;
  /**
   * Set once Obsidian is found not to work as read above, so that a wait that
   * could never end, or never wait, is not waited for.
   */
  let unlike = false;
  return {
    clear: () => unlike || (moving() === null && last() === ended && clean()),
    settle: async () => {
      const queued = last();
      try {
        if (queued instanceof Promise) await queued.then(ignore, ignore);
        await new Promise<void>((resolve) => {
          Reflect.apply(onCleanCache, cache, [resolve]);
        });
      } catch {
        unlike = true;
      }
      ended = queued;
      // Every rename queued has ended, which leaves none moving files.
      if (last() === queued && clean() && moving() !== null) unlike = true;
    },
  };
}

/** What {@link watchMove} heard of a rename once Obsidian had it. */
interface Move {
  /**
   * What came between the check and Obsidian's move of the file, if anything,
   * with where the file is now. Once Obsidian is `done`, with no move heard
   * of, that it has not moved it; once it has failed, with the file at the new
   * path all the same, that it has the new name.
   */
  readonly disturbed: (done: boolean) => RenameDisturbed | undefined;
  readonly stop: () => void;
}

/**
 * Listens, from Inkline's last check of `renaming` until Obsidian moves the
 * file, for anything else created, deleted, or renamed at the file's path or
 * the new one, in any letter case, as Windows and macOS read names. Obsidian
 * moves whatever is at the file's path, and nothing can stop a move it has
 * begun, so this only tells: a change Obsidian had begun to write before the
 * move, one made outside Obsidian at that moment, or, without
 * {@link moveWaits}, one in Obsidian's own wait.
 *
 * A report takes where the file is from the file itself, which the vault
 * keeps up to date, and not from what is at the new path, which can have come
 * there any way. It says that Obsidian moved something only once Obsidian's
 * rename went through, which moves nothing onto a file already there, and of
 * a file heard going from the checked path to the new one.
 */
function watchMove(app: App, renaming: Renaming): Move {
  const { file, from, to } = renaming;
  const ours = new Set([from.toLowerCase(), to.toLowerCase()]);
  const touches = (path: string): boolean => ours.has(path.toLowerCase());
  /** Whether the file went from its path to the new one, by any rename. */
  let moved = false;
  /** Whether another file did, as Obsidian moves whatever is at the path. */
  let movedOther = false;
  let cause: string | undefined;
  const saw = (what: string): void => {
    if (!moved) cause ??= what;
  };
  const events = [
    app.vault.on("create", (created) => {
      if (touches(created.path)) saw(`${created.path} was created`);
    }),
    app.vault.on("delete", (deleted) => {
      if (deleted === file) saw("the file was deleted");
      else if (touches(deleted.path)) saw(`${deleted.path} was deleted`);
    }),
    app.vault.on("rename", (renamed, old) => {
      if (renamed === file && old === from && renamed.path === to) {
        moved = true;
      } else if (renamed === file) {
        saw(`the file was renamed to ${renamed.path}`);
      } else if (touches(old) || touches(renamed.path)) {
        if (old === from && renamed.path === to) movedOther = true;
        saw(`${old} was renamed to ${renamed.path}`);
      }
    }),
  ];
  return {
    disturbed: (done) => {
      const named = present(app, file) && file.path === to;
      const name = to.slice(to.lastIndexOf("/") + 1);
      if (!done && named) {
        // Obsidian failed with the file at the new name: a rename elsewhere
        // to that very name left its move nowhere to go, or it moved the file
        // and then failed to update the links. Either way, links may not
        // have followed.
        const unfinished = `Obsidian did not finish the rename, though the file is ${to} now, so links to it may still have the old name`;
        return new RenameDisturbed(
          cause === undefined
            ? unfinished
            : `${cause} while Obsidian was renaming it, and ${unfinished}`,
          true,
        );
      }
      if (cause === undefined) {
        return !done || moved || named
          ? undefined
          : new RenameDisturbed(
              "Obsidian had not renamed the file when it said it had, so it may still be renamed",
              false,
            );
      }
      // Where the file is, in the words a cause would use, so that a cause
      // that says so already is not followed by the same words.
      const where = named
        ? `Obsidian renamed the file to ${name} all the same`
        : !present(app, file)
          ? "the file was deleted"
          : file.path === from
            ? `the file is still ${from}`
            : `the file was renamed to ${file.path}`;
      const outcomes = [
        ...(where === cause ? [] : [where]),
        ...(done && movedOther
          ? [`Obsidian renamed another file to ${name}`]
          : []),
      ];
      return new RenameDisturbed(
        [`${cause} while Obsidian was renaming it`, ...outcomes].join(", and "),
        named,
      );
    },
    stop: () => {
      for (const event of events) app.vault.offref(event);
    },
  };
}

/**
 * Gives a symbol's file the path `renaming` chose, through Obsidian, so that the
 * links to it follow as its settings say. Every rename of a symbol comes
 * through here.
 *
 * Obsidian collects the offsets of a file's links, once its index has caught up
 * with what was saved, then asks whether to update them, and writes at those
 * offsets after the answer without checking what is there. An editor saves
 * itself two seconds after an edit, so a save during the question would have it
 * write a link over other text. Saving every open note first leaves those saves
 * nothing to do. Throws, having renamed nothing, if a note cannot be saved.
 *
 * Saving the notes waits, as can whatever came before this, and so does
 * Obsidian's `renameFile` before it moves the file: for other renames, and for
 * its index to catch up with the notes just saved. The vault goes on changing
 * meanwhile: the symbol can be deleted and another file put at its path, which
 * Obsidian would move in its place, or it can be renamed elsewhere, which
 * Obsidian would undo, its new name taken, or a note typed in after it was
 * saved. So the rename first waits for what Obsidian would, where
 * {@link moveWaits} can see it, and then checks all that was checked again,
 * with nothing waiting between that check, the call to `renameFile`, and
 * Obsidian's move. The file moved is then the one checked, from the path it was
 * checked at, to a name no other file has, with every open note saved. A note
 * typed in meanwhile is saved again, up to {@link notePasses} times. Any other
 * change throws, having renamed nothing, with the reason. One that came before
 * this was called, as while the caller wrote the symbol, throws at once, before
 * any note is saved or anything waited for. The check after the waits would
 * almost always refuse it too; it would not only if the vault changed back
 * meanwhile, as when another symbol gave the name up again, and the refusal
 * then changes nothing, with the name kept for the next save to try.
 *
 * What can still come between, a change Obsidian had begun to write before the
 * move, one made outside Obsidian at that moment, or, where Obsidian's waits
 * cannot be seen, one while Obsidian waits, {@link watchMove} hears of. Then this
 * throws {@link RenameDisturbed}, which says what happened and where the file
 * is, rather than resolving as if the rename went as asked. So it does when
 * Obsidian fails with the file at the new name all the same, rather than
 * rejecting as if nothing was renamed.
 *
 * `wait` hears if that all stops for long enough, which only a person being
 * asked, or a report of the symbol or a note that links to it, puts off.
 * `starting` is called just before the rename reaches Obsidian, and can throw to
 * stop it: a note's save, or Obsidian's index, can take as long as anything
 * else. Throws, having renamed nothing, if Obsidian is still renaming the file.
 *
 * Once `unloaded` aborts, as Inkline unloads, the rename throws at its next
 * step, having renamed nothing and saved no more notes, unless Obsidian has it
 * already. Its wait for Obsidian ends then too, as nothing of it is Obsidian's
 * yet, and what Obsidian waits for, such as another rename's question, can
 * last any time.
 */
async function renameSaved(
  app: App,
  renaming: Renaming,
  wait: RenameWait,
  unloaded: AbortSignal,
  starting: () => void = () => undefined,
): Promise<void> {
  const { file } = renaming;
  const notes = notesLinking(app, file.path);
  let moved = false;
  const reported = (changed: TAbstractFile): void => {
    if (changed === file || notes.has(changed.path)) moved = true;
  };
  const reports = [
    app.vault.on("modify", reported),
    app.vault.on("rename", reported),
  ];
  const work = async (): Promise<void> => {
    notBeingRenamed(file);
    // Refuses what has changed already, without waiting. It does not stand in
    // for the check below, after which nothing waits before Obsidian's move.
    confirmRenaming(app, renaming);
    const waits = moveWaits(app);
    let saved = false;
    for (let pass = 0; pass < notePasses && !saved; pass++) {
      stillAlive(unloaded);
      const unchanged = await saveOpenNotes(app, unloaded);
      // Saving a note sets Obsidian's index going again.
      while (waits?.clear() === false) {
        await unlessUnloaded(waits.settle(), unloaded);
        stillAlive(unloaded);
      }
      saved = unchanged();
    }
    if (!saved) {
      throw new Error("the open notes kept changing while they were saved");
    }
    // Nothing from here waits until Obsidian has moved the file, where it lets
    // its waits be seen, so that nothing checked, the notes above included,
    // can change before it does.
    stillAlive(unloaded);
    confirmRenaming(app, renaming);
    notBeingRenamed(file);
    starting();
    beingRenamed.add(file);
    const move = watchMove(app, renaming);
    try {
      await app.fileManager.renameFile(file, renaming.to);
    } catch (error) {
      // What came between, if anything, is why Obsidian could not move it.
      throw move.disturbed(false) ?? error;
    } finally {
      beingRenamed.delete(file);
      move.stop();
    }
    const disturbed = move.disturbed(true);
    if (disturbed !== undefined) throw disturbed;
  };
  const moving = (): boolean => {
    const seen = moved;
    moved = false;
    return seen || wait.asked();
  };
  try {
    await watchRename(work(), moving, wait.told);
  } finally {
    for (const report of reports) app.vault.offref(report);
  }
}

/**
 * Has the embed Inkline inserted just before `point` in the target note follow
 * its symbol's rename by {@link renameSaved}, from `was` to `now`, whichever
 * way Obsidian's question went. Returns the point just after the embed, where
 * the next symbol's goes, or undefined if neither is there any more.
 *
 * Inkline writes only the file, in one step that changes nothing but the embed,
 * and Obsidian alone writes an editor, by its reload. A reload merges a file
 * into an editor holding other text, so that a change both hold lands twice,
 * and a save while a reload is reading has the editor take the file as that
 * reload read it, which costs the text. So nothing here saves or touches an
 * editor, and running out of time only says so.
 *
 * This looks until a live editor has the new name, as the editor saves what it
 * holds when it loses the focus to the next symbol's modal, which must not meet
 * a reload under way. The file gets a look each time too: text that reached the
 * editor after {@link renameSaved} saved it goes to the file by the editor's own
 * save, with the old embed, and writing the file again sets off a reload that
 * brings the two level.
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
  /** `text` with the old embed at `start` made the new one. */
  const replaced = (text: string, start: number): string =>
    text.slice(0, start) + now + text.slice(start + was.length);
  const until = Date.now() + settleLimit;
  for (;;) {
    let after: InsertionPoint | undefined;
    await processNote(app, file, (text) => {
      const found = locate(text);
      if (found === undefined) return text;
      const renamed = found.old ? replaced(text, found.start) : text;
      after = capturePoint(renamed, found.start + now.length);
      return renamed;
    });
    const view = liveView(app, file, target.view);
    if (view === undefined) return after;
    const text = view.editor.getValue();
    const found = locate(text);
    if (found === undefined) return undefined;
    if (!found.old) return capturePoint(text, found.start + now.length);
    if (Date.now() >= until) {
      markNotice(
        new Notice(
          `Check the symbol's embed in ${file.basename}: it may still have the old name.`,
        ),
      );
      return moved;
    }
    await new Promise((resolve) => {
      view.containerEl.win.setTimeout(resolve, settleCheck);
    });
  }
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
      if (file === null) return undefined;
      const reading = app.vault.readBinary(file);
      if (looking !== undefined && looking.asked === undefined) {
        looking.asked = diskLine(app)?.last();
      }
      return new Uint8Array(await reading);
    },
  };
}

/**
 * How `file` takes the name `name` chose, in its own folder, or undefined to
 * keep its name, as an empty name does for a symbol that has one. Throws if
 * another file there has that name. What this finds holds only until something
 * waits, so {@link renameSaved} checks it again before the rename.
 */
function renamingOf(
  app: App,
  file: TFile,
  name: NameChoice,
): Renaming | undefined {
  if (name.kind !== "name" || symbolStem(file.name) === name.name) {
    return undefined;
  }
  const from = file.path;
  const folder = parentPath(from);
  claimName(app, folder, name.name, file);
  return {
    file,
    from,
    fileName: file.name,
    name: name.name,
    to: pathIn(folder, `${name.name}${inkExtension}`),
  };
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
 * The rename that `typed` asks of `file`, as the vault is now, or undefined if
 * it keeps its name; throws with the reason it is refused: a name it cannot
 * take or another symbol in its folder has, a file no longer in the vault, or
 * one that Obsidian is still renaming. Renames nothing, so that the library can
 * refuse a name before it writes anything else, and then rename the file that
 * was checked, from the path it was checked at, with {@link renameChecked}.
 */
export function checkRename(
  app: App,
  file: TFile,
  typed: string,
): Renaming | undefined {
  stillSymbol(app, file);
  const renaming = renamingOf(app, file, chosen(typed, file));
  if (renaming !== undefined) notBeingRenamed(file);
  return renaming;
}

/**
 * Renames a symbol as {@link checkRename} found it, without writing its
 * drawing, using Obsidian's link updates. A file deleted, replaced, or renamed
 * elsewhere since it was checked, as while the library wrote its readings
 * first, or while the rename saves the open notes or waits for Obsidian, is
 * refused, as is a name another symbol took meanwhile. Rejects on failure, so
 * the caller can keep the requested name to retry, and with
 * {@link RenameDisturbed} if something came between once Obsidian had it, or
 * Obsidian failed with the file renamed. `wait` hears if it stops for long
 * enough; {@link SymbolWork.stop} then stops it, unless Obsidian has it, which
 * cannot be taken back. Once `unloaded` aborts, as Inkline unloads, it stops as
 * well, as an editor's rename does, and at once if it is waiting for Obsidian.
 */
export function renameChecked(
  app: App,
  renaming: Renaming,
  wait: RenameWait,
  unloaded: AbortSignal,
): SymbolWork {
  let stopped = false;
  let reached = false;
  const done = renameSaved(app, renaming, wait, unloaded, () => {
    if (stopped) throw new Error("The rename was stopped.");
    reached = true;
  });
  return {
    done,
    stop: () => {
      stopped = true;
      return !reached;
    },
  };
}

/** Throws unless `file` is still the vault's symbol at its path. */
function stillSymbol(app: App, file: TFile): void {
  if (!present(app, file) || !isInkPath(file.path)) {
    throw new Error("The symbol is no longer in the vault.");
  }
}

/**
 * What `file` says about its symbol now, read from the file, whatever its
 * record. Throws with a reason to show if it cannot say anything.
 */
export async function readSymbolText(
  app: App,
  file: TFile,
): Promise<SymbolText> {
  stillSymbol(app, file);
  const bytes = new Uint8Array(await app.vault.readBinary(file));
  try {
    return await readText(readChunks(bytes));
  } catch (error) {
    throw unreadableText(error);
  }
}

/** A save or rename of a symbol under way. */
export interface SymbolWork {
  readonly done: Promise<void>;
  /** Stops it; returns false if it has gone to the vault, and can still end. */
  readonly stop: () => boolean;
}

/**
 * Changes a symbol's readings and translations and nothing else: its file's
 * text chunks, as {@link changedText} says, with every other byte as it was. No
 * note changes, as its name stays. A field changed since `seen`, by another
 * save or anything else, rejects with `TextMoved`, with nothing written; one
 * that this save leaves alone keeps what the other save gave it. Once
 * `unloaded` aborts, as Inkline unloads, it writes nothing more, as an
 * editor's save.
 */
export function writeSymbolText(
  app: App,
  file: TFile,
  changes: TextChanges,
  seen: SymbolText,
  unloaded: AbortSignal,
): SymbolWork {
  const { access, stop } = stoppable<TFile>({
    check: (symbol) => {
      stillAlive(unloaded);
      stillSymbol(app, symbol);
    },
    read: async (symbol) => new Uint8Array(await app.vault.readBinary(symbol)),
    write: async (symbol, bytes) => {
      await app.vault.modifyBinary(symbol, bytes);
      if (!present(app, symbol)) throw new Error(replacedAsWritten);
    },
    line: diskLine(app),
  });
  const done = writes.run(() =>
    changeFile(access, file, (bytes) => changedText(bytes, changes, seen)),
  );
  return { done, stop };
}

/**
 * Gives a symbol's file the path {@link renamingOf} found, through Obsidian, so
 * that the links to it follow as its settings say; returns whether the file has
 * that name now, or no rename was requested. The drawing is written by then, so
 * a rename that fails says so in a notice and leaves the file as it is, rather
 * than failing the save. A save that wrote to another file than the one
 * checked, as after that one was deleted, renames nothing: it is not the file
 * checked. Nothing is renamed once Inkline is disabled, which saving the notes
 * first leaves time for. A rename that something came between once Obsidian
 * had it, or that Obsidian failed with the file renamed, says what happened,
 * whatever the file's name now.
 */
async function rename(
  host: EditorHost,
  renaming: Renaming | undefined,
  wait: RenameWait,
): Promise<boolean> {
  if (renaming === undefined) return true;
  try {
    await renameSaved(host.app, renaming, wait, host.unloaded);
    return true;
  } catch (error) {
    const { fileName } = renaming;
    if (error instanceof RenameDisturbed) {
      markNotice(new Notice(`${fileName} is saved, but ${error.message}`));
      return error.renamed;
    }
    markNotice(
      new Notice(
        `${fileName} is saved, but could not be renamed: ${message(error)}`,
      ),
    );
    return false;
  }
}

/**
 * Writes a symbol's bytes to its file, wherever a rename took it, or, once that
 * was deleted, to what is at its path, or a new file there, with the folders it
 * needs; returns the file written, which a search finds by what it now says at
 * once, ahead of whatever else is waiting to be read. `check` goes first, in the
 * write's turn, so that no other save of Inkline's can come between it and the
 * write, and rejects to write nothing. `waiting` hears if that takes too long.
 */
async function writeSymbol(
  host: EditorHost,
  file: TFile,
  bytes: Uint8Array,
  check: () => Promise<void>,
  waiting: SaveWait,
): Promise<TFile> {
  const { app } = host;
  const buffer = toBuffer(bytes);
  const write = async (): Promise<TFile> => {
    const written = await writes.run(() =>
      saveFile({
        current: () =>
          present(app, file) ? file : app.vault.getFileByPath(file.path),
        check: async () => {
          const look: { asked: unknown } = { asked: undefined };
          looking = look;
          try {
            await check();
          } finally {
            if (looking === look) looking = undefined;
          }
          return look;
        },
        write: async (now) => {
          await app.vault.modifyBinary(now, buffer);
          if (!present(app, now)) throw new Error(replacedAsWritten);
        },
        bytes,
        read: async (found) =>
          new Uint8Array(await app.vault.readBinary(found)),
        line: diskLine(app),
        create: async () => {
          const folder = parentPath(file.path);
          if (
            folder !== "" &&
            app.vault.getAbstractFileByPath(folder) === null
          ) {
            try {
              await app.vault.createFolder(folder);
            } catch (error) {
              // Obsidian makes a folder only where the disk has nothing once
              // it looks, and something else can have made this one meanwhile.
              if (app.vault.getFolderByPath(folder) === null) throw error;
            }
          }
          return app.vault.createBinary(file.path, buffer);
        },
      }),
    );
    await host.texts.refresh(written);
    return written;
  };
  return watchSave(write(), waiting);
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
  const target = targetOf(view);
  if (target !== undefined) newSymbol(host, target);
}

/** Where a symbol inserted at the cursor of `view`'s note goes. */
function targetOf(view: MarkdownView): Target | undefined {
  const { file, editor } = view;
  if (file === null) return undefined;
  return {
    view,
    file,
    point: capturePoint(
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    ),
  };
}

/**
 * Lists the vault's symbols to search, and inserts the one chosen in the note
 * `view` shows, as a new symbol's embed goes in: at its cursor now, found
 * again once the choice is made, since the note can change meanwhile. The
 * list closes as `unloaded` aborts, when Inkline unloads, and nothing is
 * inserted from it after that.
 */
export function insertExistingSymbol(
  app: App,
  texts: SymbolTexts,
  view: MarkdownView,
  unloaded: AbortSignal,
): void {
  const target = targetOf(view);
  if (target === undefined) return;
  new SymbolSearch(app, texts, target.file.path, unloaded, (embed) => {
    // The list has closed by now, and has given the note the focus back.
    insertEmbed(app, target, embed, true)
      .then(() => {
        if (!unloaded.aborted) returnFocus(app, target);
      })
      .catch((error: unknown) => {
        markNotice(
          new Notice(`The symbol could not be inserted: ${message(error)}`),
        );
      });
  }).open();
}

/**
 * Gives a live editor of the target note the focus, once a modal over it has
 * closed, if that found nothing to give it back to: when a note changes on
 * disk, Obsidian takes away the editor of a table cell. Setting the cursor
 * where it is opens that cell again, around it.
 *
 * With `point`, the cursor goes back there first, as the note can have changed
 * on disk or in another pane meanwhile, which takes it away from the last
 * symbol. That waits for the modal too: Obsidian refocuses the note after a
 * modal's close. A cursor already there stays as it is, as a table cell's
 * editor may have it. So does the cursor once the person has typed, used a
 * shortcut, clicked, pasted, cut, or dropped something in the note since the
 * modal closed, which on a busy machine they can do before the wait ends: it
 * is theirs then, and moving it would put what they type next out of order
 * (#387).
 */
function returnFocus(app: App, target: Target, point?: InsertionPoint): void {
  const view = liveView(app, target.file, target.view);
  if (view === undefined) return;
  const { containerEl, editor } = view;
  const back =
    point === undefined
      ? undefined
      : { point, untouched: watchPerson(containerEl) };
  containerEl.win.setTimeout(() => {
    const at =
      back?.untouched() === true
        ? findPoint(editor.getValue(), back.point)
        : undefined;
    if (at !== undefined && at !== editor.posToOffset(editor.getCursor())) {
      editor.setCursor(editor.offsetToPos(at));
    }
    if (containerEl.doc.activeElement !== containerEl.doc.body) return;
    editor.focus();
    editor.setCursor(editor.getCursor());
  });
}

/**
 * What a person does in a note to move its cursor or change its text: a key,
 * a pointer pressed, text put in, a paste or a cut, which the editor takes
 * itself with no input event after it, and a drop.
 */
const personEvents = [
  "keydown",
  "pointerdown",
  "beforeinput",
  "paste",
  "cut",
  "drop",
] as const;

/**
 * Listens, from now on, for a person moving a cursor or changing text in
 * `el`. The function returned stops listening and says whether none came.
 * It listens on the window, before anything below it hears: Obsidian takes
 * the key of a hotkey it handles before it reaches the note. An event counts
 * when it passes through `el`, so one in another pane does not. Nor does a key
 * while nothing has the focus, as after a change on disk took a table cell's
 * editor away, though Obsidian still runs a hotkey's command on this note then,
 * whose cursor is then moved; a plain key then goes nowhere (#429). Any key
 * counts, even one that moves nothing: a cursor left alone stays where
 * Obsidian put it, while one moved after a key can put the next out of order.
 */
function watchPerson(el: HTMLElement): () => boolean {
  const { win } = el;
  let touched = false;
  const touch = (event: Event): void => {
    if (event.composedPath().includes(el)) touched = true;
  };
  for (const type of personEvents) win.addEventListener(type, touch, true);
  return () => {
    for (const type of personEvents) win.removeEventListener(type, touch, true);
    return !touched;
  };
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
    buttonLabels: host.settings().buttonLabels,
    // A new symbol starts with no text, even after Next, as what someone takes
    // one symbol to be says nothing of the next.
    next: (chosen) => {
      // A note deleted after this symbol went in has nowhere for the next.
      const gone =
        after !== undefined && !host.unloaded.aborted && !present(app, note);
      if (after === undefined || host.unloaded.aborted || gone) {
        // No editor takes the picture over.
        chosen.picture?.image.close();
        if (gone) {
          markNotice(
            new Notice(
              `No next symbol was started, as the note it was for, ${note.basename}, was deleted.`,
            ),
          );
        }
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
    lifecycle: {
      ...host.lifecycle,
      closed: (editor) => {
        host.lifecycle.closed(editor);
        if (host.unloaded.aborted || (tools === undefined && !inserted)) return;
        // Following another, this one's point is just after that symbol.
        returnFocus(app, target, after ?? target.point);
      },
    },
    copyFrom: (closed) => copySymbol(host, closed),
    file: () => made && symbolFile(app, made.file.path),
    // Until the embed is inserted, the draft is kept before each write, so
    // that it names the file and the bytes even after a crash. If storage
    // refuses it, the write goes ahead: the file then holds the drawing.
    // The editor learns what the file holds as soon as it is adopted or
    // written, so that a later failure leaves it still compared.
    write: async (bytes, _record, keepDraft, holds, typed, check, wait) => {
      stillAlive(host.unloaded);
      // Checked before anything is written, so that a refused name leaves
      // the vault as it was.
      const name = chosen(typed, made?.file);
      // Compare the requested name and the file's name together, before a
      // hash can yield to an external rename. An unchanged name keeps that
      // rename instead of taking the file back to its name before the save.
      let renaming =
        made === undefined ? undefined : renamingOf(app, made.file, name);
      let named = true;
      const fingerprint = await fingerprintOf(bytes);
      if (made === undefined && claim !== undefined) {
        const claimed = await claimedFile(app, claim);
        if (claimed !== undefined) {
          made = { ...claimed, previous: undefined };
          adopted = true;
          holds(claimed.fingerprint);
          renaming = renamingOf(app, made.file, name);
        }
      }
      stillAlive(host.unloaded);
      if (made === undefined) {
        const path = await newSymbolPath(
          app,
          note.path,
          name,
          host.settings().symbolFolder,
        );
        stillAlive(host.unloaded);
        claim = { path, fingerprint };
        keepDraft();
        const file = await watchSave(
          app.vault.createBinary(path, toBuffer(bytes)),
          wait.told,
        );
        made = { file, fingerprint, previous: undefined };
        holds(fingerprint);
        await host.texts.refresh(file);
      } else {
        // A draft kept meanwhile names both, since the file holds either.
        const before = made.fingerprint;
        made.fingerprint = fingerprint;
        made.previous = before;
        if (!inserted) keepDraft();
        try {
          made.file = await writeSymbol(
            host,
            made.file,
            bytes,
            check,
            wait.told,
          );
          holds(fingerprint);
        } catch (error) {
          made.fingerprint = before;
          throw error;
        } finally {
          made.previous = undefined;
        }
        if (renaming !== undefined) {
          // Obsidian updates the links as its settings say. The embed just
          // inserted, which the answer to its question can leave as it was,
          // follows the symbol it was inserted for once the file has the name
          // given, and the next symbol goes after it. A rename refused renamed
          // nothing, and a file that has another name now, given elsewhere,
          // leaves the embed to whatever renamed it, as every other link to
          // the file is.
          const was = inserted ? embedFor(app, made.file, note.path) : "";
          stillAlive(host.unloaded);
          named = await rename(host, renaming, wait);
          // Even once Inkline is disabled: Obsidian has renamed the file by
          // then, which nothing takes back, so stopping would leave the embed
          // naming a file no longer there. This writes that one embed, and if
          // the note's editor does not show the new name within five seconds,
          // gives up with a notice. A note deleted since has no embed to
          // follow, and the symbol is saved and renamed all the same.
          if (inserted && after !== undefined && named && present(app, note)) {
            const now = embedFor(app, made.file, note.path);
            try {
              after =
                (await followRename(app, target, after, was, now)) ?? after;
            } catch (error) {
              // Deleted as the embed was followed.
              if (present(app, note)) throw error;
            }
          }
        }
      }
      if (inserted) return named;
      // Once Inkline is disabled, the editor's draft finishes the insertion.
      stillAlive(host.unloaded);
      const saved = made.file;
      const embed = embedFor(app, saved, note.path);
      /**
       * Whether the note was deleted, as by sync or on another device, so
       * that there is nowhere to insert the embed. The symbol is saved, and
       * says so: an error would keep the editor open over a saved file, with
       * every save failing the same way.
       */
      const noteGone = (): boolean => {
        if (present(app, note)) return false;
        markNotice(
          new Notice(
            `${saved.name} is saved, but was not inserted, as the note it was for, ${note.basename}, was deleted.`,
          ),
        );
        // Nothing is left to insert: later saves only write the file, which
        // the draft is for from now on, and Next opens no editor after it.
        inserted = true;
        return true;
      };
      if (noteGone()) return named;
      let existing: InsertionPoint | undefined;
      try {
        existing = adopted
          ? await existingEmbed(app, target, saved, embed)
          : undefined;
      } catch (error) {
        // Deleted as it was read.
        if (noteGone()) return named;
        throw error;
      }
      // A read that ends well can still end after the note was deleted, or
      // replaced by another at its path, which must not take the embed.
      if (noteGone()) return named;
      if (existing === undefined) {
        stillAlive(host.unloaded);
        try {
          after = await watchSave(insertEmbed(app, target, embed), wait.told);
        } catch (error) {
          // Deleted as the embed was being written.
          if (noteGone()) return named;
          throw error;
        }
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

/** Says that `name` is opening, as {@link sayWhileSlow} says. */
function sayOpening(name: string): () => void {
  return sayWhileSlow(`Opening ${name}…`);
}

/**
 * Says `text` if what it is about goes on for long, as nothing else shows it:
 * Obsidian keeps answering meanwhile. Returns what ends that.
 */
function sayWhileSlow(text: string): () => void {
  let notice: Notice | undefined;
  const timer = window.setTimeout(() => {
    notice = markNotice(new Notice(text, 0));
  }, openingNoticeAfter);
  return () => {
    window.clearTimeout(timer);
    notice?.hide();
  };
}

/** How many modals are open, the top one holding the keyboard. */
function modalCount(): number {
  return activeDocument.querySelectorAll(".modal-container").length;
}

/**
 * Asks which of the vault's symbols to start from, by its path, or by what one
 * says about itself.
 */
class SymbolChoice extends FuzzySuggestModal<TFile> {
  readonly #symbols: readonly TFile[];
  readonly #texts: SymbolTexts;
  readonly #chosen: (file: TFile | undefined) => void;
  /** The values that the list now showing found its symbols by. */
  #found = new Map<TFile, SymbolMatch>();
  #done = false;

  constructor(
    app: App,
    symbols: readonly TFile[],
    texts: SymbolTexts,
    chosen: (file: TFile | undefined) => void,
  ) {
    super(app);
    this.#symbols = symbols;
    this.#texts = texts;
    this.#chosen = chosen;
    this.setPlaceholder("Start from which symbol?");
  }

  override getSuggestions(query: string): FuzzyMatch<TFile>[] {
    const byPath = super.getSuggestions(query);
    const found = matchSymbols(this.app, this.#texts, query, "").filter(
      (match) => match.found !== undefined,
    );
    this.#found = new Map(found.map((match) => [match.file, match]));
    const listed = new Set(byPath.map(({ item }) => item));
    return [
      ...byPath,
      ...found
        .filter(({ file }) => !listed.has(file))
        .map(({ file, score }) => ({
          item: file,
          match: { score, matches: [] },
        })),
    ].sort((a, b) => b.match.score - a.match.score);
  }

  override getItems(): TFile[] {
    return [...this.#symbols];
  }

  override getItemText(file: TFile): string {
    return file.path;
  }

  override renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
    renderSymbol(this.app, match.item, el, this.#found.get(match.item)?.found);
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
    markNotice(new Notice("There are no symbols to start from yet."));
    return undefined;
  }
  // Read as a call: the signal can abort while this waits.
  const ended = (): boolean => closed.aborted;
  if (ended()) return undefined;
  const file = await new Promise<TFile | undefined>((resolve) => {
    const choice = new SymbolChoice(app, symbols, host.texts, resolve);
    closed.addEventListener(
      "abort",
      () => {
        choice.close();
      },
      { once: true },
    );
    choice.open();
  });
  if (file === undefined || ended() || host.unloaded.aborted) return undefined;
  let opened;
  let text;
  const stopSaying = sayOpening(file.name);
  try {
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    const ink = await openInk(bytes);
    // A copy starts from what the file shows, and leaves the file as it is.
    opened = ink.kind === "damaged" ? await openPicture(bytes) : ink;
    text = await readFileText(bytes);
  } catch (error) {
    markNotice(new Notice(`Could not open ${file.name}: ${message(error)}`));
    return undefined;
  } finally {
    stopSaying();
  }
  if (ended()) return undefined;
  if (opened.kind === "newer-version") {
    markNotice(
      new Notice(
        `${file.name} was saved by a newer version of Inkline. Update Inkline to start from it.`,
      ),
    );
    return undefined;
  }
  return {
    name: symbolStem(file.name) ?? file.basename,
    ink: opened,
    hasText: !isBlank(text),
  };
}

/** The symbol being read to open, which a later open takes the place of. */
let opening: { readonly file: TFile } | undefined;

/**
 * Opens the editor for an existing symbol file, reporting any failure. A large
 * one takes a moment to read, and asking for it again meanwhile, as with a
 * second click, goes on with the same read rather than opening it twice.
 */
export async function editSymbol(host: EditorHost, file: TFile): Promise<void> {
  // A symbol's menu can stay open after Inkline unloads, with Edit symbol in it.
  if (host.unloaded.aborted || opening?.file === file) return;
  const mine = { file };
  opening = mine;
  try {
    await openEditor(host, file, () => opening === mine);
  } finally {
    if (opening === mine) opening = undefined;
  }
}

/** Why a symbol's file does not open. */
interface Refusal {
  /** What a notice says of it. */
  readonly notice: string;
  /** Why, as {@link Unopened} has it. */
  readonly reason: string;
}

/**
 * What reading a symbol's file for its editor found: what it holds, that a
 * newer version of Inkline saved it, or that it could not be read, as when it
 * is not a whole PNG, or that its strokes cannot be.
 */
type SymbolReading =
  | {
      readonly kind: "read";
      readonly opened: EditableInk;
      readonly fingerprint: string;
      readonly drawing: string | undefined;
      readonly text: SymbolText;
    }
  | { readonly kind: "newer" }
  | ({ readonly kind: "failed" } & Refusal)
  | ({ readonly kind: "damaged" } & Refusal);

/**
 * Reads `file` for its editor: what it holds, that a newer version of Inkline
 * saved it, or why it does not open, which the list of drafts goes by too, so
 * that a draft is listed exactly when its file would not open.
 */
async function readForEditing(app: App, file: TFile): Promise<SymbolReading> {
  let opened;
  let fingerprint;
  let drawing;
  let text;
  try {
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    opened = await openInk(bytes);
    fingerprint = await fingerprintOf(bytes);
    drawing = await drawingOf(bytes);
    text = await readFileText(bytes);
  } catch (error) {
    return {
      kind: "failed",
      notice: `Could not open ${file.name}: ${message(error)}`,
      reason: message(error),
    };
  }
  if (opened.kind === "newer-version") return { kind: "newer" };
  if (opened.kind === "damaged") {
    return {
      kind: "damaged",
      notice: `The strokes in ${file.name} cannot be read, so it was not opened, which keeps them as they are. To go on from what it shows, use Copy from in a new symbol.`,
      reason: "its strokes cannot be read",
    };
  }
  return { kind: "read", opened, fingerprint, drawing, text };
}

/**
 * Says that `file` did not open, as `refusal` says why. An editor offers a
 * draft only for a symbol that opens at the path the draft was kept for, so
 * when the vault keeps one for this file, it asks whether to open the newest
 * as a new symbol instead, if `ask`: not once a modal opened over the one the
 * person was in, which a question would take the keys from. Otherwise the
 * notice says the draft is kept, and how to get it back. A new symbol's draft
 * is not counted, as a new symbol in its note offers it. Nothing is read once
 * Inkline is unloading, as reading the drafts drops expired ones.
 */
function didNotOpen(
  host: EditorHost,
  file: TFile,
  refusal: Refusal,
  ask: boolean,
): void {
  const [draft] = host.unloaded.aborted
    ? []
    : host.drafts.forTarget({ kind: "file", path: file.path });
  if (draft === undefined) {
    markNotice(new Notice(refusal.notice));
    return;
  }
  if (ask) {
    askRecovery(host, {
      draft,
      path: file.path,
      unopened: { kind: "unreadable", reason: refusal.reason },
    });
    return;
  }
  // The reason a file could not be read ends with no full stop of its own.
  const stop = /[.!?…]$/.test(refusal.notice) ? "" : ".";
  markNotice(
    new Notice(
      `${refusal.notice}${stop} Unsaved changes to it are kept as a draft. To get them back, run Inkline: Recover drafts from the command palette.`,
    ),
  );
}

/**
 * Reads `file` and opens the editor on it, unless the person went on to
 * something else meanwhile. The newest open is the one they want, which
 * `wanted` says. A modal opened since has the keyboard, and an editor coming up
 * over it would take the keys and the pointer from someone typing or drawing
 * there, so that nothing there is lost, and the notice says to open this again.
 */
async function openEditor(
  host: EditorHost,
  file: TFile,
  wanted: () => boolean,
): Promise<void> {
  const { app } = host;
  const modals = modalCount();
  let reading;
  const stopSaying = sayOpening(file.name);
  try {
    reading = await readForEditing(app, file);
  } finally {
    stopSaying();
  }
  /** Whether a question can come up now, where the person asked. */
  const free = (): boolean =>
    !host.unloaded.aborted && wanted() && modalCount() === modals;
  if (reading.kind === "failed") {
    didNotOpen(host, file, reading, free());
    return;
  }
  // Inkline may have been disabled while the file was read.
  if (host.unloaded.aborted || !wanted()) return;
  if (reading.kind === "newer") {
    markNotice(
      new Notice(
        `${file.name} was saved by a newer version of Inkline. Update Inkline to edit it.`,
      ),
    );
    return;
  }
  if (reading.kind === "damaged") {
    didNotOpen(host, file, reading, free());
    return;
  }
  if (modalCount() > modals) {
    markNotice(
      new Notice(
        `${file.name} did not open, as another window opened while it was being read. Open it again when you are ready.`,
      ),
    );
    return;
  }
  const { opened, fingerprint, drawing, text } = reading;
  /** The symbol's file: the one opened, or the one a save made again. */
  let symbol = file;
  new InkEditorModal(app, {
    title: "Symbol",
    tools: startingTools(host.settings()),
    guideLines: () => shownGuides(host.settings()),
    gridCells: () => host.settings().gridCells,
    buttonLabels: host.settings().buttonLabels,
    name: symbolStem(file.name) ?? file.basename,
    document: opened.document,
    ...(opened.base === undefined ? {} : { base: opened.base }),
    carried: opened.carried,
    ...(opened.picture === true ? { picture: true } : {}),
    text,
    center: opened.width / 2,
    width: opened.width,
    fingerprint,
    ...(drawing === undefined ? {} : { drawing }),
    drafts: {
      store: host.drafts,
      // The file's path follows renames.
      target: () => ({ kind: "file", path: symbol.path }),
    },
    lifecycle: host.lifecycle,
    file: () => symbolFile(app, symbol.path),
    write: async (saved, _record, _keepDraft, _holds, typed, check, wait) => {
      stillAlive(host.unloaded);
      const renaming = renamingOf(app, symbol, chosen(typed, symbol));
      symbol = await writeSymbol(host, symbol, saved, check, wait.told);
      stillAlive(host.unloaded);
      return rename(host, renaming, wait);
    },
    uses: () => usesOf(app, symbol.path),
  }).open();
}

/**
 * Asks whether to open `orphan`'s draft as a new symbol, as
 * {@link recoverDraft} does, or to discard it, holding the draft meanwhile so
 * that no editor or other question takes it. Not now keeps it for another
 * time. The question closes as Inkline unloads, and does nothing after that.
 */
function askRecovery(host: EditorHost, orphan: Orphan): void {
  const { app, drafts, unloaded } = host;
  const { id, savedAt } = orphan.draft;
  drafts.hold(id);
  let answered = false;
  const question = new ConfirmationModal(app);
  const { title, content } = recoveryQuestion(
    orphan,
    new Date(savedAt).toLocaleString(),
  );
  question.setTitle(title);
  question.setContent(content);
  question.addButton((button) =>
    button
      .setButtonText("Open as new symbol")
      .setCta()
      .setInitialFocus()
      .onClick(() => {
        answered = true;
        if (unloaded.aborted) return;
        // It can have expired while the question was open.
        if (drafts.keptAt(id) === undefined) {
          drafts.release(id);
          markNotice(new Notice("That draft is no longer kept."));
          return;
        }
        // The editor holds the draft from now on.
        recoverDraft(host, orphan);
      }),
  );
  question.addButton((button) =>
    button
      .setButtonText("Discard")
      .setDestructive()
      .onClick(() => {
        answered = true;
        if (!unloaded.aborted) drafts.remove(id);
        drafts.release(id);
      }),
  );
  question.addCancelButton("Not now");
  const close = (): void => {
    question.close();
  };
  unloaded.addEventListener("abort", close, { once: true });
  question.setCloseCallback(() => {
    unloaded.removeEventListener("abort", close);
    if (!answered) drafts.release(id);
  });
  question.open();
}

/**
 * A claim as a draft's target names it: at the path of its file, once found,
 * which follows renames, and without that file.
 */
function claimed(claim: Claim): CreatedFile {
  const { fingerprint, previous } = claim;
  const path = claim.file?.path ?? claim.path;
  return previous === undefined
    ? { path, fingerprint }
    : { path, fingerprint, previous };
}

/**
 * Opens the editor on `orphan`'s draft, which the caller holds, as a new
 * symbol: the draft's strokes, the name and text it kept, and a base layer it
 * kept itself. One it took from its file is lost with the file, as the
 * question that offers it says. Its first save inserts it nowhere, and goes:
 *
 * - for a symbol's draft, to a new file in the folder the draft's file was
 *   in, under the name the field holds, which starts as {@link recoveredName}
 *   says, or else the next number there. The notes that embed the old file
 *   still do, and show a new symbol saved at its path. A file that does not
 *   open stays as it is.
 * - for a new symbol's draft whose first save made a file, over that file, if
 *   it still holds what that save wrote, as restoring the draft in its note
 *   would finish the save: it then holds only this symbol's own earlier
 *   drawing, which the draft goes on from, and keeps its name unless another
 *   is typed. Otherwise to a new file beside it, which stays as it is.
 * - for a new symbol's draft never saved, where a new symbol of its note
 *   would go, as {@link newSymbolPath} finds it for the note's old path.
 *
 * Until then the editor's draft is for the symbol the old draft was kept for,
 * so that a crash leaves it where it was found, and the editor keeps it in
 * that draft's place. The first save's draft names the file it is making
 * before it writes, as a new symbol's does, so that a save cut short leaves a
 * draft for that file, which offers it when it opens, or lists it when it does
 * not; a retry writes over that file if it holds what this wrote, rather than
 * make another.
 *
 * The first save's file of a new symbol's draft is claimed only once the
 * draft is restored, as a new symbol's `restored` does, so that an editor
 * left without it, as when it was saved while the draft's base layer was
 * read, writes over nothing.
 */
function recoverDraft(host: EditorHost, orphan: Orphan): void {
  const { app } = host;
  const { draft, path } = orphan;
  const { target } = draft;
  const created = createdFile(orphan);
  /** The file the first save of a new symbol's draft made, once restored. */
  let claim: Claim | undefined;
  /**
   * The folder a first save that makes a file uses, or undefined for a new
   * symbol's draft never saved, which goes where a new symbol of its note
   * would.
   */
  const folder =
    target.kind === "file"
      ? folderOf(path)
      : created === undefined
        ? undefined
        : folderOf(created.path);
  const name = recoveredName(
    orphan,
    (stem) => folder !== undefined && nameTaken(app, folder, stem),
  );
  /** The new symbol's file once made, or taken over. */
  let made: TFile | undefined;
  const keeps =
    created === undefined
      ? undefined
      : symbolStem(created.path.slice(created.path.lastIndexOf("/") + 1));
  new InkEditorModal(app, {
    title: "New symbol",
    // A field left empty keeps the name of the file it writes over.
    ...(keeps === undefined ? {} : { unnamed: `to keep the name ${keeps}` }),
    document: emptyDocument,
    center: visibleWidth / 2,
    tools: startingTools(host.settings()),
    guideLines: () => shownGuides(host.settings()),
    gridCells: () => host.settings().gridCells,
    buttonLabels: host.settings().buttonLabels,
    drafts: {
      store: host.drafts,
      // Once made, the symbol is its file, which follows renames.
      target: () => {
        if (made !== undefined) return { kind: "file", path: made.path };
        if (target.kind === "file") {
          return { kind: "file", path: claim?.path ?? path };
        }
        return claim === undefined
          ? { kind: "new", note: target.note }
          : { kind: "new", note: target.note, file: claimed(claim) };
      },
      recover: name === undefined ? draft : { ...draft, name },
      // As a new symbol's: the file found by its path follows renames.
      restored: () => {
        if (created === undefined) return;
        const found = app.vault.getFileByPath(created.path);
        claim = found === null ? created : { ...created, file: found };
      },
    },
    lifecycle: host.lifecycle,
    file: () => made && symbolFile(app, made.path),
    write: async (bytes, _record, keepDraft, holds, typed, check, wait) => {
      stillAlive(host.unloaded);
      if (made === undefined && claim !== undefined) {
        const found = await claimedFile(app, claim);
        if (found !== undefined) {
          made = found.file;
          holds(found.fingerprint);
        }
      }
      stillAlive(host.unloaded);
      if (made !== undefined) {
        const renaming = renamingOf(app, made, chosen(typed, made));
        made = await writeSymbol(host, made, bytes, check, wait.told);
        stillAlive(host.unloaded);
        return rename(host, renaming, wait);
      }
      // Checked before anything is written, so that a refused name leaves
      // the vault as it was.
      const choice = chosen(typed);
      const fingerprint = await fingerprintOf(bytes);
      const at =
        folder === undefined
          ? await newSymbolPath(app, path, choice, host.settings().symbolFolder)
          : symbolPathIn(
              app,
              folder === "" ? "" : await makeFolder(app, folder),
              choice,
            );
      stillAlive(host.unloaded);
      claim = { path: at, fingerprint };
      keepDraft();
      made = await watchSave(
        app.vault.createBinary(at, toBuffer(bytes)),
        wait.told,
      );
      holds(fingerprint);
      await host.texts.refresh(made);
      return true;
    },
  }).open();
}

/**
 * Why the file at `path` would not open in its editor, for a draft kept for
 * it, or undefined if it opens, or would once Inkline is updated.
 */
async function unopenedAt(
  app: App,
  path: string,
): Promise<Unopened | undefined> {
  const file = app.vault.getFileByPath(path);
  if (file === null) return { kind: "gone" };
  const reading = await readForEditing(app, file);
  return reading.kind === "failed" || reading.kind === "damaged"
    ? { kind: "unreadable", reason: reading.reason }
    : undefined;
}

/**
 * The most pixels a picture in the list of drafts has across and down: a few
 * times the 3em by 1.5em its row shows it in, at any screen's density, so that
 * each one stays a few kilobytes, however large the drawing or its base layer.
 */
const previewSize = { width: 256, height: 64 };

/**
 * A small picture of what opening `draft` as a new symbol brings back, drawn
 * as its first save would draw it, then shrunk to {@link previewSize}, as a
 * data URL; undefined for a draft with nothing to draw, or one that cannot be
 * drawn.
 */
async function previewOf(draft: Draft): Promise<string | undefined> {
  const layer = draft.base.kind === "kept" ? draft.base.layer : undefined;
  if (draft.strokes.length === 0 && layer === undefined) return undefined;
  try {
    const { bytes } = await saveInk(
      layer === undefined
        ? { strokes: draft.strokes }
        : { strokes: draft.strokes, base: layer },
      layer === undefined ? undefined : await drawableBase(layer),
    );
    const image = await decodePng(bytes);
    try {
      const scale = Math.min(
        1,
        previewSize.width / image.width,
        previewSize.height / image.height,
      );
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
      const context = canvas.getContext("2d");
      if (context === null) return undefined;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const picture = await canvas.convertToBlob({ type: "image/png" });
      return `data:image/png;base64,${toBase64(new Uint8Array(await picture.arrayBuffer()))}`;
    } finally {
      image.close();
    }
  } catch {
    return undefined;
  }
}

/** A draft in the list of drafts, with its picture. */
interface DraftRow {
  readonly orphan: Orphan;
  readonly preview: string | undefined;
}

/**
 * The drafts that no editor offers, as {@link findOrphans} finds them, to
 * choose one by the path it was kept for, or for a new symbol's draft, its
 * note's or its first save's. It closes as `unloaded` aborts, when Inkline
 * unloads, as {@link SymbolSearch} does, and a choice that still reaches it
 * then does nothing.
 */
class DraftList extends SuggestModal<DraftRow> {
  readonly #rows: readonly DraftRow[];
  readonly #unloaded: AbortSignal;
  readonly #chosen: (orphan: Orphan) => void;
  readonly #unload = (): void => {
    this.close();
  };

  constructor(
    app: App,
    rows: readonly DraftRow[],
    unloaded: AbortSignal,
    chosen: (orphan: Orphan) => void,
  ) {
    super(app);
    this.#rows = rows;
    this.#unloaded = unloaded;
    this.#chosen = chosen;
    this.setPlaceholder("Recover which draft?");
    this.emptyStateText = "No draft was kept for a symbol at that path.";
  }

  override onOpen(): Promise<void> | void {
    this.#unloaded.addEventListener("abort", this.#unload, { once: true });
    return super.onOpen();
  }

  override onClose(): void {
    this.#unloaded.removeEventListener("abort", this.#unload);
    super.onClose();
  }

  override getSuggestions(query: string): DraftRow[] {
    const search = prepareSimpleSearch(query);
    return this.#rows.filter(({ orphan }) =>
      [orphan.path, createdFile(orphan)?.path].some(
        (path) => path !== undefined && search(path) !== null,
      ),
    );
  }

  override renderSuggestion(
    { orphan, preview }: DraftRow,
    el: HTMLElement,
  ): void {
    el.addClass("inkline-suggestion");
    if (preview !== undefined) {
      // Beside its path, the picture says nothing more to a screen reader.
      el.createEl("img", {
        cls: "inkline-suggestion-picture",
        attr: { src: preview, alt: "", "aria-hidden": "true" },
      });
    }
    const text = el.createDiv({ cls: "inkline-suggestion-text" });
    text.createDiv({
      cls: "inkline-suggestion-name",
      text: orphanName(orphan),
    });
    const place = orphanPlace(orphan);
    if (place !== "") {
      text.createDiv({ cls: "inkline-suggestion-folder", text: place });
    }
    text.createDiv({
      cls: "inkline-suggestion-folder",
      text: `Kept ${new Date(orphan.draft.savedAt).toLocaleString()}. ${whyListed(orphan)}`,
    });
  }

  override onChooseSuggestion({ orphan }: DraftRow): void {
    if (!this.#unloaded.aborted) this.#chosen(orphan);
  }
}

/**
 * Lists the drafts that no editor can offer, newest first: a symbol's draft
 * whose file is gone or does not open, and a new symbol's draft whose note is
 * gone. Asks about the one chosen, as {@link askRecovery} does; a notice says
 * when there is none. Reading the drafts drops expired ones, as any list of
 * them does, and leaves the drafts of later layouts as they are. Each file a
 * draft is for is read in full, as opening it would, to tell whether it
 * opens, and each picture drawn, before the list shows.
 */
export async function recoverDrafts(host: EditorHost): Promise<void> {
  const { app, drafts, unloaded } = host;
  // Read as a call: Inkline can unload while this waits.
  const ended = (): boolean => unloaded.aborted;
  if (ended()) return;
  const rows: DraftRow[] = [];
  const stopSaying = sayWhileSlow("Looking for drafts…");
  try {
    const orphans = await findOrphans(
      drafts.unheld(),
      (path) => unopenedAt(app, path),
      (path) => app.vault.getFileByPath(path) === null,
    );
    for (const orphan of orphans) {
      rows.push({ orphan, preview: await previewOf(orphan.draft) });
    }
  } finally {
    stopSaying();
  }
  if (ended()) return;
  if (rows.length === 0) {
    markNotice(
      new Notice(
        "No draft is waiting for a symbol that is gone or does not open, or for a new symbol whose note is gone. A symbol that opens offers its own drafts.",
      ),
    );
    return;
  }
  new DraftList(app, rows, unloaded, (orphan) => {
    // An editor or a question may have taken it meanwhile, or a rename moved
    // it to the file's new path.
    const now = drafts.unheld().find(({ id }) => id === orphan.draft.id);
    if (now === undefined || !sameTarget(now.target, orphan.draft.target)) {
      markNotice(new Notice("That draft is no longer waiting."));
      return;
    }
    askRecovery(host, orphan);
  }).open();
}
