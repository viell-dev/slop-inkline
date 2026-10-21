// Finding links and embeds in a note's text, as Obsidian reads them, so that
// a symbol is never inserted inside one, and the embed under the cursor can
// be told apart. Plain functions with unit tests. They read a paragraph at a
// time, the lines up to a blank one, since a Markdown link's text and the
// space around its destination may cross a line break, as Obsidian's
// metadata cache and Reading view read them; a wiki link may not.

/** A link or embed in a note's text. */
export interface LinkSpan {
  /** Where it starts, at the `!` of an embed, and just past where it ends. */
  readonly start: number;
  readonly end: number;
  /** Whether it is an embed, `![[...]]` or `![...](...)`. */
  readonly embed: boolean;
  /**
   * The path or address it leads to, without any `#` heading or block: a
   * wiki link's text before its `#` or `|`, or a Markdown link's
   * destination with its backslash escapes removed and its percent escapes
   * decoded as Obsidian decodes them, or an autolink's address.
   */
  readonly target: string;
  /**
   * Whether it is a bare web or mail address, which has no mark at its end:
   * only a space ends one.
   */
  readonly bare?: boolean;
}

/** The end of the code span that starts at `at`, or undefined if it never ends. */
function codeSpanEnd(text: string, at: number): number | undefined {
  let run = 0;
  while (text[at + run] === "`") run++;
  const fence = "`".repeat(run);
  let search = at + run;
  for (;;) {
    const close = text.indexOf(fence, search);
    if (close === -1) return undefined;
    // A longer run of backticks does not close a shorter one.
    let length = 0;
    while (text[close + length] === "`") length++;
    if (length === run) return close + run;
    search = close + length;
  }
}

/**
 * For each `[` in `text` that a `]` closes, the index of that `]`, nested
 * brackets matched first and escaped ones skipped, found in one pass.
 */
function matchBrackets(text: string): Map<number, number> {
  const matched = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") {
      index++;
    } else if (char === "[") {
      open.push(index);
    } else if (char === "]") {
      const start = open.pop();
      if (start !== undefined) matched.set(start, index);
    }
  }
  return matched;
}

/**
 * A search for `token` in `text` from positions that never go back, as a
 * scan moving forward asks, which reads `text` once in all rather than
 * once for each position: the index of the next `token` at or after
 * `from`, or -1.
 */
function forward(text: string, token: string): (from: number) => number {
  let found = -2;
  return (from) => {
    if (found !== -1 && found < from) found = text.indexOf(token, from);
    return found;
  };
}

/** The forward searches a paragraph's scan for wiki links needs. */
interface Finders {
  readonly close: (from: number) => number;
  readonly open: (from: number) => number;
  readonly lineEnd: (from: number) => number;
}

