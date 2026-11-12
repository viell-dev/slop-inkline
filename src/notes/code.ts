// Where a note's text is code or front matter, as Obsidian renders the note:
// there a trigger is the note's own text and lists nothing, and an embed shows
// nothing. Plain functions, so that unit tests can check them; suggest.ts and
// entries.ts use them. They read a note's lines as its editor has them now, as
// the metadata cache, which follows saves, may not have them yet.
//
// Obsidian reads blocks and code spans as CommonMark does, with GFM's tables,
// apart from a few rules, found by rendering notes in Obsidian 1.13 and 1.15,
// which these functions follow too:
//
// - A line that leaves a quote or a list item, and does not start a block that
//   ends it, carries on the paragraph or the fenced code block open in it,
//   unless the line before held nothing in it, not even its marker: a blank
//   line stops it, but a `>` alone in a quote does not. In CommonMark only a
//   paragraph goes on so.
// - A quote ends at a line that starts a heading, a thematic break, a fence,
//   or a list, or is indented as code. A list item ends at one that starts a
//   heading, a thematic break, a fence, or another item.
// - A line that starts a quote goes on in a list item whose indentation it
//   lacks, on the same terms, and belongs to it: the quote is in the item, and
//   the `>` lines after it go on in that quote. In CommonMark the quote ends
//   the item.
// - A line of spaces with a tab among them does not end a paragraph, but ends
//   a quote, or a list item that the next line does not indent into.
// - An empty list item ends a paragraph, as one with text does. In CommonMark
//   it does not.
// - A run of backticks that no run as long closes leaves only its first
//   backtick as text, and the rest of the run can still open a code span.
//   CommonMark leaves the whole run as text.
// - `===` under a paragraph is text, not a heading's underline.
// - A table starts only at a paragraph's first line.
//
// These functions do not read HTML blocks, nor HTML, autolinks, wiki links,
// comments, math, links and their addresses, emphasis, strikethrough, or
// highlights, which Obsidian reads before a code span.

/** A note's line, as its editor has it now; undefined past the note's end. */
export type LineAt = (index: number) => string | undefined;

/** A block that holds others: a quote, or a list item. */
type Container =
  | { readonly kind: "quote" }
  /** `indent` is the column its text starts at, within its own container. */
  | { readonly kind: "item"; readonly indent: number };

/** The block a line's text goes into, open as each line is read. */
type Leaf =
  | { readonly kind: "none" }
  /** `first` is its first line, which a table's header would be. */
  | { readonly kind: "paragraph"; readonly first: string; lines: number }
  | { readonly kind: "table" }
  | { readonly kind: "fence"; readonly mark: string; readonly length: number };

/**
 * What a line is, for what can be code in it:
 * - `code`, a line of a code block: a fenced one, its fences included, or
 *   an indented one;
 * - `paragraph`, the first line of a paragraph, whose code spans can run on
 *   through the lines that continue it;
 * - `continued`, a line that continues the paragraph before it;
 * - `row`, a row of a table, each of whose cells is read on its own;
 * - `line`, a line read on its own: a heading;
 * - `none`, a line with nothing in it to read: a blank line or a thematic
 *   break.
 */
type LineKind = "code" | "paragraph" | "continued" | "row" | "line" | "none";

const none: Leaf = { kind: "none" };

const headingStart = /^ {0,3}#{1,6}(?: |$)/;
const thematicBreak = /^ {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})$/;
const fenceStart = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const listMarker = /^( {0,3})([-+*]|\d{1,9}[.)])( *)(.*)$/;
/** A list item's start, of any number, empty or not. */
const itemStart = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?: |$)/;
/**
 * A list item that may end a paragraph: a bullet, or a number that is 1, as
 * CommonMark has it, so `2.` under a paragraph carries it on; but empty too,
 * as Obsidian reads it.
 */
const interruptingItem = /^ {0,3}(?:[-+*]|1[.)])(?: |$)/;
const delimiterRow = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;

