// Finding links and embeds in a note's text, as Obsidian reads them, so that
// a symbol is never inserted inside one, and the embed under the cursor can
// be told apart. Plain functions with unit tests; they read a line at a time,
// since no link spans a line break.

/** A link or embed in a note's text. */
export interface LinkSpan {
  /** Where it starts, at the `!` of an embed, and just past where it ends. */
  readonly start: number;
  readonly end: number;
  /** Whether it is an embed, `![[...]]` or `![...](...)`. */
  readonly embed: boolean;
  /**
   * What it links to, as written: a wiki link's text before any `#` or `|`,
   * or a Markdown link's destination with its percent-escapes decoded.
   */
  readonly target: string;
}

/** The end of the code span that starts at `at`, or undefined if it never ends. */
function codeSpanEnd(line: string, at: number): number | undefined {
  let run = 0;
  while (line[at + run] === "`") run++;
  const fence = "`".repeat(run);
  let search = at + run;
  for (;;) {
    const close = line.indexOf(fence, search);
    if (close === -1) return undefined;
    // A longer run of backticks does not close a shorter one.
    let length = 0;
    while (line[close + length] === "`") length++;
    if (length === run) return close + run;
    search = close + length;
  }
}

/** The index of the `]` that closes the `[` at `at`, if the line has one. */
function closingBracket(line: string, at: number): number | undefined {
  let depth = 0;
  for (let index = at; index < line.length; index++) {
    const char = line[index];
    if (char === "\\") {
      index++;
    } else if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

/** `text` with percent-escapes decoded where they can be. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // A bare % is a character.
    return text;
  }
}

/**
 * The destination of the Markdown link whose `(` is at `at`, and the index
 * just past its `)`: an angle-bracketed destination, or one whose own
 * parentheses balance, then an optional title.
 */
function destination(
  line: string,
  at: number,
): { url: string; end: number } | undefined {
  let index = at + 1;
  while (line[index] === " ") index++;
  let url: string;
  if (line[index] === "<") {
    const close = line.indexOf(">", index + 1);
    if (close === -1) return undefined;
    url = line.slice(index + 1, close);
    index = close + 1;
  } else {
    const start = index;
    let depth = 0;
    for (; index < line.length; index++) {
      const char = line[index];
      if (char === "\\") {
        index++;
      } else if (char === "(") {
        depth++;
      } else if (char === ")") {
        if (depth === 0) break;
        depth--;
      } else if (char === " ") {
        break;
      }
    }
    url = line.slice(start, index);
  }
  while (line[index] === " ") index++;
  // An optional title, in quotes or parentheses.
  const quote = line[index];
  if (quote === '"' || quote === "'" || quote === "(") {
    const closer = quote === "(" ? ")" : quote;
    const close = line.indexOf(closer, index + 1);
    if (close === -1) return undefined;
    index = close + 1;
    while (line[index] === " ") index++;
  }
  if (line[index] !== ")") return undefined;
  return { url, end: index + 1 };
}

/** The links and embeds in one line of a note, in order. */
export function lineLinks(line: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === "\\") {
      // An escaped character is never syntax.
      index += 2;
      continue;
    }
    if (char === "`") {
      const end = codeSpanEnd(line, index);
      if (end === undefined) {
        while (line[index] === "`") index++;
      } else {
        index = end;
      }
      continue;
    }
    if (char !== "[") {
      index++;
      continue;
    }
    // An escaped ! is a character before a link, not an embed's.
    const embed =
      index > 0 && line[index - 1] === "!" && line[index - 2] !== "\\";
    const start = embed ? index - 1 : index;
    if (line[index + 1] === "[") {
      const close = line.indexOf("]]", index + 2);
      if (close !== -1) {
        const inner = line.slice(index + 2, close);
        spans.push({
          start,
          end: close + 2,
          embed,
          target: inner.split(/[|#]/, 1)[0] ?? "",
        });
        index = close + 2;
        continue;
      }
    }
    const close = closingBracket(line, index);
    if (close !== undefined && line[close + 1] === "(") {
      const found = destination(line, close + 1);
      if (found !== undefined) {
        spans.push({
          start,
          end: found.end,
          embed,
          target: decoded(found.url),
        });
        index = found.end;
        continue;
      }
    }
    index++;
  }
  return spans;
}

/** The links and embeds in a note's text, at their offsets in it. */
export function textLinks(text: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    for (const span of lineLinks(line)) {
      spans.push({
        ...span,
        start: span.start + offset,
        end: span.end + offset,
      });
    }
    offset += line.length + 1;
  }
  return spans;
}

/**
 * Where to insert at `offset` in `text` without splitting a link or embed:
 * `offset` itself, or, inside one, just past its end.
 */
export function outsideLinks(text: string, offset: number): number {
  const inside = textLinks(text).find(
    (span) => span.start < offset && offset < span.end,
  );
  return inside === undefined ? offset : inside.end;
}

/**
 * The embed at `offset` in `text`, with the offset on it or at either of its
 * ends, as a cursor right after an embed is; undefined when there is none.
 */
export function embedAt(text: string, offset: number): LinkSpan | undefined {
  return textLinks(text).find(
    (span) => span.embed && span.start <= offset && offset <= span.end,
  );
}
