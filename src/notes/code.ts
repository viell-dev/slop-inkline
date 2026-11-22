// Where a note's text is code or front matter, as Obsidian renders the note:
// there a trigger is the note's own text and lists nothing, and an embed shows
// nothing. So does a place in a comment, math, or an HTML tag, where Obsidian
// shows nothing. Plain functions, so that unit tests can check them;
// suggest.ts and entries.ts use them. They read a note's lines as its editor
// has them now, as the metadata cache, which follows saves, may not have them
// yet.
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
//   `$$` block.
// - The lines of an item numbered 0 to 9 with a `.`, whose text starts an odd
//   number of columns in, lose a column more than that.
// - Where a line of an item, before or after, has text indented by fewer
//   columns than its lines lose, all of its lines lose no more than those, and
//   what they hold reads accordingly: an earlier fence's end, heading, or
//   table can read otherwise. Such an item is read again, as a note of its
//   own; most notes have none, and a quick look at the lines after tells so.
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
//   the next `%%`, and the rest of that line starts a block; `$$` with no
//   other `$` on its line, whatever follows it there, opens math to a line
//   that ends in as many `$`, when another line follows.
// - A link reference definition, `[label]: address "title"`, is read on its
//   own, with its address or its title on the next line.
// - A footnote, `[^label]:` at a block's start, holds the text after its label
//   and goes on as a paragraph would, but over a `%%` line, and not over a
//   definition or another footnote; after a blank line, or a line of white
//   space alone, it goes on in a line indented four columns or more. Obsidian
//   reads its text as a note of its own, without the label and the spaces
//   after it, and up to four columns of indentation from its later lines, and
//   shows it at the note's end, after the rest of the note's text.
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
// does.
//
// Where these functions cannot be sure, they count a place as code, so that
// nothing is inserted there in code:
//
// - Every line of an HTML block. Obsidian passes the block to the browser, so
//   where it shows code, as in `<pre><code>`, cannot be told from its lines,
//   and an embed in it shows as text anyway.
// - Everything after a `<code>` or `<pre>` tag, in any form, that the note
//   has not closed, whatever blocks lie between: the browser keeps an open
//   `<code>` open over blank lines and blocks, even out of a quote or a
//   heading. html.ts reads the note's raw HTML as the browser does, and says
//   where a closing tag closes nothing, and what makes everything after it
//   uncertain. Tags in code, front matter, `%%` or `$$` blocks, and
//   footnotes count for nothing, and so do those that inline.ts reads as
//   text; a table's cell keeps to itself what it opens and closes.
// - A footnote's text, where raw HTML before the footnote, in the rest of
//   the note's text, or in any other footnote leaves anything open: the
//   footnotes show after all of them, in the order the note refers to them.
// - A paragraph's text that would take too long to read, as inline.ts says.
// - A paragraph whose first lines Obsidian may read as a definition, whose
//   label or title runs on to another line: the place is code where either
//   reading finds it.
// - A math block's every line, even where TeX finds an error in the math and
//   shows its text; and a `$$` line as a math block's first, even where the
//   item or quote that holds it ends after it, and Obsidian starts no math.
//
// They do not follow one rare rule of Obsidian's, a definition whose address
// comes after a blank line, which Obsidian shows nothing of: they read its
// address as a paragraph's text.

import {
  inBlock,
  isOpen,
  mayChange,
  noTags,
  type OpenTags,
  readHtmlLine,
  settled,
} from "./html.ts";
import { closeTag, insideInlineCode, openTag, tagsAfter } from "./inline.ts";

/** A note's line, as its editor has it now; undefined past the note's end. */
export type LineAt = (index: number) => string | undefined;

/** A block that holds others: a quote, or a list item. */
type Container = { readonly kind: "quote" } | Item;

