// Putting a symbol's embed into a note: at the place the cursor was when the
// editor opened, found again in the note's text as it is now, through a live
// editor of the note where there is one, and through its file otherwise; the
// embed just inserted following its symbol to the name Obsidian gave it; and
// the focus given back to the note as a modal over it closes. The rules for
// where text goes are in plain insertion.ts and links.ts; this applies them to
// Obsidian's editors and files, whose own behaviour only the end-to-end tests
// can show.

import {
  getLinkpath,
  MarkdownView,
  Notice,
  type App,
  type TFile,
} from "obsidian";
import { markNotice } from "../notices.ts";
import {
  capturePoint,
  closeCell,
  findPoint,
  lineAtEnd,
  replacedBefore,
  writeAt,
  type InsertionPoint,
} from "./insertion.ts";
import { insertionAt } from "./links.ts";
import { present } from "./symbol-writes.ts";

/**
 * How long, in milliseconds, to go on looking at an editor that a rename left
 * with the old embed: long enough for its own save, two seconds after an edit,
 * to come and go. Running out writes nothing.
 */
const settleLimit = 5000;

/** How often, in milliseconds, to look. */
const settleCheck = 20;

/** The note and position a new symbol's embed goes to. */
export interface Target {
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
export async function insertEmbed(
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
export async function followRename(
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
 * Where the target note already embeds `file`, as when an interrupted first
 * save inserted it before its draft could say so: the point just after the
 * embed Inkline inserts, or after one that the metadata cache resolves to the
 * file, however it is written, in the note's text, live or on disk. That is
 * where the next symbol's embed goes. Undefined when the note has no such
 * embed; a link that does not embed the file does not count.
 */
export async function existingEmbed(
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

/** Where a symbol inserted at the cursor of `view`'s note goes. */
export function targetOf(view: MarkdownView): Target | undefined {
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
export function returnFocus(
  app: App,
  target: Target,
  point?: InsertionPoint,
): void {
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
