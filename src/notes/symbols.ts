// Creating, inserting, and editing symbols in the vault: the editor's work
// with files and notes.

import {
  ConfirmationModal,
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  SuggestModal,
  TFile,
  getLinkpath,
  prepareSimpleSearch,
  type App,
  type FuzzyMatch,
} from "obsidian";
import { isInkPath } from "../format/ink-file.ts";
import { toBase64 } from "../format/record.ts";
import { readFileText, type SymbolText } from "../format/text.ts";
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
  type SymbolUses,
} from "../editor/modal.ts";
import { visibleWidth } from "../editor/view.ts";
import {
  capturePoint,
  closeCell,
  findPoint,
  lineAtEnd,
  replacedBefore,
  writeAt,
  type InsertionPoint,
} from "./insertion.ts";
import { embedFor } from "./embeds.ts";
import {
  CutShort,
  PathTaken,
  watchSave,
  type SaveWait,
} from "./file-writes.ts";
import type { SymbolFiles } from "./symbol-files.ts";
import {
  cutShortReason,
  parentPath,
  present,
  stillAlive,
  takenReason,
  toBuffer,
} from "./symbol-writes.ts";
import { insertionAt } from "./links.ts";
import { shownGuides, type Settings } from "../settings.ts";
import { symbolStem, type NameChoice } from "./names.ts";
import {
  chosen,
  claimName,
  makeFolder,
  nameTaken,
  newSymbolPath,
  symbolPathIn,
} from "./symbol-paths.ts";
import {
  matchSymbols,
  renderSymbol,
  SymbolSearch,
  type SymbolMatch,
  type SymbolTexts,
} from "./suggest.ts";
import { isBlank } from "./text-fields.ts";
import { markNotice, message } from "../notices.ts";
import { rename, renamingOf } from "./renames.ts";

/**
 * How long, in milliseconds, to go on looking at an editor that a rename left
 * with the old embed: long enough for its own save, two seconds after an edit,
 * to come and go. Running out writes nothing.
 */
const settleLimit = 5000;

/** How often, in milliseconds, to look. */
const settleCheck = 20;

/**
 * How many numbers a new symbol's first save tries, as files keep coming to
 * the path it found free, before it says so.
 */
const attemptsToMake = 3;

/**
 * How long, in milliseconds, opening a symbol goes on before a notice says so.
 * An ordinary symbol takes a tenth of this, and one near the format's limit a
 * second or more, while Obsidian goes on answering.
 */
const openingNoticeAfter = 300;