/** A list item, open as its lines are read. */
interface Item {
  readonly kind: "item";
  /** The bullet, or a number's `.` or `)`. */
  readonly marker: string;
  /** The columns of indentation a line needs to go on in the item. */
  readonly indent: number;
  /**
   * The columns a line in it loses: as {@link ItemStart} says, or fewer
   * after a line with text indented less.
   */
  dedent: number;
  /** The line it starts on, and where its text starts in that line. */
  readonly line: number;
  readonly from: number;
  /** The most columns that a line after its first has lost, or 0. */
  lost: number;
}

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
   * A footnote's text, from its `[^label]:` line, as far as `lines` lines
   * with text; `blank` says that the last line was blank.
   */
  | { readonly kind: "footnote"; lines: number; blank: boolean }
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
 * - `html`, a line of an HTML block, which the browser reads, so that where
 *   it shows code cannot be told from its lines, and an embed in it shows as
 *   text;
 * - `hidden`, a line of a `%%` comment block or a `$$` math block, where an
 *   embed shows nothing;
 * - `footnote`, the first line of a footnote, whose text is read as a note of
 *   its own, as {@link footnoteText} gives it;
 * - `aside`, a line that goes on in the footnote before it;
 * - `none`, a line with no text to read: a blank line, a thematic break, or
 *   a line of a definition's title.
 */
type LineKind =
  | "code"
  | "paragraph"
  | "continued"
  | "row"
  | "line"
  | "title"
  | "underline"
  | "html"
  | "hidden"
  | "footnote"
  | "aside"
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
/** A footnote's first line: its label, which holds no white space. */
const footnoteStart = /^ {0,3}\[\^[^\]\s]+\]:/;
/**
 * A definition over a paragraph's first lines: a label, an address, and a
 * title, any of which can go on to a later line. A title that opens without
 * closing makes it no definition.
 */
const definitionOverLines = new RegExp(
  String.raw`^[ \t]*\[(?!\^)(?:\\[\s\S]|[^\]\\])+\]:[ \t\n]*(?:<[^>[\]]+>|[^\s[\]<][^\s[\]]*)(?:[ \t\n]+(?:"[^"]*"|'[^']*'|\([^)]*\))|(?![ \t\n]+["'(]))[ \t]*\n`,
);

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
  /**
   * The columns its later lines lose: `indent`, or one more for an item
   * numbered 0 to 9 with a `.` whose text starts an odd number of columns
   * in, as Obsidian takes them.
   */
  readonly dedent: number;
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
  let digits = 0;
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
    digits = index - lead;
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
  const extra = marker === "." && digits === 1 && indent % 2 === 1 ? 1 : 0;
  return { marker, interrupts, indent, dedent: indent + extra, text: index };
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
 * Whether `text` from `from`, a line that would go on in a footnote's text
 * without a blank line before it, ends the footnote: as it would end a
 * paragraph, but for a `%%` comment, which goes on in it, and a definition
 * or another footnote, which end it.
 */