/** `line` without a line feed's `\r`, and with its tabs as spaces. */
function columns(line: string): string {
  const text = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (!text.includes("\t")) return text;
  // A tab goes to the next column that is a multiple of 4, as Markdown reads
  // indentation.
  let out = "";
  for (const char of text) {
    out += char === "\t" ? " ".repeat(4 - (out.length % 4)) : char;
  }
  return out;
}

/** The number of spaces in `text` from index `from`. */
function leadingSpaces(text: string, from = 0): number {
  let count = 0;
  while (text.charCodeAt(from + count) === 32) count++;
  return count;
}

function isBlank(text: string): boolean {
  return leadingSpaces(text) === text.length;
}

/**
 * The first character of `text` after its indentation, or "" for none. Most
 * lines start with a letter, which starts no block, so a look at it saves
 * reading the line further.
 */
function firstMark(text: string): string {
  return text.charAt(leadingSpaces(text));
}

/** Whether `mark` is one of `marks`, the empty string not among them. */
function oneOf(mark: string, marks: string): boolean {
  return mark !== "" && marks.includes(mark);
}

/** Whether `text` opens a fenced code block. */
function opensFence(text: string): RegExpExecArray | null {
  const found = fenceStart.exec(text);
  // A backtick fence's info string holds no backticks.
  if (found?.[1]?.startsWith("`") && found[2]?.includes("`")) return null;
  return found;
}

/** Whether `text` closes the fenced code block `fence`. */
function closesFence(
  text: string,
  fence: { readonly mark: string; readonly length: number },
): boolean {
  if (firstMark(text) !== fence.mark) return false;
  const found = fenceStart.exec(text);
  const marks = found?.[1] ?? "";
  return (
    marks.startsWith(fence.mark) &&
    marks.length >= fence.length &&
    (found?.[2] ?? "").trim() === ""
  );
}

/** Whether `text` starts a heading, a thematic break, or a fence. */
function startsLeaf(text: string): boolean {
  if (!oneOf(firstMark(text), "#`~*-_")) return false;
  return (
    headingStart.test(text) ||
    thematicBreak.test(text) ||
    opensFence(text) !== null
  );
}

/** Whether `text`, a line that would continue a paragraph, ends it. */
function interruptsParagraph(text: string): boolean {
  const first = firstMark(text);
  if (!oneOf(first, "#*-_`~>+1")) return false;
  return (
    startsLeaf(text) ||
    (leadingSpaces(text) <= 3 && first === ">") ||
    interruptingItem.test(text)
  );
}

/**
 * Whether `text`, a line that `container` does not take in, ends it, rather
 * than carrying on what is open in it. A quote ends at a line indented as
 * code, as Obsidian reads it, and at a list item that may end a paragraph; a
 * list item ends at any other item. A quote's `>` line never comes here for a
 * list item, which takes it in.
 */
function endsContainer(text: string, container: Container): boolean {
  if (startsLeaf(text)) return true;
  return container.kind === "quote"
    ? leadingSpaces(text) >= 4 || interruptingItem.test(text)
    : itemStart.test(text);
}

/** The number of cells in a table's row. */
function cellCount(row: string): number {
  let count = 1;
  let text = row.trim();
  if (text.startsWith("|")) text = text.slice(1);
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\\") index++;
    else if (text[index] === "|" && index < text.length - 1) count++;
  }
  return count;
}

/** Whether `line` is the delimiter row of a table whose header is `header`. */
function delimits(line: string, header: string): boolean {
  return (
    line.includes("|") &&
    header.includes("|") &&
    delimiterRow.test(line) &&
    cellCount(line) === cellCount(header)
  );
}

/**
 * Reads a note's blocks a line at a time, from its start or just after its
 * front matter, as Obsidian does, and says what each line is.
 */
