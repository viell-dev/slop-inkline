// Finding symbols by name, reading, or translation as they are typed: where a
// trigger starts a name in a line of text, what a value is compared as, and how
// the symbols that match are ordered. Plain functions, so that unit tests can
// check them; suggest.ts shows them.

import type { SymbolText, TextField } from "../format/text.ts";

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
  /** How well it matches what was typed: higher is better. */
  readonly score: number;
  /** Whether its name matched, which comes first where the scores tie. */
  readonly byName: boolean;
  /** How often the note being written uses it. */
  readonly uses: number;
  /** When its file last changed, in milliseconds. */
  readonly modified: number;
}

/**
 * `candidates` in the order to offer them: the best match first, a name before
 * a value that matches as well, then those the note uses most, then the most
 * recently changed, then by name and path, so that the order never depends on
 * the vault's.
 */
export function rankSymbols<T extends Candidate>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.byName) - Number(a.byName) ||
      b.uses - a.uses ||
      b.modified - a.modified ||
      a.name.localeCompare(b.name) ||
      a.path.localeCompare(b.path),
  );
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

/** The fields a search looks through, in the order it prefers them. */
const textFields: readonly TextField[] = ["reading", "translation"];

/**
 * The marks Unicode keeps for any alphabet's letters: all that Latin, Greek, and
 * Cyrillic letters come apart into, and nothing that another living script's do.
 * They mark a letter that stays that letter to someone looking for it, and a
 * keyboard makes them hard, so `sa` finds `šá`. Every other script keeps its
 * marks in a block of its own, and there a mark makes another sound or spelling,
 * so it stays with its letter: the voicing of kana, the vowels of Indic scripts,
 * Thai, and Tibetan, and the points of Hebrew and Arabic.
 */
const accents =
  /[\u0300-\u036f]|[\u1ab0-\u1aff]|[\u1dc0-\u1dff]|[\u20d0-\u20f0]|[\ufe20-\ufe2f]/gu;

/** A mark that is part of its letter, looked for at one place in a key. */
const letterMark = new RegExp(`(?!${accents.source})\\p{M}`, "uy");

/** What picks a shape for a character, and says nothing of what it is. */
const selectors = /\p{Variation_Selector}/gu;

/**
 * A kana voicing mark written on its own, which comes apart into a space and the
 * mark. `は゛` is `ば`, so the space goes.
 */
const spacedVoicing = / ([\u3099\u309a])/gu;

/** A Cyrillic letter with the marks on it. */
const cyrillicMarked = /\p{Script=Cyrillic}\p{M}+/gu;

/**
 * The marks that can make a Cyrillic letter of another. The grave of `ѐ` and `ѝ`
 * is only stress, so it is not among them.
 */
const letterMaking = /[\u0301-\u030f]/u;

/**
 * A Cyrillic letter with a mark comes apart like an accented one but is a letter
 * of its own: `й` is not `и`, nor `ў` `у`, and each has its key. So each of
 * `marked`'s marks is tried on the letter, in the canonical order that `folded`
 * leaves them in, and those that make no letter stay after it: a stress mark on
 * a vowel, which still goes. Marks of one class stay in the order they were
 * written, and one blocks another from composing, so `normalize` alone keeps the
 * `й` of `и` with a breve and then a stress mark, and loses it the other way.
 * Of two that each make a letter, the first does.
 */
function composedLetter(marked: string): string {
  const [base = "", ...marks] = marked;
  let letter = base;
  const others = marks.filter((mark) => {
    const joined = letter + mark;
    const composed = joined.normalize("NFC");
    if (!letterMaking.test(mark) || composed === joined) return true;
    letter = composed;
    return false;
  });
  return letter + others.join("");
}

/**
 * `text` as a search compares it: in one form, and in one letter case. The
 * format fixes neither, so this is only ever a key, and the value stays as it
 * was written. Compatibility forms go too, so that `ﾀ` finds `タ`. A Hangul
 * syllable comes apart into the letters that spell it, so that `가` finds `각`,
 * which starts with it, and `ㄱ` finds both.
 */
function folded(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(selectors, "")
    .replace(spacedVoicing, "$1")
    .replace(cyrillicMarked, composedLetter);
}

/**
 * A symbol's text, ready to compare. Each field is one string, its values a
 * line each, so that a search looks through a symbol in one step for each
 * field, however many values a file packs into its list.
 */
export interface SearchableText {
  readonly text: SymbolText;
  readonly marked: Readonly<Record<TextField, string>>;
  /** The same without accents, such as a keyboard makes hard. */
  readonly plain: Readonly<Record<TextField, string>>;
}

export function searchableText(text: SymbolText): SearchableText {
  const marked = {
    reading: folded(text.reading.join("\n")),
    translation: folded(text.translation.join("\n")),
  };
  return {
    text,
    marked,
    plain: {
      reading: marked.reading.replace(accents, ""),
      translation: marked.translation.replace(accents, ""),
    },
  };
}

/** What a search looks for in values, from what was typed. */
export interface TextQuery {
  readonly needle: string;
  /**
   * Whether it holds accents. Typed without any, it finds a value with or
   * without them: `sa` finds `šá`. Typed with some, it asks for those: `šá`
   * does not find `sa`.
   */
  readonly marked: boolean;
}

/** What to look for, or undefined when nothing was typed. */
export function textQuery(typed: string): TextQuery | undefined {
  const needle = folded(typed);
  return needle.trim() === ""
    ? undefined
    : { needle, marked: needle.replace(accents, "") !== needle };
}

/** A value that holds what was typed, and the field it is in. */
export interface FoundText {
  readonly field: TextField;
  readonly value: string;
  /** The value as it was compared. */
  readonly key: string;
}

/**
 * Where `key` first holds `needle`, or -1. A match must not stop between a letter
 * and a mark that is part of it, which a key keeps apart: in code points `は` is
 * the start of `ば`, but nobody reads a part of `ば` as `は`.
 */
function whereHeld(key: string, needle: string): number {
  let at = key.indexOf(needle);
  while (at !== -1) {
    letterMark.lastIndex = at + needle.length;
    if (!letterMark.test(key)) return at;
    at = key.indexOf(needle, at + 1);
  }
  return -1;
}

/**
 * The value of `text` that best matches `query`, or undefined when none holds
 * it: one that is what was typed, then one that starts with it, then the first
 * that holds it, a reading before a translation.
 */
export function findText(
  text: SearchableText,
  query: TextQuery,
): FoundText | undefined {
  const { needle, marked } = query;
  let found: FoundText | undefined;
  let best = -1;
  for (const field of textFields) {
    const keys = (marked ? text.marked : text.plain)[field];
    if (!keys.includes(needle)) continue;
    keys.split("\n").forEach((key, index) => {
      const value = text.text[field][index];
      const at = whereHeld(key, needle);
      if (value === undefined || at === -1) return;
      const rank = at > 0 ? 0 : key.length === needle.length ? 2 : 1;
      if (rank <= best) return;
      best = rank;
      found = { field, value, key };
    });
  }
  return found;
}
