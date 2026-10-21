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