function interruptsFootnote(
  text: string,
  from: number,
  more: () => boolean,
): boolean {
  const first = firstMark(text, from);
  if (first === "%") return false;
  if (first === "[") {
    const rest = text.slice(from);
    return definition.test(rest) || footnoteStart.test(rest);
  }
  return interruptsParagraph(text, from, more);
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
  /** Whether a comment ends before `start` on the last line read. */
  commented = false;

  /** The text of the last line read, after its containers' markers. */
  get content(): string {
    return this.start === 0 ? this.text : this.text.slice(this.start);
  }

  /** How many containers the last line read is in. */
  get depth(): number {
    return this.#containers.length;
  }

  /** Whether the last line read starts a list item. */
  opened = false;

  /** The index of the line being read. */
  #index = 0;
  /** Whether a line follows the one being read. */
  readonly #more = (): boolean => this.has(this.#index + 1);

  constructor(lineAt: LineAt) {
    this.#lineAt = lineAt;
  }

  /** A reader that goes on from where this one stands, apart from it. */
  #fork(): Blocks {
    const fork = new Blocks(this.#lineAt);
    for (const container of this.#containers) {
      fork.#containers.push({ ...container });
    }
    fork.#leaf = { ...this.#leaf };
    fork.#blankFrom = this.#blankFrom;
    fork.#fetched = this.#fetched;
    fork.#index = this.#index;
    return fork;
  }

  /**
   * The outermost list item that holds the last line read, and whose lines
   * lose fewer columns, once a line of it indented less is read, before or
   * after, than lines of it before have lost: Obsidian reads all of an
   * item's lines before what they hold, so such a line changes how they all
   * read. With its depth, the columns its lines lose, and the line that ends
   * it, after its last. Reads on to the end of the items that hold the line.
   */
  regrouped():
    | { readonly depth: number; readonly dedent: number; readonly end: number }
    | undefined {
    const containers = this.#containers;
    const outer = containers.findIndex(
      (container) => container.kind === "item" && container.lost > 0,
    );
    if (outer === -1) return undefined;
    const lowered = containers.some(
      (container) =>
        container.kind === "item" && container.dedent < container.lost,
    );
    if (!lowered && !this.#mayLower()) return undefined;
    const fork = this.#fork();
    const read = fork.#containers.slice();
    const ends: number[] = [];
    let index = this.#index + 1;
    for (
      ;
      fork.#containers[outer] === read[outer] && fork.has(index);
      index++
    ) {
      fork.read(index);
      for (let depth = outer; depth < read.length; depth++) {
        if (
          ends[depth] === undefined &&
          fork.#containers[depth] !== read[depth]
        )
          ends[depth] = index;
      }
    }
    for (let depth = outer; depth < containers.length; depth++) {
      const item = containers[depth];
      const after = read[depth];
      if (item?.kind === "item" && after?.kind === "item") {
        if (after.dedent < item.lost) {
          return { depth, dedent: after.dedent, end: ends[depth] ?? index };
        }
      }
    }
    return undefined;
  }

  /**
   * Whether a line after the last one read may make a list item open now
   * lose fewer columns from its lines: one with text that starts no item,
   * indented by some spaces but fewer than the innermost item's text, which
   * a line in these items must reach to go on in all of them. A tab, or a
   * quote among them, would take more reading to tell, so they may.
   */
  #mayLower(): boolean {
    let text = 0;
    for (const container of this.#containers) {
      if (container.kind === "quote") return true;
      text += container.dedent;
    }
    for (let index = this.#index + 1; ; index++) {
      const line = this.#lineAt(index);
      if (line === undefined) return false;
      let lead = 0;
      while (line[lead] === " ") lead++;
      if (line[lead] === "\t") return true;
      if (
        lead > 0 &&
        lead < text &&
        !isWhite(line, lead) &&
        itemStart(line, 0) === undefined
      ) {
        return true;
      }
    }
  }

  /**
   * The text of list item `depth`, open now, as a note of its own whose lines
   * lose `dedent` columns, up to line `end`: what Obsidian reads in it. With
   * the line it starts on, and where its text starts in each of its lines.
   */
  itemText(
    depth: number,
    dedent: number,
    end: number,
  ): {
    readonly lineAt: LineAt;
    readonly first: number;
    readonly startOf: (index: number) => number;
  } {
    const item = this.#containers[depth];
    if (item?.kind !== "item") throw new Error("no list item there");
    const outside = this.#containers.slice(0, depth);
    const startOf = (index: number): number => {
      if (index === item.line) return item.from;
      const text = withoutReturn(this.#lineAt(index) ?? "");
      let at = 0;
      for (const container of outside) {
        at =
          container.kind === "quote"
            ? (quoteMarker(text, at) ?? at)
            : strip(text, at, container.dedent);
      }
      return strip(text, at, dedent);
    };
    const lineAt = (index: number): string | undefined => {
      const at = item.line + index;
      if (at >= end) return undefined;
      return this.#lineAt(at)?.slice(startOf(at));
    };
    return { lineAt, first: item.line, startOf };
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
    this.commented = false;
    this.opened = false;
    return this.#readLine(index);
  }

  /** Opens a list item that `item` starts in `text` on the line being read. */
  #openItem(text: string, item: ItemStart): number {
    const from = taskEnd(text, item.text);
    this.#containers.push({
      kind: "item",
      marker: item.marker,
      indent: item.indent,
      dedent: item.dedent,
      line: this.#index,
      from,
      lost: 0,
    });
    this.opened = true;
    return from;
  }

  #readLine(index: number): LineKind {
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
        // Where its lines lose a column more than its text is indented, a
        // line with text indented no further makes them lose no more.
        if (container.dedent > container.indent) {
          const lead = skipBlank(text, at);
          if (!isWhite(text, lead)) {
            container.dedent = Math.min(
              container.dedent,
              columnsOf(text, at, lead),
            );
          }
        }
        at = strip(text, at, container.dedent);
        container.lost = Math.max(container.lost, container.dedent);
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
          const from = this.#openItem(text, item);
          this.#blankFrom = undefined;
          this.#leaf = none;
          return this.#open(text, from, containers.length, more);
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
      const lost = Math.min(container.dedent, columns);
      container.lost = Math.max(container.lost, lost);
      at = strip(text, at, lost);
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
        if (leaf.end === undefined) {
          // The empty line that ends it is not its own.
          if (at !== text.length) return "html";
          this.#leaf = none;
          return "none";
        }
        if (leaf.end(text.slice(at))) this.#leaf = none;
        return "html";
      case "math":
        if (closesMath(text, at, leaf.length)) this.#leaf = none;
        return "hidden";
      case "comment": {
        const close = text.indexOf("%%", at);
        if (close === -1) return "hidden";
        // What follows the comment on its line starts a block.
        this.#leaf = none;
        this.start = close + 2;
        this.commented = true;
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
      case "footnote":
        return this.#goOnInFootnote(leaf, text, at, marked, more);
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

  /**
   * What a line that would go on in footnote `leaf` is, from `at`. Its text
   * goes on as a paragraph's does, but for what {@link interruptsFootnote}
   * says, and after a blank line, a line of white space alone among them, in
   * a line indented four columns or more. A delimiter row under its first
   * line makes a table in its text, not of it.
   */
  #goOnInFootnote(
    leaf: Extract<Leaf, { kind: "footnote" }>,
    text: string,
    at: number,
    marked: number,
    more: () => boolean,
  ): LineKind {
    if (isWhite(text, at)) {
      leaf.blank = true;
      return "aside";
    }
    if (leaf.blank) {
      if (columnsOf(text, at, skipBlank(text, at)) < 4) {
        this.#leaf = none;
        return this.#open(text, at, marked, more);
      }
      leaf.blank = false;
      leaf.lines++;
      return "aside";
    }
    if (leaf.lines === 1 && underline.test(text.slice(at))) {
      this.#leaf = none;
      return "underline";
    }
    if (indentedLine(text, at)) {
      leaf.lines++;
      return "aside";
    }
    if (interruptsFootnote(text, at, more)) {
      this.#leaf = none;
      return this.#open(text, at, marked, more);
    }
    leaf.lines++;
    return "aside";
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
      at = this.#openItem(text, item);
      depth = containers.length;
      quoteStarted = false;
    }
    this.#blankFrom = undefined;
    this.start = at;
    const mark = firstMark(text, at);
    const math = mark === "$" ? opensMath(text, at, more) : 0;
    if (math > 0) {
      this.#leaf = { kind: "math", length: math };
      return "hidden";
    }
    if (mark === "%" && opensComment(text, at)) {
      this.#leaf = { kind: "comment" };
      return "hidden";
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
      return "html";
    }
    if (mark === "[" && footnoteStart.test(text.slice(at))) {
      this.#leaf = { kind: "footnote", lines: 1, blank: false };
      return "footnote";
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
 *
 * After a `<code>` or `<pre>` tag that the note has not closed before `ch`,
 * whatever lies between, the place counts as code too: the browser keeps an
 * open `<code>` open over blank lines and blocks, and nothing short of the
 * browser's own reading tells where it ends.
 *
 * The list item that holds the place is read to its end, and read again as a
 * note of its own, as Obsidian reads it, where a line of it indented less
 * changes how many columns its lines lose; so is a footnote's text.
 */
export function insideCode(lineAt: LineAt, line: number, ch: number): boolean {
  return codeIn(lineAt, line, ch, true, 0);
}

/**
 * {@link insideCode}, in a note, or in text that is read as one, without front
 * matter where `frontMatter` is false, within containers that may add `outer`
 * elements, for html.ts, around what it holds.
 */
function codeIn(
  lineAt: LineAt,
  line: number,
  ch: number,
  frontMatter: boolean,
  outer: number,
): boolean {
  const from = frontMatter ? afterFrontMatter(lineAt, line) : 0;
  if (from === undefined) return true;
  const reader = new TagReader(lineAt, outer);
  for (let index = from; index <= line; index++) reader.read(index);
  const { blocks, kind, paragraph } = reader;
  // What raw HTML leaves open before the paragraph or line that holds `ch`.
  const tags = reader.current;
  // An item whose lines all read otherwise once all are read is read again,
  // as a note of its own, where nothing raw HTML leaves open reaches in.
  const regrouped = blocks.regrouped();
  if (regrouped !== undefined) {
    const item = blocks.itemText(
      regrouped.depth,
      regrouped.dedent,
      regrouped.end,
    );
    const open = reader.items.get(item.first);
    const at = ch - item.startOf(line);
    if (open === undefined || isOpen(open) || at < 0) return true;
    const around = outer + 2 * (regrouped.depth + 1);
    return codeIn(item.lineAt, line - item.first, at, false, around);
  }
  // An HTML block's code cannot be told from its lines, and an embed shows
  // as text in it: the list lists nothing there, nor in a comment or math,
  // where an embed shows nothing.
  if (kind === "code" || kind === "html" || kind === "hidden") return true;
  if (blocks.commented && ch < blocks.start) return true;
  if (kind === "none" || kind === "underline") return isOpen(tags);
  if (kind === "title") {
    if (isOpen(tags)) return true;
    const title = calloutTitle(blocks.text);
    return ch >= title.start && insideCode(title.lineAt, 0, ch - title.start);
  }
  // Markers, or a comment the line's text follows.
  if (ch < blocks.start) return isOpen(tags);
  if (kind === "footnote" || kind === "aside") {
    return inFootnote(reader, line, ch, outer);
  }
  const text = blocks.content;
  const at = ch - blocks.start;
  if (kind === "line") return insideInlineCode(text, at, true, tags) === true;
  if (kind === "row") return insideCell(text, at, tags);
  let index = line + 1;
  let after: LineKind = blocks.has(index) ? blocks.read(index) : "none";
  // A paragraph's first line is a table's header when the next line is its
  // delimiter row, and a heading over an underline.
  if (kind === "paragraph" && after === "row") {
    return insideCell(text, at, tags);
  }
  if (kind === "paragraph" && after === "underline") {
    return insideInlineCode(text, at, true, tags) === true;
  }
  let joined = paragraph.join("\n");
  const position = joined.length - text.length + at;
  // A definition over the paragraph's first lines may end before `ch`,
  // which then starts a paragraph of its own. Where either reading finds
  // code, the place counts as code; a tag open before it stays open, as
  // Obsidian shows nothing of a definition that might close it.
  const definitionEnd = paragraph.length > 1 ? definitionLines(joined) : -1;
  if (definitionEnd !== -1 && isOpen(tags)) return true;
  const found =
    definitionEnd === -1 || definitionEnd > position
      ? insideInlineCode(joined, position, after !== "continued", tags)
      : undefined;
  if (found !== undefined) return found;
  // What started before `ch` may end in the rest of the paragraph.
  while (after === "continued") {
    joined += `\n${blocks.content}`;
    index++;
    after = blocks.has(index) ? blocks.read(index) : "none";
  }
  if (insideInlineCode(joined, position, true, tags) === true) return true;
  return (
    definitionEnd !== -1 &&
    definitionEnd <= position &&
    insideInlineCode(
      joined.slice(definitionEnd),
      position - definitionEnd,
      true,
      tags,
    ) === true
  );
}

/**
 * Where the text of footnote line `text` starts, as Obsidian reads the
 * footnote's text as a note of its own: after the label and the spaces and
 * tabs after it on its first line, and after up to four columns of
 * indentation on the others.
 */
function footnoteCut(text: string, first: boolean): number {
  if (!first) return strip(text, 0, 4);
  return skipBlank(text, footnoteStart.exec(text)?.[0].length ?? 0);
}

/** A footnote's lines, `lines`, as a note of their own. */
function footnoteNote(lines: readonly string[]): LineAt {
  const note = lines.map((line, index) =>
    line.slice(footnoteCut(line, index === 0)),
  );
  return (index) => note[index];
}

/**
 * Whether column `ch` of line `line`, the last line `reader` read, a line of
 * a footnote, lies in code. Obsidian reads the footnote's text as a note of
 * its own, unless the next line makes its first line a heading, and shows it
 * at the note's end, after the rest of the note's text and the footnotes
 * before it: the place counts as code where raw HTML there, or before the
 * footnote, or in any other footnote, leaves anything open.
 */
function inFootnote(
  reader: TagReader,
  line: number,
  ch: number,
  outer: number,
): boolean {
  const { blocks, paragraph: lines } = reader;
  const tags = reader.current;
  if (isOpen(tags)) return true;
  const here = lines.length - 1;
  const text = blocks.content;
  const at = ch - blocks.start;
  const cut = footnoteCut(text, here === 0);
  const around = outer + 2 * blocks.depth;
  let index = line + 1;
  if (blocks.has(index) && reader.read(index) === "underline") {
    return insideInlineCode(text, at, true, tags) === true;
  }
  // The rest of the note, its lines after the place among it, which can end
  // what starts before it.
  while (blocks.has(++index)) reader.read(index);
  if (isOpen(reader.finish())) return true;
  const note = footnoteNote(lines);
  if (
    reader.footnotes.some(
      (footnote) => footnote !== lines && leavesOpen(footnoteNote(footnote)),
    ) ||
    footnotesLeaveOpen(note)
  ) {
    return true;
  }
  // In the label, which Obsidian shows a number for.
  if (at < cut) return false;
  return codeIn(note, here, at - cut, false, around);
}

/**
 * Whether raw HTML in a note, read to its end, or in a footnote in it,
 * leaves anything open.
 */
function leavesOpen(lineAt: LineAt): boolean {
  return footnotesLeaveOpen(lineAt, true);
}

/**
 * Whether raw HTML in a footnote in a note, or in one in that, leaves
 * anything open; or in the note's own text too, where `text` is true.
 */
function footnotesLeaveOpen(lineAt: LineAt, text = false): boolean {
  const reader = new TagReader(lineAt, 0);
  for (let index = 0; lineAt(index) !== undefined; index++) reader.read(index);
  if (isOpen(reader.finish()) && text) return true;
  return reader.footnotes.some((footnote) =>
    leavesOpen(footnoteNote(footnote)),
  );
}

/**
 * Reads a note's lines with {@link Blocks}, and what raw HTML leaves open
 * before each, as html.ts reads it: in what Obsidian shows in the note's
 * text, not in its footnotes, whose texts it keeps.
 */
class TagReader {
  readonly blocks: Blocks;
  /** The last line read, and what raw HTML leaves open before it. */
  kind: LineKind = "none";
  #tags = noTags;
  /** What the last line read leaves open, once the next is read. */
  #after: OpenTags | undefined;
  /** What it leaves open before each line that starts a list item. */
  readonly items = new Map<number, OpenTags>();
  /**
   * The lines of the paragraph or footnote read last, up to the last line
   * read, and whether any of them could change what is open.
   */
  paragraph: string[] = [];
  #tagged = false;
  /** The lines of the footnotes that have ended. */
  readonly footnotes: (readonly string[])[] = [];
  /** The number of the block being read, for html.ts. */
  #block = 0;
  /**
   * How many elements its containers may add: a list item two, a list and
   * the item, and a callout two, itself and its content; and `#outer`
   * around them.
   */
  #depth: number;
  readonly #outer: number;

  constructor(lineAt: LineAt, outer: number) {
    this.blocks = new Blocks(lineAt);
    this.#outer = outer;
    this.#depth = outer;
  }

  /** What raw HTML leaves open before the last line read, for its block. */
  get current(): OpenTags {
    return inBlock(this.#tags, this.#block, this.#depth);
  }

  /** Reads line `index`, the next. */
  read(index: number): LineKind {
    if (this.#after !== undefined) this.#tags = this.#after;
    this.#after = undefined;
    const before = this.kind;
    const { blocks } = this;
    const kind = blocks.read(index);
    this.kind = kind;
    const text = blocks.content;
    if (kind === "continued" || kind === "aside") {
      this.paragraph.push(text);
      this.#tagged ||= mayChange(text, this.#tags);
      return kind;
    }
    this.#end(kind);
    if (kind !== "html" || before !== "html") {
      // Obsidian's own HTML for the line follows the raw HTML before it.
      if (kind !== "html" && !isWhite(text, 0)) {
        this.#tags = settled(this.#tags);
      }
      this.#block++;
      this.#depth = this.#outer + 2 * blocks.depth;
    }
    if (blocks.opened) this.items.set(index, this.#tags);
    if (kind === "paragraph" || kind === "footnote") {
      this.paragraph = [text];
      this.#tagged = mayChange(text, this.#tags);
    } else if (mayRead(kind, blocks, this.#tags)) {
      this.#after = tagsOfLine(kind, blocks, this.current);
    }
    return kind;
  }

  /** What raw HTML leaves open after all the lines read. */
  finish(): OpenTags {
    if (this.#after !== undefined) this.#tags = this.#after;
    this.#after = undefined;
    this.#end("none");
    return this.#tags;
  }

  /** Ends the paragraph or footnote read last, before a line of `next`. */
  #end(next: LineKind): void {
    const lines = this.paragraph;
    // Only a footnote's lines start with its label.
    const footnote = footnoteStart.test(lines[0] ?? "");
    if (footnote && next !== "underline") this.footnotes.push(lines);
    else if (this.#tagged) {
      // A delimiter row makes the paragraph's one line a table's header,
      // and an underline a footnote's first line a heading's text.
      this.#tags = footnote
        ? tagsAfter(lines[0] ?? "", this.current)
        : tagsOfParagraph(lines, this.current, next === "row");
    }
    this.paragraph = [];
    this.#tagged = false;
  }
}

/**
 * What raw HTML leaves open after a paragraph of `lines`, with `tags` open
 * before it; a table's header, if `header`.
 */
function tagsOfParagraph(
  lines: readonly string[],
  tags: OpenTags,
  header: boolean,
): OpenTags {
  const first = lines[0] ?? "";
  if (header) return tagsOfRow(first, tags);
  const text = lines.join("\n");
  // The paragraph's end counts as the line break after a definition.
  const end = lines.length > 1 ? definitionLines(`${text}\n`) : -1;
  if (end === -1) return tagsAfter(text, tags);
  // A definition over the paragraph's first lines, which Obsidian may show
  // nothing of: what it closes stays open.
  const defined = tagsAfter(text.slice(0, end), tags, false);
  return tagsAfter(text.slice(end), defined);
}

/** Whether line `kind` of `blocks`, the last read, could change `tags`. */
function mayRead(kind: LineKind, blocks: Blocks, tags: OpenTags): boolean {
  switch (kind) {
    case "html":
      return (
        !tags.unsure && (tags.mode !== "text" || blocks.content.includes("<"))
      );
    case "line":
    case "row":
      return mayChange(blocks.content, tags);
    case "title":
      return mayChange(blocks.text, tags);
    default:
      return false;
  }
}

/**
 * What raw HTML leaves open after line `kind` of `blocks`, the last one
 * read, which is not a paragraph's, with `tags` open before it. Code, front
 * matter, and comment and math blocks hold no tags; an HTML block's lines
 * are HTML.
 */
function tagsOfLine(kind: LineKind, blocks: Blocks, tags: OpenTags): OpenTags {
  const text = blocks.content;
  switch (kind) {
    case "html":
      return readHtmlLine(text, tags);
    case "line":
      return tagsAfter(text, tags);
    case "row":
      return tagsOfRow(text, tags);
    case "title": {
      const title = calloutTitle(blocks.text);
      return title.kind === "code" || title.kind === "hidden"
        ? tags
        : tagsAfter(title.lineAt(0) ?? "", tags);
    }
    default:
      return tags;
  }
}

/**
 * What raw HTML leaves open after a table's row `row`, with `tags` open
 * before it. The browser closes with each cell what the cell opens, and keeps
 * what was open before it open: only how what follows is read goes on.
 */
function tagsOfRow(row: string, tags: OpenTags): OpenTags {
  let carried = tags;
  for (const [start, end] of cellsOf(row)) {
    carried = inCell(tags, tagsAfter(row.slice(start, end), carried));
  }
  return carried;
}

/** `tags` after a cell that `read` left: how what follows is read. */
function inCell(tags: OpenTags, read: OpenTags): OpenTags {
  const next = settled(read);
  return {
    ...tags,
    mode: next.mode,
    name: next.name,
    closing: next.closing,
    unsure: next.unsure,
  };
}

/** Where each cell of table row `row` starts and ends. */
function cellsOf(row: string): [number, number][] {
  const cells: [number, number][] = [];
  let start = 0;
  for (let index = 0; index < row.length; index++) {
    if (row[index] === "\\") index++;
    else if (row[index] === "|") {
      cells.push([start, index]);
      start = index + 1;
    }
  }
  cells.push([start, row.length]);
  return cells;
}

/**
 * Where a link reference definition that starts `text`, a paragraph's lines,
 * and runs over more than its first line, ends, after its last line's break;
 * or -1 for none.
 */
function definitionLines(text: string): number {
  const found = definitionOverLines.exec(text);
  return found === null ? -1 : found[0].length;
}

/**
 * Whether column `ch` of a table's row `row` is in a code span in its cell,
 * or after a tag open before the row or in a cell before.
 */
function insideCell(row: string, ch: number, tags: OpenTags): boolean {
  let open = tags;
  for (const [start, end] of cellsOf(row)) {
    if (ch <= end) {
      return (
        insideInlineCode(row.slice(start, end), ch - start, true, open) === true
      );
    }
    open = inCell(tags, tagsAfter(row.slice(start, end), open));
  }
  return isOpen(open);
}
