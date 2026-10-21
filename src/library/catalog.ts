// The symbol library's contents: every symbol in the vault, with the notes
// that use it, in order, and filtered by name and folder. The view in
// view.ts shows them.

import { holdsTyped } from "../notes/search.ts";

/** A symbol file as the catalog reads it. */
export interface SymbolFile {
  readonly path: string;
  /** Its name: the file's name without `.ink.png`. */
  readonly name: string;
  /** Its folder's path, `""` for the vault's top folder. */
  readonly folder: string;
}

/** A symbol in the library, with the notes that use it. */
export interface CatalogEntry extends SymbolFile {
  /** The paths of the notes that link to it, in order. */
  readonly notes: readonly string[];
}

/** Names and paths in the order a reader expects: numbers by value. */
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Compares two strings by `collator`, then exactly, so that order is total. */
function compare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The library's entries for `files`: each with the notes that link to it,
 * as Obsidian's `resolvedLinks` gives them, from each note's path to the
 * paths it links to and how often. Ordered by folder, the top folder first,
 * then by name, numbers by value: `2` before `10`.
 */
export function catalog(
  files: readonly SymbolFile[],
  resolvedLinks: Readonly<Record<string, Readonly<Record<string, number>>>>,
): CatalogEntry[] {
  const notes = new Map<string, string[]>();
  for (const [note, targets] of Object.entries(resolvedLinks)) {
    for (const [target, count] of Object.entries(targets)) {
      if (count <= 0) continue;
      const users = notes.get(target);
      if (users === undefined) notes.set(target, [note]);
      else users.push(note);
    }
  }
  return files
    .map((file) => ({
      ...file,
      notes: (notes.get(file.path) ?? []).sort(compare),
    }))
    .sort(
      (a, b) =>
        compare(a.folder, b.folder) ||
        compare(a.name, b.name) ||
        compare(a.path, b.path),
    );
}

/** The folders that hold symbols, in the library's order. */
export function foldersOf(entries: readonly CatalogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.folder))].sort(compare);
}

/**
 * The entries whose names hold `query`, in any letter case, in `folder`,
 * or in any folder when it is undefined; all of them for an empty query.
 */
export function filterCatalog(
  entries: readonly CatalogEntry[],
  query: string,
  folder: string | undefined,
): CatalogEntry[] {
  const typed = query.normalize("NFC").trim();
  return entries.filter(
    (entry) =>
      (folder === undefined || entry.folder === folder) &&
      (typed === "" || holdsTyped(entry.name.normalize("NFC"), typed)),
  );
}
