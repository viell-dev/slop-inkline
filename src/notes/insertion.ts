// Where a new symbol's embed goes when it is saved: the cursor position taken
// when the editor opened, found again from the text around it, since the note
// can change while the editor is open. A position is held as it reads with
// every line break a `\n`, since an editor gives a note that way whatever its
// file holds, and a file can change between the two at any time.

import type { Editor, EditorPosition } from "obsidian";

/** How much text on each side of the position identifies it. */
const contextLength = 64;

/** Every line break, as Obsidian's editor reads them. */
const lineBreaks = /\r\n?|\n/g;

export interface InsertionPoint {
  /** Its offset, its text, and the length of the text then, with `\n` breaks. */
  readonly offset: number;
  readonly before: string;
  readonly after: string;
  readonly length: number;
}

/** `text` with every line break a `\n`. */
function plain(text: string): string {
  return text.replace(lineBreaks, "\n");
}

/** The offset in `text` of `offset` in its {@link plain} form. */
function fromPlain(text: string, offset: number): number {
  let pairs = 0;
  for (const { index } of text.matchAll(/\r\n/g)) {
    // Each pair before it is one character longer here. A position just
    // before a line break stays before all of it.
    if (index - pairs >= offset) break;
    pairs++;
  }
  return offset + pairs;
}

/** Records a position in `text` with the text around it. */
export function capturePoint(text: string, offset: number): InsertionPoint {
  const whole = plain(text);
  const at = plain(text.slice(0, offset)).length;
  return {
    offset: at,
    before: whole.slice(Math.max(0, at - contextLength), at),
    after: whole.slice(at, at + contextLength),
    length: whole.length,
  };
}

/**
 * `point`, which lay just after the text `was`, as it is once `was` is
 * `now`, as when Obsidian rewrites an embed after a rename: the text before
 * it changed with it, so that it is found where `now` ends.
 */
export function replacedBefore(
  point: InsertionPoint,
  was: string,
  now: string,
): InsertionPoint {
  const { before } = point;
  const kept = before.endsWith(was)
    ? before.slice(0, before.length - was.length)
    : "";
  return {
    offset: point.offset - was.length + now.length,
    before: (kept + now).slice(-contextLength),
    after: point.after,
    length: point.length - was.length + now.length,
  };
}

/** The offset of the only occurrence of `needle`, or undefined. */
function only(text: string, needle: string): number | undefined {
  if (needle === "") return undefined;
  const first = text.indexOf(needle);
  if (first === -1 || text.includes(needle, first + 1)) return undefined;
  return first;
}

/**
 * The offset in `text` where the point now is, whichever line breaks `text`
 * has: where it was if the text around it is unchanged there and the text
 * kept its length, otherwise the one place where its surrounding text, or
 * failing that the text on one side of it, still occurs. Undefined when that
 * is not unique, so that a guess never lands in the wrong place: text that
 * repeats can match where the point was after an edit before it moved it.
 */
export function findPoint(
  text: string,
  point: InsertionPoint,
): number | undefined {
  const found = findPlain(plain(text), point);
  return found === undefined ? undefined : fromPlain(text, found);
}

/** {@link findPoint} in `text` with `\n` breaks. */
function findPlain(text: string, point: InsertionPoint): number | undefined {
  const { offset, before, after, length } = point;
  if (
    text.length === length &&
    text.slice(offset - before.length, offset) === before &&
    text.slice(offset, offset + after.length) === after
  ) {
    return offset;
  }
  const both = only(text, before + after);
  if (both !== undefined && before + after !== "") return both + before.length;
  const left = only(text, before);
  if (left !== undefined) return left + before.length;
  return only(text, after);
}

/**
 * What an embed needs around it to go on a line of its own at the end of
 * `text`, in the line break `text` last used: one before it unless a line
 * already ends there, and one after it.
 */
export function lineAtEnd(text: string): { before: string; after: string } {
  const lineBreak = text.match(lineBreaks)?.at(-1) ?? "\n";
  const open = text !== "" && !/[\r\n]$/.test(text);
  return { before: open ? lineBreak : "", after: lineBreak };
}

/** Where a cursor at `from` ends up once `text` is typed there. */
export function positionAfter(
  from: EditorPosition,
  text: string,
): EditorPosition {
  const lines = text.split("\n");
  const last = lines.length - 1;
  return {
    line: from.line + last,
    ch: (last === 0 ? from.ch : 0) + (lines[last]?.length ?? 0),
  };
}

/**
 * Writes `text` then `rest` at `offset` in `editor`, with the cursor between
 * them, as after typing `text`. The selection gives way to it, and its text
 * stays. They go in one change because in a table cell that Live Preview is
 * editing, Obsidian passes the change to the cell's own editor a moment later,
 * with the selection it came with, and a cursor set on the note's editor after
 * it never reaches the cell.
 */
export function writeAt(
  editor: Editor,
  offset: number,
  text: string,
  rest = "",
): void {
  const from = editor.offsetToPos(offset);
  editor.transaction({
    changes: [{ from, text: text + rest }],
    selection: { from: positionAfter(from, text) },
  });
}
