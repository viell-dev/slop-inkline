// Where a note's text is code or front matter, as Obsidian renders the note:
// there a trigger is the note's own text and lists nothing, and an embed shows
// nothing. Plain functions, so that unit tests can check them; suggest.ts and
// entries.ts use them. They read a note's lines as its editor has them now, as
// the metadata cache, which follows saves, may not have them yet.
//
// Obsidian reads a quote's lines and a list item's lines first, and then what
// they hold as a note of its own. These functions follow its rules, found by
// rendering notes in Obsidian 1.13 and 1.15, where they differ from
// CommonMark's:
//
// - A line goes on in a quote when it holds a `>` after any spaces and tabs;
//   the `>` and one space after it are the quote's marker, and a tab after it
//   is the text's indentation. A line without `>` goes on in the quote after
//   any block in it, unless it is blank or starts a block that ends the quote:
//   one indented as code, a fence, a heading, a heading's text over its
//   underline, a thematic break, a `%%` or `$$` block, HTML that may end a
//   paragraph, or a list item that may.
// - A list item's text starts after its marker and one to four spaces, one
//   space where more follow, or a tab, or right after the marker in an empty
//   item, and after a task's `[ ]`, of any character, and a space or tab. A
//   line goes on in the item when it is blank, or indented at least as far, or
//   more than four columns, counting a tab to the next multiple of four from
//   where the item's container's text starts, and a start that looks like a
//   marker, but is not one, as indentation too. The line loses that many
//   columns, a tab that reaches past them taken whole. A line with a marker
//   indented less ends the item: one of the same bullet or `.` or `)` starts
//   the list's next item, however it is indented. Any other line without the
//   indentation goes on in the item after any block, unless the line before
//   was blank or it starts a heading, a fence, a thematic break, or a `%%` or
//   `$$` block; when it is indented by fewer columns, the item's lines lose no
//   more than those.
// - Indented code is a line of a block's text that starts with four spaces or a
//   tab: spaces before a tab do not make it, as they do in CommonMark.
// - A paragraph goes on through a line indented four spaces or with a tab in its
//   indentation, blank or not. Other lines of spaces end it, and so do the
//   starts of a thematic break, a heading, a fence, a quote, a `%%` or `$$`
//   block, HTML of CommonMark's first six kinds, and a list item that is a
//   bullet or 1, empty or not.
// - A fence opens after any spaces and tabs that are not code's indentation,
//   and closes after up to three spaces.
// - A paragraph's first line over a line of `=` or `-` alone is a heading;
//   `===` under a later line is text.
// - HTML blocks are CommonMark's, but those that end at a blank line end only
//   at an empty one.
// - `%%` at a block's start, with no other `%` on its line, opens a comment to
//   the next `%%`, and the rest of that line starts a block; `$$` opens math to
//   a line that ends in as many `$`.
// - A link reference definition, `[label]: address "title"`, is read on its
//   own, with its address or its title on the next line.
// - A line that starts a quote is a callout's title line when its text after
//   the `>` and a space starts with `[!`, a type of anything but `]`, `]`,
//   then `+`, `-`, or neither, then white space or the line's end. Obsidian
//   reads the rest of the line, the title, as a note of one line, and the
//   callout's content from the next line.
// - A table starts at a paragraph's first line, when it and the next line hold
//   a `|` after their first character, start with one alike, and the next
//   line is of cells of `-` and `:`, any number of them. Its rows go on while
//   they hold such a `|` and start like its first line.
//
// src/notes/inline.ts reads a paragraph's text for code spans as Obsidian
// does. These functions do not follow a few rare rules of Obsidian's: a
// definition whose label or title runs on to another line, or whose address
// comes after a blank line; an HTML block's first line over an underline,
// which is a heading; a footnote's text, which Obsidian reads as blocks; a
// line indented less than an item's text, read after a line of the item it
// would change; and the extra column Obsidian takes from the text of an item
// numbered 1 to 9 when its marker is an odd number of columns wide.

import { closeTag, insideInlineCode, openTag } from "./inline.ts";

/** A note's line, as its editor has it now; undefined past the note's end. */
export type LineAt = (index: number) => string | undefined;

/** A block that holds others: a quote, or a list item. */
type Container =
  | { readonly kind: "quote" }
  | {
      readonly kind: "item";
      /** The bullet, or a number's `.` or `)`. */
      readonly marker: string;
      /** The columns of indentation a line needs to go on in the item. */
      readonly indent: number;
      /** The columns a line in it loses: `indent`, or fewer after a line indented less. */
      dedent: number;
    };