class Blocks {
  /** The containers open, the outermost first. */
  readonly #containers: Container[] = [];
  #leaf: Leaf = none;
  /**
   * Where the line before was blank: undefined if it held text, or else the
   * number of its containers up to the last whose marker it held, a quote's
   * `>` or an item's own, after which it held nothing. A blank line is blank
   * from 0, and a `>` alone in a quote in an item from 2.
   */
  #blankFrom: number | undefined;

  /** What `line`, the next line of the note, is. */
  read(line: string): LineKind {
    const text = columns(line);
    const before = this.#blankFrom;
    let at = 0;
    let matched = 0;
    // The containers up to the last whose marker the line holds.
    let marked = 0;
    for (const container of this.#containers) {
      // A list item takes in a line that starts a quote but lacks the
      // item's indentation, unless the line before held nothing in it.
      const next =
        continued(text, at, container) ??
        (container.kind === "item" &&
        !heldNothing(before, matched) &&
        startsQuote(text, at)
          ? at
          : undefined);
      if (next === undefined) break;
      at = next;
      matched++;
      if (container.kind === "quote") marked = matched;
    }
    let rest = text.slice(at);
    const blank = isBlank(rest);
    this.#blankFrom = blank ? marked : undefined;
    if (matched < this.#containers.length) {
      const leaving = this.#containers[matched];
      const lazy =
        !blank &&
        !heldNothing(before, matched) &&
        (this.#leaf.kind === "paragraph" || this.#leaf.kind === "fence") &&
        leaving !== undefined &&
        !endsContainer(rest, leaving);
      if (lazy && this.#leaf.kind === "fence") return "code";
      if (!lazy) {
        this.#containers.length = matched;
        this.#leaf = none;
      }
    } else if (this.#leaf.kind === "fence") {
      if (closesFence(rest, this.#leaf)) this.#leaf = none;
      return "code";
    }
    const leaf = this.#leaf;
    if (leaf.kind === "paragraph" || leaf.kind === "table") {
      // Obsidian ends a paragraph only at a line of spaces alone.
      if (blank && (leaf.kind === "table" || !line.includes("\t"))) {
        this.#leaf = none;
        return "none";
      }
      if (!interruptsParagraph(rest)) {
        if (leaf.kind === "table") return "row";
        if (leaf.lines === 1 && delimits(rest, leaf.first)) {
          this.#leaf = { kind: "table" };
          return "row";
        }
        leaf.lines++;
        return "continued";
      }
    }
    // The line starts blocks of its own, in the containers it is in.
    for (;;) {
      const indent = leadingSpaces(rest);
      const mark = rest.charAt(indent);
      if (indent > 3 || !oneOf(mark, ">-+*0123456789")) break;
      if (mark === ">") {
        this.#containers.push({ kind: "quote" });
        marked = this.#containers.length;
        rest = rest.slice(indent + 1);
        if (rest.startsWith(" ")) rest = rest.slice(1);
        continue;
      }
      if (thematicBreak.test(rest)) break;
      const item = listMarker.exec(rest);
      const marker = item?.[2] ?? "";
      const spaces = item?.[3] ?? "";
      const content = item?.[4] ?? "";
      if (item === null || (spaces === "" && content !== "")) break;
      // Its text starts after the marker and the spaces after it, or a
      // space after the marker where they would make indented code.
      const width = content === "" || spaces.length > 4 ? 1 : spaces.length;
      this.#containers.push({
        kind: "item",
        indent: indent + marker.length + width,
      });
      marked = this.#containers.length;
      rest = rest.slice(indent + marker.length + width);
    }
    const indent = leadingSpaces(rest);
    // The blocks the line starts can leave nothing after their markers, as a
    // `>` or a `-` alone does: then the line is blank after all, in them.
    const empty = indent === rest.length;
    this.#blankFrom = empty ? marked : undefined;
    this.#leaf = none;
    if (empty) return "none";
    // An indented code block's line.
    if (indent >= 4) return "code";
    const mark = rest.charAt(indent);
    const fence = oneOf(mark, "`~") ? opensFence(rest) : null;
    if (fence !== null) {
      const marks = fence[1] ?? "";
      this.#leaf = {
        kind: "fence",
        mark: marks.charAt(0),
        length: marks.length,
      };
      return "code";
    }
    if (mark === "#" && headingStart.test(rest)) return "line";
    if (oneOf(mark, "*-_") && thematicBreak.test(rest)) return "none";
    this.#leaf = { kind: "paragraph", first: rest, lines: 1 };
    return "paragraph";
  }
}

/**
 * Whether a line, blank from `blankFrom` on as {@link Blocks} records it, held
 * nothing in the container open at `depth`: not its marker, nor anything in
 * it. A line that lacks that container's marker or indentation goes on in it
 * only after a line that held something there.
 */
function heldNothing(blankFrom: number | undefined, depth: number): boolean {
  return blankFrom !== undefined && blankFrom <= depth;
}

/** Whether `text`, from column `at`, starts a quote. */
function startsQuote(text: string, at: number): boolean {
  const indent = leadingSpaces(text, at);
  return indent <= 3 && text[at + indent] === ">";
}

/**
 * Where `container` takes in `text` from column `at`: the column after its
 * marker or indentation, or undefined if `text` does not continue it.
 */
function continued(
  text: string,
  at: number,
  container: Container,
): number | undefined {
  const indent = leadingSpaces(text, at);
  if (container.kind === "quote") {
    if (indent > 3 || text[at + indent] !== ">") return undefined;
    const after = at + indent + 1;
    return text[after] === " " ? after + 1 : after;
  }
  if (at + indent === text.length) return at;
  return indent >= container.indent ? at + container.indent : undefined;
}

/**
 * The first line after a note's front matter: 0 for a note with none, or
 * undefined when line `line` lies in it.
 */
function afterFrontMatter(lineAt: LineAt, line: number): number | undefined {
  const isFence = (text: string | undefined) => text?.trimEnd() === "---";
  if (!isFence(lineAt(0))) return 0;
  let end = 1;
  let text = lineAt(end);
  while (text !== undefined && !isFence(text)) text = lineAt(++end);
  // Front matter that never closes is text, as Obsidian reads it.
  if (text === undefined) return 0;
  return line <= end ? undefined : end + 1;
}

/**
 * Whether line `line` of a note lies in its front matter or in a code block,
 * fenced or indented, a fence's own lines and the info string after an
 * opening fence included, as {@link insideCode} finds them. Only the lines up
 * to `line` are read, and the front matter's.
 */
export function insideCodeBlock(lineAt: LineAt, line: number): boolean {
  const from = afterFrontMatter(lineAt, line);
  if (from === undefined) return true;
  const blocks = new Blocks();
  let kind: LineKind = "none";
  for (let index = from; index <= line; index++) {
    kind = blocks.read(lineAt(index) ?? "");
  }
  return kind === "code";
}

/**
 * Whether column `ch` of line `line` of a note lies in code, as Obsidian
 * renders it: in front matter, a code block, or a code span, which can
 * run across the lines of a paragraph but not past it, and not across a
 * table's cells. The lines up to `line` are read, and those after it only as
 * far as its paragraph goes, and only while a code span open before `ch`
 * has not closed.
 */
export function insideCode(lineAt: LineAt, line: number, ch: number): boolean {
  const from = afterFrontMatter(lineAt, line);
  if (from === undefined) return true;
  const blocks = new Blocks();
  // The lines of the paragraph that holds the line, up to it.
  let paragraph: string[] = [];
  let kind: LineKind = "none";
  let text = "";
  for (let index = from; index <= line; index++) {
    text = lineAt(index) ?? "";
    kind = blocks.read(text);
    if (kind === "paragraph") paragraph = [text];
    else if (kind === "continued") paragraph.push(text);
  }
  if (kind === "code") return true;
  if (kind === "none") return false;
  if (kind === "line") return insideCodeSpan(text, ch) === true;
  if (kind === "row") return insideCell(text, ch);
  let index = line + 1;
  let next = lineAt(index);
  let after: LineKind = next === undefined ? "none" : blocks.read(next);
  // A paragraph's first line is a table's header when the next line is its
  // delimiter row.
  if (kind === "paragraph" && after === "row") return insideCell(text, ch);
  let joined = paragraph.join("\n");
  const at = joined.length - text.length + ch;
  const found = insideCodeSpan(joined, at, after !== "continued");
  if (found !== undefined) return found;
  // A code span opened before `ch` may close in the rest of the paragraph.
  while (after === "continued" && next !== undefined) {
    joined += `\n${next}`;
    index++;
    next = lineAt(index);
    after = next === undefined ? "none" : blocks.read(next);
  }
  return insideCodeSpan(joined, at) === true;
}

/** Whether column `ch` of a table's row `row` is in a code span in its cell. */
function insideCell(row: string, ch: number): boolean {
  let start = 0;
  let end = row.length;
  for (let index = 0; index < row.length; index++) {
    if (row[index] === "\\") {
      index++;
    } else if (row[index] === "|") {
      if (index < ch) {
        start = index + 1;
      } else {
        end = index;
        break;
      }
    }
  }
  return insideCodeSpan(row.slice(start, end), ch - start) === true;
}

/**
 * Where the first run of exactly `length` backticks at or after `from` in
 * `text` starts, or undefined if there is none: a longer run does not close a
 * shorter one.
 */
function nextRun(
  text: string,
  from: number,
  length: number,
): number | undefined {
  const fence = "`".repeat(length);
  let search = from;
  for (;;) {
    const close = text.indexOf(fence, search);
    if (close === -1) return undefined;
    let run = 0;
    while (text[close + run] === "`") run++;
    if (run === length) return close;
    search = close + run;
  }
}

/** Where each run of backticks in `text` starts, by its length, in order. */
function backtickRuns(text: string): Map<number, number[]> {
  const runs = new Map<number, number[]>();
  let at = text.indexOf("`");
  while (at !== -1) {
    let length = 0;
    while (text[at + length] === "`") length++;
    const starts = runs.get(length);
    if (starts === undefined) runs.set(length, [at]);
    else starts.push(at);
    at = text.indexOf("`", at + length);
  }
  return runs;
}

/**
 * {@link nextRun} by the `runs` of a text, found by halving: once a run has
 * found none to close it, each of its backticks after the first looks again,
 * and so may every run after it, which would read the text to its end each
 * time.
 */
function runAfter(
  runs: ReadonlyMap<number, readonly number[]>,
  from: number,
  length: number,
): number | undefined {
  const starts = runs.get(length) ?? [];
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((starts[middle] ?? Infinity) < from) low = middle + 1;
    else high = middle;
  }
  return starts[low];
}

