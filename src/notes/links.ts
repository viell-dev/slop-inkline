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

/** An autolink in angle brackets, `<https://…>`, from just past its `<`. */
const autolink = /[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/y;

/** A bare web address, as Obsidian shows one as a link. */
const bareAddress = /(?:https?:\/\/|www\.)[^\s<]+/y;

/** What may stand just before a bare web address. */
function beforeAddress(char: string | undefined): boolean {
  return char === undefined || /[\s*_~(]/.test(char);
}

/**
 * `address` without the punctuation that ends a sentence after it rather
 * than belonging to it: trailing `?!.,:*_~'"`, and a `)` that opens nothing.
 */
function trimmedAddress(address: string): string {
  let end = address.length;
  for (;;) {
    const last = address[end - 1] ?? "";
    if ("?!.,:*_~'\"".includes(last)) {
      end--;
      continue;
    }
    const kept = address.slice(0, end);
    if (last === ")" && kept.split(")").length > kept.split("(").length) {
      end--;
      continue;
    }
    return kept;
  }
}

/**
 * The links and embeds in a paragraph of a note: lines with no blank line
 * between them, or a single line. Spans are in order of their starts; an
 * embed inside a Markdown link's text comes after that link.
 */
export function paragraphLinks(text: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  const brackets = matchBrackets(text);
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      // An escaped character is never syntax.
      index += 2;
      continue;
    }
    if (char === "`") {
      const end = codeSpanEnd(text, index);
      if (end === undefined) {
        while (text[index] === "`") index++;
      } else {
        index = end;
      }
      continue;
    }
    if (char === "<") {
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
    if ((char === "h" || char === "w") && beforeAddress(text[index - 1])) {
      bareAddress.lastIndex = index;
      const found = bareAddress.exec(text);
      if (found !== null) {
        const address = trimmedAddress(found[0]);
        if (address.length > 0) {
          spans.push({
            start: index,
            end: index + address.length,
            embed: false,
            target: address,
          });
          index += address.length;
          continue;
        }
      }
    }
    const embed = char === "!" && text[index + 1] === "[";
    if (char !== "[" && !embed) {
      index++;
      continue;
    }
    const bracket = embed ? index + 1 : index;
    const found = linkAt(text, bracket, brackets);
    if (found === undefined) {
      index = bracket + 1;
      continue;
    }
    spans.push({ start: index, end: found.end, embed, target: found.target });
    // An embed inside a Markdown link's text, as an image that links.
    if (found.text !== undefined) {
      for (const inner of paragraphLinks(found.text.value)) {
        if (!inner.embed) continue;
        spans.push({
          ...inner,
          start: inner.start + found.text.offset,
          end: inner.end + found.text.offset,
        });
      }
    }
    index = found.end;
  }
  return spans;
}

/**
 * The link whose `[` is at `bracket`: where it ends, what it leads to, and a
 * Markdown link's text, with its offset. Undefined where Obsidian reads no
 * link, as for an empty one.
 */
function linkAt(
  text: string,
  bracket: number,
  brackets: ReadonlyMap<number, number>,
):
  | {
      end: number;
      target: string;
      text?: { value: string; offset: number };
    }
  | undefined {
  if (text[bracket + 1] === "[") {
    // A wiki link, on one line, holding no other.
    const lineEnd = text.indexOf("\n", bracket);
    const close = text.indexOf("]]", bracket + 2);
    const nested = text.indexOf("[[", bracket + 2);
    if (
      close !== -1 &&
      (lineEnd === -1 || close < lineEnd) &&
      (nested === -1 || nested > close)
    ) {
      const inner = text.slice(bracket + 2, close);
      // A table writes the | before an alias or size as \|.
      // One that names only a heading, [[#top]], leads within the note.
      if (inner.trim() === "") return undefined;
      const path = (inner.split(/[|#]/, 1)[0] ?? "").replace(/\\$/, "");
      return { end: close + 2, target: path };
    }
  }
  const close = brackets.get(bracket);
  if (close === undefined || text[close + 1] !== "(") return undefined;
  const found = destination(text, close + 1);
  if (found === undefined) return undefined;
  if (found.url === "") return undefined;
  return {
    end: found.end,
    target: withoutSubpath(decoded(unescaped(found.url))),
    text: { value: text.slice(bracket + 1, close), offset: bracket + 1 },
  };
}

/**
 * The links and embeds in a note's text, at their offsets in it, read a
 * paragraph at a time. A paragraph here is any run of lines without a blank
 * one, so a link is also read across a heading or a fence that Markdown
 * would end the paragraph at; that only ever moves an insertion later.
 */
export function textLinks(text: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  const lines = text.split("\n");
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
  for (const line of lines) {
    if (line.trim() === "") {
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
  let at = offset;
  // In order of their starts, a link comes before the embeds in its text.
  for (const span of textLinks(text)) {
    if (span.start < at && at < span.end) at = span.end;
  }
  return at;
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