/** The block a line's text goes into, open as each line is read. */
type Leaf =
  | { readonly kind: "none" }
  /** `first` is its first line, which a table's header would be. */
  | { readonly kind: "paragraph"; readonly first: string; lines: number }
  /** `header` is its first line, whose `|` its lines follow. */
  | { readonly kind: "table"; readonly header: string }
  | { readonly kind: "fence"; readonly mark: string; readonly length: number }
  /** An HTML block, which ends at a line that `end` matches, or an empty one. */
  | { readonly kind: "html"; readonly end: HtmlEnd | undefined }
  /** A `%%` comment block. */
  | { readonly kind: "comment" }
  /** A `$$` math block, opened by `length` of them. */
  | { readonly kind: "math"; readonly length: number }
  /** A callout's title line, before the callout's content starts. */
  | { readonly kind: "title" }
  /**
   * A link reference definition, which a title may follow on the next line,
   * or its address, where `address` says it has none yet.
   */
  | {
      readonly kind: "definition";
      readonly first: string;
      readonly address: boolean;
    };

/**
 * What a line is, for what can be code in it:
 * - `code`, a line of a code block: a fenced one, its fences included, or
 *   an indented one;
 * - `paragraph`, the first line of a paragraph, whose code spans can run on
 *   through the lines that continue it;
 * - `continued`, a line that continues the paragraph before it;
 * - `row`, a row of a table, each of whose cells is read on its own;
 * - `line`, a line read on its own: a heading;
 * - `title`, a callout's title line, whose title is read as a note of one
 *   line, as {@link calloutTitle} gives it;
 * - `underline`, a line that makes the paragraph line before it a heading;
 * - `none`, a line with no text to read: a blank line, a thematic break, or
 *   a line of HTML, a comment, math, or a definition's title.
 */
type LineKind =
  | "code"
  | "paragraph"
  | "continued"
  | "row"
  | "line"
  | "title"
  | "underline"
  | "none";

const none: Leaf = { kind: "none" };

const thematicBreak = /^[ \t]*(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})$/;
const headingStart = /^[ \t]*#{1,6}(?:[ \t]|$)/;
const fenceStart = /^[ \t]*(`{3,}|~{3,})(.*)$/;
/** A callout's type, which starts the text of its title line. */
const calloutType = /^\[![^\]]+\][+-]?(?:\s|$)/;
/** A setext heading's underline. */
const underline = /^(?:=+|-+)$/;
// A link reference definition: its label, its address, and its title.
const label = String.raw`[ \t]*\[(?!\^)(?:\\.|[^\]\\])+\]:[ \t]*`;
const address = String.raw`(?:<[^>[\]]+>|[^\s[\]<][^\s[\]]*)`;
const title = String.raw`(?:"[^"]*"|'[^']*'|\([^)]*\))`;
/** A definition on one line, or its label alone, where `address` is empty. */
const definition = new RegExp(
  String.raw`^${label}(?:(?<address>${address})(?:[ \t]+${title})?)?[ \t]*$`,
);
/** A definition's address on the line after its label, and a title. */
const definitionAddress = new RegExp(
  String.raw`^[ \t]*${address}(?:[ \t]+${title})?[ \t]*$`,
);
/** A definition's title on the line after it. */
const definitionTitle = new RegExp(String.raw`^[ \t]*${title}[ \t]*$`);

/** The tags of CommonMark's sixth kind of HTML block. */
const blockTags =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hgroup|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|pre|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";

/** Whether a line of an HTML block ends it. */
type HtmlEnd = (line: string) => boolean;

/**
 * The kinds of HTML block: what starts one, from its `<`, what ends one, which
 * an empty line ends where it is undefined, and whether one may end a
 * paragraph. These say where a Markdown reader, Obsidian's, ends a block of
 * HTML, not what a browser would read as HTML: a comment ends at `-->` alone,
 * as Obsidian has it.
 */
