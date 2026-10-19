// Where a new symbol's embed goes when it is saved: the cursor position taken
// when the editor opened, found again from the text around it, since the note
// can change while the editor is open.

/** How much text on each side of the position identifies it. */
const contextLength = 64;

export interface InsertionPoint {
  readonly offset: number;
  readonly before: string;
  readonly after: string;
}

/** Records a position in `text` with the text around it. */
export function capturePoint(text: string, offset: number): InsertionPoint {
  return {
    offset,
    before: text.slice(Math.max(0, offset - contextLength), offset),
    after: text.slice(offset, offset + contextLength),
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
 * The offset in `text` where the point now is: where it was if the text
 * around it is unchanged, otherwise the one place where its surrounding text,
 * or failing that the text on one side of it, still occurs. Undefined when
 * that is not unique, so that a guess never lands in the wrong place.
 */
export function findPoint(
  text: string,
  point: InsertionPoint,
): number | undefined {
  const { offset, before, after } = point;
  if (
    offset <= text.length &&
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