/** Whether `char` is space between a destination's parts: a line break too. */
function spacing(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/** `text` with its backslash escapes of punctuation removed, as Markdown reads them. */
function unescaped(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/**
 * `text` with its percent escapes decoded as `decodeURI` decodes them, as
 * Obsidian reads a Markdown link's destination: those of characters such as
 * `/`, `#`, and `&` stay as written, and all of it does when they do not
 * decode, as with a bare %.
 */
function decoded(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

/** `path` without any `#` heading or block it leads to within the file. */
function withoutSubpath(path: string): string {
  const hash = path.indexOf("#");
  return hash === -1 ? path : path.slice(0, hash);
}

/**
 * The destination of the Markdown link whose `(` is at `at`, and the index
 * just past its `)`: an angle-bracketed destination, or one whose own
 * parentheses balance, then an optional title, with space, a line break
 * included, around them. Undefined where Markdown reads no link.
 */
function destination(
  text: string,
  at: number,
): { url: string; end: number } | undefined {
  let index = at + 1;
  while (spacing(text[index])) index++;
  let url: string;
  if (text[index] === "<") {
    const start = index + 1;
    for (index = start; index < text.length; index++) {
      const char = text[index];
      if (char === "\\") {
        index++;
      } else if (char === ">") {
        break;
      } else if (char === "<" || char === "\n") {
        return undefined;
      }
    }
    if (text[index] !== ">") return undefined;
    url = text.slice(start, index);
    index++;
  } else {
    const start = index;
    let depth = 0;
    for (; index < text.length; index++) {
      const char = text[index] ?? "";
      if (char === "\\") {
        index++;
      } else if (char === "(") {
        depth++;
      } else if (char === ")") {
        if (depth === 0) break;
        depth--;
      } else if (spacing(char) || char < " ") {
        break;
      }
    }
    url = text.slice(start, index);
  }
  const before = index;
  while (spacing(text[index])) index++;
  // An optional title, in quotes or parentheses, after space.
  const quote = text[index];
  if (index > before && (quote === '"' || quote === "'" || quote === "(")) {
    const closer = quote === "(" ? ")" : quote;
    for (index++; index < text.length; index++) {
      const char = text[index];
      if (char === "\\") {
        index++;
      } else if (char === closer) {
        break;
      }
    }
    if (text[index] !== closer) return undefined;
    index++;
    while (spacing(text[index])) index++;
  }
  if (text[index] !== ")") return undefined;
  return { url, end: index + 1 };
}

/**
 * An autolink in angle brackets, from just past its `<`: an address with a
 * scheme, `<https://…>`, or an email address, `<a@example.com>`.
 */
const autolink =
  /(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)>/y;

/**
 * The start of a bare web or mail address, which Obsidian shows as a link
 * after any character, in any letter case.
 */
const addressStart = /(?:https?:\/\/|mailto:|www\.)/iy;

/** The characters of a bare address: up to a space or a `<`. */
const addressBody = /[^\s<]+/y;

/** A bare email address, `a@example.com`. */
const emailAddress = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/y;

/** Whether `char` may be part of an email address's name, before its `@`. */
function emailName(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9._%+-]/.test(char);
}

/**
 * `address` without the punctuation that ends a sentence after it rather
 * than belonging to it: trailing `?!.,:;*_~'"`, and a `)` that opens
 * nothing.
 */
function trimmedAddress(address: string): string {
  let opens = 0;
  let closes = 0;
  for (const char of address) {
    if (char === "(") opens++;
    else if (char === ")") closes++;
  }
  let end = address.length;
  for (;;) {
    const last = address[end - 1] ?? "";
    if ("?!.,:;*_~'\"".includes(last)) {
      end--;
    } else if (last === ")" && closes > opens) {
      end--;
      closes--;
    } else {
      return address.slice(0, end);
    }
  }
}

/**
 * Whether `address`, a bare one, names a host as Obsidian requires before
 * it shows a link: one with a dot, as `https://x.y` has and `https://x` has
 * not, or for one that starts `www.`, a dot after it.
 */
function hostOf(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith("mailto:")) return address.includes("@");
  const www = lower.startsWith("www.");
  const rest = www ? address : address.slice(address.indexOf("://") + 3);
  const host = rest.split(/[/?#]/, 1)[0] ?? "";
  const labels = host.split(".");
  return labels.length >= (www ? 3 : 2) && labels.every((label) => label);
}

/** The bare address that starts at `index` in `text`, if one does. */
function bareAddressAt(text: string, index: number): string | undefined {
  const first = text[index]?.toLowerCase();
  addressStart.lastIndex = index;
  if (
    (first === "h" || first === "m" || first === "w") &&
    addressStart.test(text)
  ) {
    addressBody.lastIndex = index;
    const body = addressBody.exec(text)?.[0] ?? "";
    const address = trimmedAddress(body);
    return hostOf(address) ? address : undefined;
  }
  if (emailName(text[index]) && !emailName(text[index - 1])) {
    emailAddress.lastIndex = index;
    const found = emailAddress.exec(text);
    if (found !== null) return trimmedAddress(found[0]);
  }
  return undefined;
}

/**
 * The links and embeds in a paragraph of a note: lines with no blank line
 * between them, or a single line. Spans are in order of their starts; an
 * embed inside a Markdown link's text comes after that link.
 */
export function paragraphLinks(text: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  const brackets = matchBrackets(text);
  const find: Finders = {
    close: forward(text, "]]"),
    open: forward(text, "[["),
    lineEnd: forward(text, "\n"),
  };
  // The Markdown link whose text the scan is reading, where only embeds are
  // found, as an image that links; at the text's end the scan goes on past
  // the link. Read in the same pass, the text costs nothing more.
  let within: { textEnd: number; end: number } | undefined;
  let index = 0;
  while (index < text.length) {
    if (within !== undefined && index >= within.textEnd) {
      index = Math.max(index, within.end);
      within = undefined;
      continue;
    }
    const char = text[index];
    if (char === "\\") {
      // An escaped character is never syntax.
      index += 2;
      continue;
    }
    if (char === "`") {
      const end = codeSpanEnd(text, index);
      if (end === undefined || (within !== undefined && end > within.textEnd)) {
        while (text[index] === "`") index++;
      } else {
        index = end;
      }
      continue;
    }
    if (within === undefined && char === "<") {
      autolink.lastIndex = index + 1;
      const found = autolink.exec(text);
      if (found !== null) {
        const end = index + 1 + found[0].length;
        spans.push({
          start: index,
          end,
          embed: false,
          target: found[0].slice(0, -1),
        });
        index = end;
        continue;
      }
    }
    if (within === undefined) {
      const address = bareAddressAt(text, index);
      if (address !== undefined && address.length > 0) {
        spans.push({
          start: index,
          end: index + address.length,
          embed: false,
          target: address,
          bare: true,
        });
        index += address.length;
        continue;
      }
    }
    const embed = char === "!" && text[index + 1] === "[";
    if (!embed && (char !== "[" || within !== undefined)) {
      index++;
      continue;
    }
    const bracket = embed ? index + 1 : index;
    const found = linkAt(text, bracket, brackets, find);
    if (found === undefined) {
      index = bracket + 1;
      continue;
    }
    spans.push({ start: index, end: found.end, embed, target: found.target });
    if (within === undefined && found.textEnd !== undefined) {
      within = { textEnd: found.textEnd, end: found.end };
      index = bracket + 1;
      continue;
    }
    index = found.end;
  }
  return spans;
}

/**
 * The link whose `[` is at `bracket`: where it ends, what it leads to, and
 * for a Markdown link, the `]` that ends its text. Undefined where Obsidian
 * reads no link, as for an empty one.
 */
function linkAt(
  text: string,
  bracket: number,
  brackets: ReadonlyMap<number, number>,
  find: Finders,
): { end: number; target: string; textEnd?: number } | undefined {
  if (text[bracket + 1] === "[") {
    // A wiki link, on one line, holding no other.
    const close = find.close(bracket + 2);
    const nested = find.open(bracket + 2);
    const lineEnd = find.lineEnd(bracket);
    if (
      close !== -1 &&
      (nested === -1 || nested > close) &&
      (lineEnd === -1 || lineEnd > close)
    ) {
      const inner = text.slice(bracket + 2, close);
      // An empty one is no link; one that names only a heading, [[#top]],
      // leads within the note.
      if (inner.trim() === "") return undefined;
      // A table writes the | before an alias or size as \|.
      const path = (inner.split(/[|#]/, 1)[0] ?? "").replace(/\\$/, "");
      return { end: close + 2, target: path };
    }
  }
  const close = brackets.get(bracket);
  if (close === undefined || text[close + 1] !== "(") return undefined;
  const found = destination(text, close + 1);
  if (found === undefined || found.url === "") return undefined;
  return {
    end: found.end,
    target: withoutSubpath(decoded(unescaped(found.url))),
    textEnd: close,
  };
}

/**
 * Whether `line` is blank to Obsidian, ending a paragraph: empty, or only
 * spaces of any width, but not a tab, which Obsidian reads as text there.
 */
function blank(line: string): boolean {
  return line.trim() === "" && !line.includes("\t");
}

/**
 * The links and embeds in a note's text, at their offsets in it, read a
 * paragraph at a time. A paragraph here is any run of lines without a blank
 * one, so a link is also read across a heading, a fence, or a quote's line
 * that Markdown would end the paragraph at; that only ever moves an
 * insertion later.
 */
export function textLinks(text: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  let offset = 0;
  let start = 0;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    for (const span of paragraphLinks(paragraph.join("\n"))) {
      spans.push({ ...span, start: span.start + start, end: span.end + start });
    }
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    if (blank(line)) {
      flush();
    } else {
      if (paragraph.length === 0) start = offset;
      paragraph.push(line);
    }
    offset += line.length + 1;
  }
  flush();
  return spans;
}

/**
 * Where to insert at `offset` in `text` without splitting a link or embed:
 * `offset` itself, or, inside one, just past its end, and past the link
 * around it when it lies in one's text.
 */
export function outsideLinks(text: string, offset: number): number {
  return insertionAt(text, offset).at;
}

/**
 * Where and how to insert at `offset` in `text` without splitting a link:
 * the offset {@link outsideLinks} gives, and a space to put before what is
 * inserted where it would otherwise run on from a bare web address, which
 * only a space ends.
 */
export function insertionAt(
  text: string,
  offset: number,
): { at: number; before: string } {
  const spans = textLinks(text);
  let at = offset;
  // In order of their starts, a link comes before the embeds in its text.
  for (const span of spans) {
    if (span.start < at && at < span.end) at = span.end;
  }
  const after = spans.some((span) => span.bare === true && span.end === at);
  return { at, before: after ? " " : "" };
}

/**
 * The path that `embed`, a Markdown embed written alone, leads to as Obsidian
 * reads it: whole, so that a `)` that opens nothing does not end it early,
 * with its escapes removed and decoded. Undefined when it does not read as
 * one embed, whole.
 */
export function embedPath(embed: string): string | undefined {
  const spans = paragraphLinks(embed);
  const [span] = spans;
  return spans.length === 1 &&
    span !== undefined &&
    span.embed &&
    span.start === 0 &&
    span.end === embed.length
    ? span.target
    : undefined;
}

/**
 * The embed at `offset` in `text`, with the offset on it or at either of its
 * ends, as a cursor right after an embed is; undefined when there is none.
 * Where one embed ends and the next starts, it is the one that ends there,
 * as the one just typed or inserted.
 */
export function embedAt(text: string, offset: number): LinkSpan | undefined {
  return textLinks(text).find(
    (span) => span.embed && span.start <= offset && offset <= span.end,
  );
}