const htmlBlocks: readonly {
  readonly start: RegExp;
  readonly end: HtmlEnd | undefined;
  readonly interrupts: boolean;
}[] = [
  {
    start: /^<(?:script|pre|style)(?=\s|>|$)/i,
    end: (line) => /<\/(?:script|pre|style)>/i.test(line),
    interrupts: true,
  },
  { start: /^<!--/, end: (line) => line.includes("-->"), interrupts: true },
  { start: /^<\?/, end: (line) => line.includes("?>"), interrupts: true },
  { start: /^<![A-Za-z]/, end: (line) => line.includes(">"), interrupts: true },
  {
    start: /^<!\[CDATA\[/,
    end: (line) => line.includes("]]>"),
    interrupts: true,
  },
  {
    start: new RegExp(`^</?(?:${blockTags})(?=\\s|/?>|$)`, "i"),
    end: undefined,
    interrupts: true,
  },
  {
    start: new RegExp(`^(?:${openTag}|${closeTag})\\s*$`),
    end: undefined,
    interrupts: false,
  },
];

/** `line` without a line feed's `\r`. */
function withoutReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** The index in `text` after the spaces and tabs from `from`. */
function skipBlank(text: string, from: number): number {
  let index = from;
  while (text[index] === " " || text[index] === "\t") index++;
  return index;
}

/**
 * The columns of `text` from `from` to `to`, its spaces and tabs, a tab going
 * on to the next multiple of 4 counted from `from`.
 */
function columnsOf(text: string, from: number, to: number): number {
  let columns = 0;
  for (let index = from; index < to; index++) {
    columns = text[index] === "\t" ? columns + 4 - (columns % 4) : columns + 1;
  }
  return columns;
}

/**
 * Whether the spaces and tabs of `text` from `from` reach `columns` columns,
 * counted as {@link columnsOf} counts them, reading no further.
 */
function reaches(text: string, from: number, columns: number): boolean {
  let count = 0;
  for (let index = from; count < columns; index++) {
    const char = text[index];
    if (char === " ") count++;
    else if (char === "\t") count += 4 - (count % 4);
    else return false;
  }
  return true;
}

/**
 * The index in `text` after `columns` columns of its indentation from `from`,
 * a tab that reaches past them taken whole.
 */
function strip(text: string, from: number, columns: number): number {
  let index = from;
  let count = 0;
  while (count < columns && (text[index] === " " || text[index] === "\t")) {
    count = text[index] === "\t" ? count + 4 - (count % 4) : count + 1;
    index++;
  }
  return index;
}

/** Whether `text` from `from` is white space alone, as Obsidian trims it. */
function isWhite(text: string, from: number): boolean {
  const lead = skipBlank(text, from);
  if (lead === text.length) return true;
  // Most lines go on with a character that is plainly not a space.
  const code = text.charCodeAt(lead);
  if (code > 32 && code < 127) return false;
  return /^\s*$/.test(text.slice(lead));
}

/** Whether `text` from `from` is indented as code, with text after. */
function indentedAsCode(text: string, from: number): boolean {
  return (
    (text.startsWith("    ", from) || text[from] === "\t") &&
    skipBlank(text, from) < text.length
  );
}

/**
 * Whether a line from `from` goes on in a paragraph whatever it starts:
 * indented four spaces before more text, or with a tab in its indentation.
 */
function indentedLine(text: string, from: number): boolean {
  let index = from;
  while (text[index] === " ") index++;
  return text[index] === "\t" || (index - from >= 4 && index < text.length);
}

/** The first character of `text` from `from` after its spaces and tabs. */
function firstMark(text: string, from: number): string {
  return text.charAt(skipBlank(text, from));
}

/** Whether `mark` is one of `marks`, the empty string not among them. */
function oneOf(mark: string, marks: string): boolean {
  return mark !== "" && marks.includes(mark);
}

/** Where a quote's marker in `text` from `from` ends, if the text holds one. */
function quoteMarker(text: string, from: number): number | undefined {
  const at = skipBlank(text, from);
  if (text[at] !== ">") return undefined;
  return text[at + 1] === " " ? at + 2 : at + 1;
}

/** The start of a list item, as {@link itemStart} finds it. */
interface ItemStart {
  /** The bullet, or a number's `.` or `)`. */
  readonly marker: string;
  /** Whether it may end a paragraph: a bullet, or the number 1. */
  readonly interrupts: boolean;
  /** The columns from the line's start, within its container, to its text. */
  readonly indent: number;
  /** Where its text starts in the line. */
  readonly text: number;
}

/** The list item that `text` from `from` starts, if it starts one. */
function itemStart(text: string, from: number): ItemStart | undefined {
  const lead = skipBlank(text, from);
  let index = lead;
  const char = text[index] ?? "";
  let marker: string;
  let interrupts = true;
  if (char === "*" || char === "+" || char === "-") {
    marker = char;
    index++;
  } else {
    while (oneOf(text[index] ?? "", "0123456789")) index++;
    const delimiter = text[index] ?? "";
    if (index === lead || (delimiter !== "." && delimiter !== ")")) {
      return undefined;
    }
    interrupts = text.slice(lead, index) === "1";
    marker = delimiter;
    index++;
  }
  const next = text[index] ?? "";
  if (next !== " " && next !== "\t" && next !== "") return undefined;
  let indent = columnsOf(text, from, lead) + index - lead;
  if (next === "\t") {
    indent += 4 - (indent % 4);
    index++;
  } else if (next === " ") {
    let spaces = 0;
    while (spaces < 4 && text[index + spaces] === " ") spaces++;
    // Five spaces or more leave four of them to the text, as code.
    if (spaces === 4 && text[index + 4] === " ") spaces = 1;
    indent += spaces;
    index += spaces;
  }
  return { marker, interrupts, indent, text: index };
}

/**
 * The columns that the start of `text` from `lead` takes where it starts as a
 * list item's marker would, a bullet or a number and its `.` or `)`, without
 * being one: Obsidian counts them toward a line's indentation in an item.
 */
function markerWidth(text: string, lead: number): number {
  if (oneOf(text[lead] ?? "", "*+-")) return 1;
  let index = lead;
  while (oneOf(text[index] ?? "", "0123456789")) index++;
  return index > lead && oneOf(text[index] ?? "", ".)") ? index - lead + 1 : 0;
}

/** Where an item's text starts in `text`, after a task's `[ ]` at `from`. */
function taskEnd(text: string, from: number): number {
  return /^\[.\][ \t]/.test(text.slice(from, from + 4)) ? from + 4 : from;
}

/** Whether `text` from `from` opens a fenced code block, and how. */
function opensFence(
  text: string,
  from: number,
): { readonly mark: string; readonly length: number } | undefined {
  const found = fenceStart.exec(text.slice(from));
  const marks = found?.[1] ?? "";
  if (marks === "") return undefined;
  // A backtick fence's info string holds no backticks.
  if (marks.startsWith("`") && found?.[2]?.includes("`") === true) {
    return undefined;
  }
  return { mark: marks.charAt(0), length: marks.length };
}

/** Whether `text` from `from` closes the fenced code block `fence`. */
function closesFence(
  text: string,
  from: number,
  fence: { readonly mark: string; readonly length: number },
): boolean {
  let index = from;
  while (text[index] === " " && index - from < 4) index++;
  if (index - from >= 4 || text[index] !== fence.mark) return false;
  let length = 0;
  while (text[index] === fence.mark) {
    index++;
    length++;
  }
  return length >= fence.length && skipBlank(text, index) === text.length;
}

/** Whether `text` from `from` opens a `%%` comment block. */
function opensComment(text: string, from: number): boolean {
  let index = from;
  while (text[index] === " ") index++;
  return text.startsWith("%%", index) && !text.includes("%", index + 2);
}

/**
 * How many `$` open a `$$` math block in `text` from `from`, or 0 if it opens
 * none. Math needs a line after its first, which `more` says there is.
 */
function opensMath(text: string, from: number, more: () => boolean): number {
  let index = from;
  while (text[index] === " ") index++;
  const start = index;
  while (text[index] === "$") index++;
  const length = index - start;
  if (length < 2 || text.includes("$", index) || !more()) return 0;
  return length;
}

/** Whether `text` from `from` closes a math block opened by `length` `$`. */
function closesMath(text: string, from: number, length: number): boolean {
  let end = text.length;
  while (end > from && text[end - 1] === " ") end--;
  let run = end;
  while (run > from && text[run - 1] === "$") run--;
  return end - run >= length && text.indexOf("$", from) === run;
}

/** The kind of HTML block that `text` from `from` starts, if any. */
function opensHtml(
  text: string,
  from: number,
): (typeof htmlBlocks)[number] | undefined {
  const lead = skipBlank(text, from);
  if (text[lead] !== "<") return undefined;
  const line = text.slice(lead);
  return htmlBlocks.find(({ start }) => start.test(line));
}

/** Whether `text` from `from` starts a heading. */
function opensHeading(text: string, from: number): boolean {
  return headingStart.test(text.slice(from));
}

function isThematicBreak(text: string, from: number): boolean {
  return thematicBreak.test(text.slice(from));
}

/**
 * Whether `text` from `from`, a line that would continue a paragraph, ends
 * it. `more` says whether a line follows.
 */
function interruptsParagraph(
  text: string,
  from: number,
  more: () => boolean,
): boolean {
  const first = firstMark(text, from);
  if (!oneOf(first, "*-_+1#`~%$><")) return false;
  return (
    (oneOf(first, "*-_") && isThematicBreak(text, from)) ||
    itemStart(text, from)?.interrupts === true ||
    (first === "#" && opensHeading(text, from)) ||
    (oneOf(first, "`~") && opensFence(text, from) !== undefined) ||
    (first === "%" && opensComment(text, from)) ||
    (first === "$" && opensMath(text, from, more) > 0) ||
    first === ">" ||
    (first === "<" && opensHtml(text, from)?.interrupts === true)
  );
}

/**
 * Whether `text` from `from`, a line without a quote's `>`, ends the quote
 * rather than going on in it. It is not blank.
 */
function endsQuote(text: string, from: number, more: () => boolean): boolean {
  if (indentedAsCode(text, from)) return true;
  const first = firstMark(text, from);
  if (!oneOf(first, "*-_+1#`~%$<")) return false;
  return (
    (oneOf(first, "`~") && opensFence(text, from) !== undefined) ||
    (first === "%" && opensComment(text, from)) ||
    (first === "$" && opensMath(text, from, more) > 0) ||
    (first === "#" && opensHeading(text, from)) ||
    (oneOf(first, "*-_") && isThematicBreak(text, from)) ||
    (first === "<" && opensHtml(text, from)?.interrupts === true) ||
    itemStart(text, from)?.interrupts === true
  );
}

/**
 * Whether `text` from `from`, a line without a list item's indentation that
 * starts no item, ends the item rather than going on in it.
 */
function endsItem(text: string, from: number, more: () => boolean): boolean {
  const first = firstMark(text, from);
  if (!oneOf(first, "*-_#`~%$")) return false;
  return (
    (first === "#" && opensHeading(text, from)) ||
    (oneOf(first, "`~") && opensFence(text, from) !== undefined) ||
    (first === "%" && opensComment(text, from)) ||
    (first === "$" && opensMath(text, from, more) > 0) ||
    (oneOf(first, "*-_") && isThematicBreak(text, from))
  );
}

/**
 * Whether `line` can be a table's line after `header`: it holds a `|` after
 * its first character, and starts with one only if the header does.
 */
function goesOnInTable(line: string, header: string): boolean {
  return (
    line.includes("|", 1) && line.startsWith("|") === header.startsWith("|")
  );
}

/** Whether `line` is the delimiter row of a table whose header is `header`. */
function delimits(line: string, header: string): boolean {
  if (!header.includes("|", 1) || !goesOnInTable(line, header)) return false;
  // Cells of `-` and `:` between pipes, none of them empty.
  let cell = false;
  let filled = false;
  let cells = 0;
  for (const char of line) {
    if (char === "|") {
      if (filled) cells++;
      else if (cell) return false;
      cell = true;
      filled = false;
    } else if (char === "-" || char === ":") filled = true;
    else if (!/\s/.test(char)) return false;
  }
  return cells + (filled ? 1 : 0) > 0;
}

/**
 * Whether a line, blank from `blankFrom` on as {@link Blocks} records it, held
 * nothing in the container open at `depth`: not its marker, nor anything in
 * it. A line without a list item's indentation goes on in it only after a
 * line that held something there.
 */
function heldNothing(blankFrom: number | undefined, depth: number): boolean {
  return blankFrom !== undefined && blankFrom <= depth;
}

/**
 * Reads a note's blocks a line at a time, from its start or just after its
 * front matter, as Obsidian does, and says what each line is.
 */
class Blocks {
  readonly #lineAt: LineAt;
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
  /** The line after the last one read, once looked at. */
  #fetched:
    { readonly index: number; readonly line: string | undefined } | undefined;
  /** The last line read, without its `\r`. */
  text = "";
  /** Where the text of the last line read starts, after its containers' markers. */
  start = 0;

  /** The text of the last line read, after its containers' markers. */
  get content(): string {
    return this.start === 0 ? this.text : this.text.slice(this.start);
  }

  /** The index of the line being read. */
  #index = 0;
  /** Whether a line follows the one being read. */
  readonly #more = (): boolean => this.has(this.#index + 1);

  constructor(lineAt: LineAt) {
    this.#lineAt = lineAt;
  }

  /** Line `index` of the note, read once however often it is asked for. */
  #line(index: number): string | undefined {
    if (this.#fetched?.index === index) return this.#fetched.line;
    const line = this.#lineAt(index);
    this.#fetched = { index, line };
    return line;
  }

  /** Whether the note has line `index`. */
  has(index: number): boolean {
    return this.#line(index) !== undefined;
  }

  /**
   * The text of line `index`, looked at before it is read, within the
   * containers open up to `depth`, as far as they take it in.
   */
  #lookAhead(index: number, depth: number): string | undefined {
    const line = this.#line(index);
    if (line === undefined) return undefined;
    const text = withoutReturn(line);
    let at = 0;
    for (const container of this.#containers.slice(0, depth)) {
      if (container.kind === "quote") {
        at = quoteMarker(text, at) ?? at;
      } else if (columnsOf(text, at, skipBlank(text, at)) >= container.indent) {
        at = strip(text, at, container.dedent);
      }
    }
    return text.slice(at);
  }

  /** What line `index`, the next line of the note, is. */
  read(index: number): LineKind {
    const text = withoutReturn(this.#line(index) ?? "");
    this.text = text;
    this.#index = index;
    const more = this.#more;
    const before = this.#blankFrom;
    const containers = this.#containers;
    let at = 0;
    // The containers up to the last whose marker the line holds.
    let marked = 0;
    let ends = containers.length;
    for (let depth = 0; depth < containers.length; depth++) {
      const container = containers[depth];
      if (container === undefined) break;
      if (container.kind === "quote") {
        const next = quoteMarker(text, at);
        if (next !== undefined) {
          at = next;
          marked = depth + 1;
        } else if (
          isWhite(text, at) ||
          endsQuote(text, at, more) ||
          // A heading's text over its underline.
          underline.test(this.#lookAhead(index + 1, depth) ?? "")
        ) {
          ends = depth;
          break;
        }
        // Without its `>`, the line goes on in the quote as it is.
        continue;
      }
      if (reaches(text, at, container.indent)) {
        at = strip(text, at, container.dedent);
        continue;
      }
      const lead = skipBlank(text, at);
      if (isWhite(text, lead)) {
        at = text.length;
        continue;
      }
      const columns = columnsOf(text, at, lead);
      const item = oneOf(text[lead] ?? "", "*+-0123456789")
        ? itemStart(text, at)
        : undefined;
      // A line that starts as a marker would, without being one, counts the
      // start as indentation.
      const reach =
        item === undefined ? columns + markerWidth(text, lead) : columns;
      if (item !== undefined) {
        if (item.marker === container.marker && !isThematicBreak(text, at)) {
          // The next item of the same list, however its marker is indented.
          containers.length = depth;
          containers.push({
            kind: "item",
            marker: item.marker,
            indent: item.indent,
            dedent: item.indent,
          });
          this.#blankFrom = undefined;
          this.#leaf = none;
          return this.#open(
            text,
            taskEnd(text, item.text),
            containers.length,
            more,
          );
        }
        ends = depth;
        break;
      }
      if (
        reach < container.indent &&
        reach <= 4 &&
        (heldNothing(before, depth) || endsItem(text, at, more))
      ) {
        ends = depth;
        break;
      }
      // The line goes on in the item, without its indentation. One
      // indented less than the item's text makes its lines lose less.
      if (columns > 0) container.dedent = Math.min(container.dedent, columns);
      at = strip(text, at, Math.min(container.dedent, columns));
    }
    this.#blankFrom = isWhite(text, at) ? marked : undefined;
    this.start = at;
    if (ends < containers.length) {
      containers.length = ends;
      this.#leaf = none;
      return this.#open(text, at, marked, more);
    }
    return this.#goOn(text, at, marked, more);
  }

  /** What a line that goes on in all its containers is, from `at`. */
  #goOn(
    text: string,
    at: number,
    marked: number,
    more: () => boolean,
  ): LineKind {
    const leaf = this.#leaf;
    switch (leaf.kind) {
      case "none":
      case "title":
        // A callout's content starts on the line after its title.
        this.#leaf = none;
        return this.#open(text, at, marked, more);
      case "fence":
        if (closesFence(text, at, leaf)) this.#leaf = none;
        return "code";
      case "html":
        if (
          leaf.end === undefined ? at === text.length : leaf.end(text.slice(at))
        ) {
          this.#leaf = none;
        }
        return "none";
      case "math":
        if (closesMath(text, at, leaf.length)) this.#leaf = none;
        return "none";
      case "comment": {
        const close = text.indexOf("%%", at);
        if (close === -1) return "none";
        // What follows the comment on its line starts a block.
        this.#leaf = none;
        this.start = close + 2;
        return this.#open(text, close + 2, marked, more);
      }
      case "definition": {
        const rest = text.slice(at);
        if (underline.test(rest)) {
          this.#leaf = none;
          return "underline";
        }
        // Its address on the line after its label, or its title after it.
        if (
          leaf.address
            ? definitionAddress.test(rest)
            : definitionTitle.test(rest)
        ) {
          this.#leaf = leaf.address
            ? { kind: "definition", first: leaf.first, address: false }
            : none;
          return "none";
        }
        if (!leaf.address && !oneOf(firstMark(text, at), "\"'(")) {
          this.#leaf = none;
          return this.#open(text, at, marked, more);
        }
        // A definition with no address, or a title that does not close on
        // its line, is a paragraph, or one that this does not read.
        this.#leaf = { kind: "paragraph", first: leaf.first, lines: 1 };
        return this.#goOn(text, at, marked, more);
      }
      case "table":
        if (goesOnInTable(text.slice(at), leaf.header)) return "row";
        this.#leaf = none;
        return this.#open(text, at, marked, more);
      case "paragraph": {
        if (at === text.length) {
          this.#leaf = none;
          return "none";
        }
        // Obsidian tries a heading's underline and a table's delimiter row
        // at the paragraph's first line, before the paragraph.
        if (leaf.lines === 1) {
          const rest = text.slice(at);
          if (underline.test(rest)) {
            this.#leaf = none;
            return "underline";
          }
          if (delimits(rest, leaf.first)) {
            this.#leaf = { kind: "table", header: leaf.first };
            return "row";
          }
        }
        if (indentedLine(text, at)) {
          leaf.lines++;
          return "continued";
        }
        if (interruptsParagraph(text, at, more)) {
          this.#leaf = none;
          return this.#open(text, at, marked, more);
        }
        if (isWhite(text, at)) {
          this.#leaf = none;
          return "none";
        }
        leaf.lines++;
        return "continued";
      }
    }
  }

  /** What a line is that starts blocks of its own from `from`. */
  #open(
    text: string,
    from: number,
    marked: number,
    more: () => boolean,
  ): LineKind {
    const containers = this.#containers;
    let at = from;
    let depth = marked;
    // Whether the last block the line starts is a quote, which may be a
    // callout.
    let quoteStarted = false;
    for (;;) {
      if (quoteStarted && calloutType.test(text.slice(at))) {
        this.#leaf = { kind: "title" };
        this.#blankFrom = undefined;
        this.start = at;
        return "title";
      }
      const lead = skipBlank(text, at);
      if (lead === text.length) {
        // The blocks it starts can leave nothing after their markers, as a
        // `>` or a `-` alone does: then the line is blank, in them.
        this.#leaf = none;
        this.#blankFrom = depth;
        this.start = at;
        return "none";
      }
      if (indentedAsCode(text, at)) {
        this.#leaf = none;
        this.#blankFrom = undefined;
        this.start = at;
        return "code";
      }
      const mark = text[lead] ?? "";
      if (mark === ">") {
        containers.push({ kind: "quote" });
        depth = containers.length;
        at = text[lead + 1] === " " ? lead + 2 : lead + 1;
        quoteStarted = true;
        continue;
      }
      if (oneOf(mark, "*-_") && isThematicBreak(text, at)) {
        this.#leaf = none;
        this.#blankFrom = undefined;
        this.start = at;
        return "none";
      }
      const item = oneOf(mark, "*+-0123456789")
        ? itemStart(text, at)
        : undefined;
      if (item === undefined) break;
      containers.push({
        kind: "item",
        marker: item.marker,
        indent: item.indent,
        dedent: item.indent,
      });
      depth = containers.length;
      at = taskEnd(text, item.text);
      quoteStarted = false;
    }
    this.#blankFrom = undefined;
    this.start = at;
    const mark = firstMark(text, at);
    const math = mark === "$" ? opensMath(text, at, more) : 0;
    if (math > 0) {
      this.#leaf = { kind: "math", length: math };
      return "none";
    }
    if (mark === "%" && opensComment(text, at)) {
      this.#leaf = { kind: "comment" };
      return "none";
    }
    const fence = oneOf(mark, "`~") ? opensFence(text, at) : undefined;
    if (fence !== undefined) {
      this.#leaf = { kind: "fence", ...fence };
      return "code";
    }
    if (mark === "#" && opensHeading(text, at)) {
      this.#leaf = none;
      return "line";
    }
    const html = mark === "<" ? opensHtml(text, at) : undefined;
    if (html !== undefined) {
      // Some kinds end on the line that holds their end, the first too.
      const ended = html.end?.(text.slice(at)) === true;
      this.#leaf = ended ? none : { kind: "html", end: html.end };
      return "none";
    }
    const label = mark === "[" ? definition.exec(text.slice(at)) : null;
    if (label !== null) {
      this.#leaf = {
        kind: "definition",
        first: text.slice(at),
        address: label.groups?.address === undefined,
      };
      return "paragraph";
    }
    this.#leaf = { kind: "paragraph", first: text.slice(at), lines: 1 };
    return "paragraph";
  }
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
 * The title of callout title line `line`, the text after its type, as a note
 * of one line: what that line is, and the column of `line` it starts at. A
 * title that is a callout's title line itself, as in `> [!a] > [!b] c`, is
 * read so in turn, down to the innermost.
 */