/** What the plugin lends the editors it opens. */
export interface EditorHost extends SymbolFiles {
  /** Inkline's settings as they are now. */
  readonly settings: () => Settings;
  /** Tracks open editors, so that unloading can close them. */
  readonly lifecycle: NonNullable<EditorOptions["lifecycle"]>;
  /** The vault's drafts. */
  readonly drafts: DraftStore;
  /** What the vault's symbols say about themselves, as far as it is read. */
  readonly texts: SymbolTexts;
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
function editingCell(view: MarkdownView): boolean {
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
  if (!present(app.vault, note)) throw new NoteGone(note);
  await app.vault.process(note, (text) => {
    if (!present(app.vault, note)) throw new NoteGone(note);
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
 * `uncovered` says that no modal is over the note as this writes, so that
 * the person can type in it at once. A table cell being edited then must not
 * take the embed as Obsidian passes it on, a moment later and computed
 * against the cell's text as it was: a key in that moment changes the cell,
 * and the embed is lost (#415). So the cell closes first, with
 * {@link closeCell}, the embed goes into the note's own text as an ordinary
 * edit, saved and passed to the note's other panes as any is, and the note
 * gets the focus at the new cursor in the same step, which opens the cell
 * again around it. The next key then goes after the embed. The cell closed is
 * the one the cursor was in when the command began, which the place found
 * comes from.
 */
async function insertEmbed(
  app: App,
  target: Target,
  embed: string,
  uncovered = false,
): Promise<InsertionPoint> {
  const { file, point } = target;
  if (!present(app.vault, file)) throw new NoteGone(file);
  const view = liveView(app, file, target.view);
  if (view !== undefined) {
    const editor = view.editor;
    const text = editor.getValue();
    const found = findPoint(text, point);
    // Never inside a link or embed, which the embed would split.
    const place = found === undefined ? undefined : insertionAt(text, found);
    if (place !== undefined) {
      const inserted = place.before + embed;
      if (uncovered && editingCell(view)) closeCell(editor, place.at);
      writeAt(editor, place.at, inserted);
      if (uncovered) takeFocus(view);
      return pointAfterChange(view, text, place.at + inserted.length);
    }
    // The end of the note is in no cell, so the change goes straight in.
    const { before, after } = lineAtEnd(text);
    writeAt(editor, text.length, before + embed, after);
    if (uncovered) takeFocus(view);
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
 * Makes a new symbol's file, at the path `pathFor` finds for it under `name`,
 * as {@link newSymbolPath} or {@link symbolPathIn} does, and returns it.
 * `claimed` hears each path before anything is written there, for the first
 * save's claim and draft. A file that comes to the path in the
 * moment between finding it free and making the file, as by another plugin or
 * a sync tool working through Obsidian, is left as it is (#388): a name typed
 * for the symbol is refused, as it would have been had the file come first,
 * and a numbered symbol takes the next free number, up to three times. Once
 * Inkline is disabled, nothing more is made.
 *
 * Its own write that stops part-way, as on a full disk, leaves nothing at the
 * path, unless what it left there could not be taken away, as
 * `SymbolWrites.make` says. `claimed` then hears that path again with a
 * fingerprint of what was left, which the claim keeps as what the file may
 * hold, so that the next save takes that file as its own and writes it whole
 * (#425), rather than leave it for good and take another name, or refuse the
 * name typed.
 */
async function makeNewSymbol(
  host: EditorHost,
  pathFor: () => Promise<string>,
  name: NameChoice,
  claimed: (path: string, left?: string) => void,
  buffer: ArrayBuffer,
  told: SaveWait,
): Promise<TFile> {
  const { app } = host;
  for (let tries = 1; ; tries++) {
    const path = await pathFor();
    stillAlive(host.unloaded);
    claimed(path);
    try {
      return await watchSave(host.writes.make(path, buffer), told);
    } catch (error) {
      if (error instanceof CutShort) {
        claimed(path, await fingerprintOf(error.held));
        const at = path.slice(path.lastIndexOf("/") + 1);
        throw new Error(
          cutShortReason(error.message, at, error.held, new Uint8Array(buffer)),
        );
      }
      if (!(error instanceof PathTaken)) throw error;
      if (name.kind === "name") claimName(app, parentPath(path), name.name);
      if (name.kind === "name" || tries >= attemptsToMake) {
        throw new PathTaken(await takenReason(app.vault, path));
      }
    }
  }
}

/**
 * Throws if the disk holds, at the claim's path, the part that a cut-short
 * write of the save's own left there (#425), as its `previous` says, and the
 * vault does not list it yet. After a copy that stopped part-way and whose part
 * could not be taken away, Obsidian lists that part only once its watch of the
 * disk sees it. A save meanwhile would find the path taken, go on to another,
 * and claim that one, so that the part stayed for good, or, with a name typed,
 * the name was refused until the part was deleted by hand. This keeps the
 * claim, for the next save to take that file as its own once it is listed.
 */
async function waitForOwnPart(app: App, claim: Claim): Promise<void> {
  const { path, previous } = claim;
  if (
    previous === undefined ||
    app.vault.getAbstractFileByPath(path) !== null
  ) {
    return;
  }
  const held = await app.vault.adapter.readBinary(path).catch(() => undefined);
  if (
    held === undefined ||
    (await fingerprintOf(new Uint8Array(held))) !== previous
  ) {
    return;
  }
  const name = path.slice(path.lastIndexOf("/") + 1);
  throw new Error(
    `${name} holds what was written before it stopped, which Obsidian has not listed yet; save again in a moment`,
  );
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
  if (file === null || !present(app.vault, file)) return undefined;
  const { mtime, size } = file.stat;
  const bytes = new Uint8Array(await app.vault.readBinary(file));
  const fingerprint = await fingerprintOf(bytes);
  if (fingerprint !== claim.fingerprint && fingerprint !== claim.previous) {
    return undefined;
  }
  return present(app.vault, file) &&
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
 * symbol. A cursor already there stays as it is, as a table cell's editor may
 * have it.
 *
 * Both wait for the rest of the modal's close, if it is still closing, and no
 * longer. On a desktop, where Inkline runs, Obsidian closes a modal in one
 * step: its `onClose`, then the focus given back to what had it before the
 * modal opened. A microtask queued in `onClose` runs after that step and
 * before anything a person does, a key, a shortcut, a click, a paste, or a
 * drop, which each wait for a task of their own. A timer, which is such a
 * task, let a busy machine take their first keys first, and then moved the
 * cursor from where they had put it, which put what they typed next out of
 * order (#387). After a change on disk took a table cell's editor away,
 * nothing had the focus until the timer, so a key went nowhere, and a
 * shortcut, which Obsidian still ran on this note, had its cursor moved after
 * it (#429).
 */
function returnFocus(app: App, target: Target, point?: InsertionPoint): void {
  const view = liveView(app, target.file, target.view);
  if (view === undefined) return;
  const { containerEl, editor } = view;
  containerEl.win.queueMicrotask(() => {
    const at =
      point === undefined ? undefined : findPoint(editor.getValue(), point);
    if (at !== undefined && at !== editor.posToOffset(editor.getCursor())) {
      editor.setCursor(editor.offsetToPos(at));
    }
    takeFocus(view);
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
    buttonLabels: host.settings().buttonLabels,
    // A new symbol starts with no text, even after Next, as what someone takes
    // one symbol to be says nothing of the next.
    next: (chosen) => {
      // A note deleted after this symbol went in has nowhere for the next.
      const gone =
        after !== undefined &&
        !host.unloaded.aborted &&
        !present(app.vault, note);
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
    file: () => made && host.writes.symbolFile(made.file.path),
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
        } else {
          await waitForOwnPart(app, claim);
        }
      }
      stillAlive(host.unloaded);
      if (made === undefined) {
        const file = await makeNewSymbol(
          host,
          () =>
            newSymbolPath(app, note.path, name, host.settings().symbolFolder),
          name,
          (path, left) => {
            // What a write that stopped part-way left, which the next save
            // takes as the file it made, as what it held before a write.
            claim =
              left === undefined
                ? { path, fingerprint }
                : { path, fingerprint, previous: left };
            keepDraft();
          },
          toBuffer(bytes),
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
        let left: string | undefined;
        try {
          made.file = await host.writes.save(
            made.file,
            bytes,
            check,
            wait.told,
            (held) => {
              left = held;
              holds(held);
            },
          );
          holds(fingerprint);
        } catch (error) {
          // A write cut short leaves what it wrote, which a draft kept now
          // names; any other failure, what the file held.
          made.previous = undefined;
          made.fingerprint = left ?? before;
          if (left !== undefined && !inserted) keepDraft();
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
          if (
            inserted &&
            after !== undefined &&
            named &&
            present(app.vault, note)
          ) {
            const now = embedFor(app, made.file, note.path);
            try {
              after =
                (await followRename(app, target, after, was, now)) ?? after;
            } catch (error) {
              // Deleted as the embed was followed.
              if (present(app.vault, note)) throw error;
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
        if (present(app.vault, note)) return false;
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
    file: () => host.writes.symbolFile(symbol.path),
    write: async (saved, _record, _keepDraft, holds, typed, check, wait) => {
      stillAlive(host.unloaded);
      const renaming = renamingOf(app, symbol, chosen(typed, symbol));
      symbol = await host.writes.save(symbol, saved, check, wait.told, holds);
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
  new InkEditorModal(app, {
    title: "New symbol",
    // A field left empty keeps the name of the file it writes over, which is
    // claimed only once the draft is restored, and follows a rename. The save
    // takes that file only if `claimedFile` finds it unchanged, and makes the
    // next number otherwise, so the field says so. Once a save has made or
    // taken the file, the field shows the file's own name instead.
    unnamed: () => {
      if (claim === undefined) return undefined;
      const path = claim.file?.path ?? claim.path;
      const kept = symbolStem(path.slice(path.lastIndexOf("/") + 1));
      return kept === undefined
        ? undefined
        : `to keep the name ${kept} if its file is unchanged`;
    },
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
    file: () => made && host.writes.symbolFile(made.path),
    write: async (bytes, _record, keepDraft, holds, typed, check, wait) => {
      stillAlive(host.unloaded);
      if (made === undefined && claim !== undefined) {
        const found = await claimedFile(app, claim);
        if (found === undefined) {
          await waitForOwnPart(app, claim);
        } else {
          made = found.file;
          holds(found.fingerprint);
        }
      }
      stillAlive(host.unloaded);
      if (made !== undefined) {
        const renaming = renamingOf(app, made, chosen(typed, made));
        made = await host.writes.save(made, bytes, check, wait.told, holds);
        stillAlive(host.unloaded);
        return rename(host, renaming, wait);
      }
      // Checked before anything is written, so that a refused name leaves
      // the vault as it was.
      const choice = chosen(typed);
      const fingerprint = await fingerprintOf(bytes);
      made = await makeNewSymbol(
        host,
        async () =>
          folder === undefined
            ? newSymbolPath(app, path, choice, host.settings().symbolFolder)
            : symbolPathIn(
                app,
                folder === "" ? "" : await makeFolder(app, folder),
                choice,
              ),
        choice,
        (at, left) => {
          // As a new symbol's first save keeps what a write cut short left.
          claim =
            left === undefined
              ? { path: at, fingerprint }
              : { path: at, fingerprint, previous: left };
          keepDraft();
        },
        toBuffer(bytes),
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
