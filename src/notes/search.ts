// Finding symbols by name as they are typed: where a trigger starts a name in
// a line of text, and how the symbols that match it are ordered. Plain
// functions, so that unit tests can check them; suggest.ts shows them.

/** What starts typing a symbol's name in a note, as `;;tower`. */
export const defaultTrigger = ";;";

/** The longest name typed after a trigger that is still looked up. */
const maxQuery = 64;

/**
 * Where a trigger starts a symbol's name before column `ch` of `line`: the
 * trigger's column, and what is typed after it up to `ch`. Undefined when no
 * trigger comes before, or what follows it cannot be a name being typed: a
 * space straight after the trigger, link syntax (`[`, `]`, `|`), or more
 * than a long name's worth of text.
 */
export function triggerQuery(
  line: string,
  ch: number,
  trigger: string,
): { start: number; query: string } | undefined {
  if (trigger === "") return undefined;
  const before = line.slice(0, ch);
  const start = before.lastIndexOf(trigger);
  if (start < 0) return undefined;
  const query = before.slice(start + trigger.length);
  if (query.length > maxQuery || query.startsWith(" ")) return undefined;
  if (/[[\]|]/.test(query)) return undefined;
  return { start, query };
}

/** A symbol that matched what was typed, with what ranks it. */
export interface Candidate {
  /** Its name: the file's name without `.ink.png`. */
  readonly name: string;
  readonly path: string;
  /** How well the name matches what was typed: higher is better. */
  readonly score: number;
  /** How often the note being written uses it. */
  readonly uses: number;
  /** When its file last changed, in milliseconds. */
  readonly modified: number;
}

/**
 * `candidates` in the order to offer them: the best match first, then those
 * the note uses most, then the most recently changed, then by name and path,
 * so that the order never depends on the vault's.
 */
export function rankSymbols<T extends Candidate>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      b.uses - a.uses ||
      b.modified - a.modified ||
      a.name.localeCompare(b.name) ||
      a.path.localeCompare(b.path),
  );
}

/**
 * Whether column `ch` of `line` lies inside a code span: between a run of
 * backticks and the next run of the same length. A run that never closes is
 * text, as Markdown reads it.
 */
export function insideCodeSpan(line: string, ch: number): boolean {
  let index = 0;
  while (index < line.length && index < ch) {
    if (line[index] === "\\") {
      index += 2;
      continue;
    }
    if (line[index] !== "`") {
      index++;
      continue;
    }
    let run = 0;
    while (line[index + run] === "`") run++;
    const fence = "`".repeat(run);
    let close = line.indexOf(fence, index + run);
    // A longer run of backticks does not close a shorter one.
    while (close !== -1 && line[close + run] === "`") {
      let longer = run;
      while (line[close + longer] === "`") longer++;
      close = line.indexOf(fence, close + longer);
    }
    if (close === -1) {
      index += run;
      continue;
    }
    if (ch > index && ch <= close) return true;
    index = close + run;
  }
  return false;
}

/**
 * Whether a symbol's `name` matches what was typed after the trigger with a
 * space in it: only by containing it, in any letter case. A fuzzy match
 * would skip the space, so that the words of a sentence after a trigger
 * could still match a name.
 */
export function holdsTyped(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase());
}

/** Whether `text` is a line of front matter's opening or closing `---`. */
function isFrontMatterFence(text: string | undefined): boolean {
  return text?.trimEnd() === "---";
}

/**
 * Whether line `line` of a note lies in its front matter or in a fenced
 * code block, where text such as a trigger is the note's own. `lineAt`
 * gives the note's lines as it is now, as the metadata cache, which follows
 * saves, may not yet, and undefined past its end, with or without a `\r`
 * at their ends; only the lines up to `line` are read, and the front
 * matter's. A fence's own lines are code, the info string after an opening
 * fence included. A fence may follow a quote's `>` markers or indentation;
 * one left open runs to the end of the note, as Markdown reads it. An
 * indented code block is not told apart from a list item's indented text,
 * and counts as text.
 */
export function insideCodeBlock(
  lineAt: (index: number) => string | undefined,
  line: number,
): boolean {
  let from = 0;
  if (isFrontMatterFence(lineAt(0))) {
    let end = 1;
    while (lineAt(end) !== undefined && !isFrontMatterFence(lineAt(end))) {
      end++;
    }
    if (lineAt(end) !== undefined) {
      if (line <= end) return true;
      from = end + 1;
    }
  }
  let fence: { mark: string; length: number } | undefined;
  for (let index = from; index <= line; index++) {
    // The line itself is code inside an open fence, its closing fence too,
    // and is code too if it opens one.
    if (index === line && fence !== undefined) return true;
    const text = (lineAt(index) ?? "")
      .replace(/\r$/, "")
      .replace(/^(?:\s*>)*\s*/, "");
    const run = /^(`{3,}|~{3,})(.*)$/.exec(text);
    if (run === null) continue;
    const marks = run[1] ?? "";
    const rest = run[2] ?? "";
    const mark = marks.charAt(0);
    if (fence === undefined) {
      // A backtick fence's info string holds no backticks.
      if (mark === "`" && rest.includes("`")) continue;
      fence = { mark, length: marks.length };
    } else if (
      mark === fence.mark &&
      marks.length >= fence.length &&
      rest.trim() === ""
    ) {
      fence = undefined;
    }
  }
  return fence !== undefined;
}