function calloutTitle(line: string): {
  readonly lineAt: LineAt;
  readonly kind: LineKind;
  readonly start: number;
} {
  let text = line;
  let start = 0;
  let kind: LineKind = "title";
  // A loop, as titles can nest as deep as a line is long. The text gets
  // shorter each time round, as a title line holds a `>` before its type.
  while (kind === "title") {
    // The markers of the quotes and list items before a type hold no `[`.
    const from = text.indexOf("[");
    const end = from + (calloutType.exec(text.slice(from))?.[0].length ?? 0);
    start += end;
    text = text.slice(end);
    const title = text;
    kind = new Blocks((index) => (index === 0 ? title : undefined)).read(0);
  }
  const title = text;
  return { lineAt: (index) => (index === 0 ? title : undefined), kind, start };
}

/**
 * Whether line `line` of a note lies in its front matter or in a code block,
 * fenced or indented, a fence's own lines and the info string after an
 * opening fence included, as {@link insideCode} finds them. Only the lines up
 * to `line` are read, the front matter's, and one more where a line's kind
 * needs it.
 */
export function insideCodeBlock(lineAt: LineAt, line: number): boolean {
  const from = afterFrontMatter(lineAt, line);
  if (from === undefined) return true;
  const blocks = new Blocks(lineAt);
  let kind: LineKind = "none";
  for (let index = from; index <= line; index++) kind = blocks.read(index);
  if (kind === "title") return calloutTitle(blocks.text).kind === "code";
  return kind === "code";
}