/**
 * Whether index `at` of `text`, the text of a paragraph, lies inside a code
 * span: between a run of backticks and the next run of the same length. A
 * run that none closes leaves its first backtick as text, as Obsidian reads
 * it, and the rest of the run may still open a span. An escaped backtick
 * opens none. When `text` may go on, as a paragraph read only so far does,
 * undefined says that a span opened before `at` may close later.
 */
export function insideCodeSpan(
  text: string,
  at: number,
  complete = true,
): boolean | undefined {
  // The text's runs, found once a run has found none to close it.
  let runs: Map<number, number[]> | undefined;
  // The length of the run at `index`, once counted. A run that gives up its
  // first backtick keeps the rest of its count, so that a long run is not
  // counted again for each backtick it gives up.
  let run = 0;
  let index = 0;
  while (index < at) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char !== "`") {
      index++;
      continue;
    }
    if (run === 0) while (text[index + run] === "`") run++;
    const close =
      runs === undefined
        ? nextRun(text, index + run, run)
        : runAfter(runs, index + run, run);
    if (close === undefined) {
      if (!complete) return undefined;
      runs ??= backtickRuns(text);
      index++;
      run--;
      continue;
    }
    if (at > index && at <= close) return true;
    index = close + run;
    run = 0;
  }
  return false;
}