/**
 * Whether column `ch` of line `line` of a note lies in code, as Obsidian
 * renders it: in front matter, a code block, or a code span, which can
 * run across the lines of a paragraph but not past it, and not across a
 * table's cells. The lines up to `line` are read, and those after it only as
 * far as its paragraph goes, and only while what started before `ch` may
 * still end there.
 */
export function insideCode(lineAt: LineAt, line: number, ch: number): boolean {
  const from = afterFrontMatter(lineAt, line);
  if (from === undefined) return true;
  const blocks = new Blocks(lineAt);
  // The text of the paragraph that holds the line, up to it.
  let paragraph: string[] = [];
  let kind: LineKind = "none";
  for (let index = from; index <= line; index++) {
    kind = blocks.read(index);
    const text = blocks.content;
    if (kind === "paragraph") paragraph = [text];
    else if (kind === "continued") paragraph.push(text);
  }
  if (kind === "code") return true;
  if (kind === "none" || kind === "underline") return false;
  if (kind === "title") {
    const title = calloutTitle(blocks.text);
    return ch >= title.start && insideCode(title.lineAt, 0, ch - title.start);
  }
  // Markers, or a comment the line's text follows.
  if (ch < blocks.start) return false;
  const text = blocks.content;
  const at = ch - blocks.start;
  if (kind === "line") return insideInlineCode(text, at) === true;
  if (kind === "row") return insideCell(text, at);
  let index = line + 1;
  let after: LineKind = blocks.has(index) ? blocks.read(index) : "none";
  // A paragraph's first line is a table's header when the next line is its
  // delimiter row, and a heading over an underline.
  if (kind === "paragraph" && after === "row") return insideCell(text, at);
  if (kind === "paragraph" && after === "underline") {
    return insideInlineCode(text, at) === true;
  }
  let joined = paragraph.join("\n");
  const position = joined.length - text.length + at;
  const found = insideInlineCode(joined, position, after !== "continued");
  if (found !== undefined) return found;
  // What started before `ch` may end in the rest of the paragraph.
  while (after === "continued") {
    joined += `\n${blocks.content}`;
    index++;
    after = blocks.has(index) ? blocks.read(index) : "none";
  }
  return insideInlineCode(joined, position) === true;
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
  return insideInlineCode(row.slice(start, end), ch - start) === true;
}
