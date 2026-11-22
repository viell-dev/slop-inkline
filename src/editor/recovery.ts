// Drafts that no editor can offer: a symbol's draft whose file is gone or does
// not open, as an editor offers a draft only for a file that opens at the
// path the draft was kept for, and a new symbol's draft whose note is gone, as
// only a new symbol started in that note offers it. Which drafts they are, the
// name a new symbol made of one starts with, and what Inkline says of one.
// Plain functions with unit tests; symbols.ts reads the files and opens the
// editor.

import { symbolStem } from "../notes/names.ts";
import type { CreatedFile, Draft } from "./drafts.ts";

/**
 * Why no editor offers a draft: the file it was kept for, or for a new
 * symbol's draft its note, is gone, or the file does not open.
 */
export type Unopened =
  | { readonly kind: "gone" }
  | {
      readonly kind: "unreadable";
      /** Why, as a clause after "does not open:", with no full stop. */
      readonly reason: string;
    };

/** A draft that no editor offers, as {@link Unopened} says. */
export interface Orphan {
  readonly draft: Draft;
  /**
   * The path of the file it was kept for, or for a new symbol's draft, of the
   * note it was started in.
   */
  readonly path: string;
  readonly unopened: Unopened;
}

/** What `path`'s file is, for a draft kept for it: undefined if it opens. */
export type FileState = (path: string) => Promise<Unopened | undefined>;

/**
 * The drafts among `drafts` that no editor offers, in the order given: one
 * kept for a symbol's file that is gone or does not open, as `state` tells,
 * which is asked once for each path, and a new symbol's draft whose note is
 * gone, as `noteGone` tells.
 */
export async function findOrphans(
  drafts: readonly Draft[],
  state: FileState,
  noteGone: (path: string) => boolean,
): Promise<Orphan[]> {
  const states = new Map<string, Unopened | undefined>();
  const orphans: Orphan[] = [];
  for (const draft of drafts) {
    const { target } = draft;
    if (target.kind === "new") {
      if (noteGone(target.note)) {
        orphans.push({ draft, path: target.note, unopened: { kind: "gone" } });
      }
      continue;
    }
    const { path } = target;
    if (!states.has(path)) states.set(path, await state(path));
    const unopened = states.get(path);
    if (unopened !== undefined) orphans.push({ draft, path, unopened });
  }
  return orphans;
}

/** What follows the last `/` of a path, or all of it. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The folder of a vault path, `""` for the vault's top. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** The file a new symbol's draft names as its first save's, if any. */
export function createdFile(orphan: Orphan): CreatedFile | undefined {
  const { target } = orphan.draft;
  return target.kind === "new" ? target.file : undefined;
}

/**
 * The name a new symbol made of an orphan starts with: the name typed in its
 * draft, as it was typed. Otherwise, for a symbol's draft, the file's own name,
 * unless `taken` says its folder has a symbol of that name, as when the file
 * that does not open is still there; and for a new symbol's draft, none. With
 * none, the first save takes the next number, or for a new symbol's draft
 * whose first save made a file, keeps that file's name.
 */
export function recoveredName(
  orphan: Orphan,
  taken: (name: string) => boolean,
): string | undefined {
  const { draft, path } = orphan;
  if (draft.name !== undefined) return draft.name;
  if (draft.target.kind === "new") return undefined;
  const own = symbolStem(fileName(path));
  return own === undefined || taken(own) ? undefined : own;
}

/** What the list of drafts calls an orphan's symbol. */
export function orphanName(orphan: Orphan): string {
  const { draft, path } = orphan;
  if (draft.target.kind === "file") {
    const file = fileName(path);
    return symbolStem(file) ?? file;
  }
  const made = createdFile(orphan);
  const name =
    draft.name ??
    (made === undefined ? undefined : symbolStem(fileName(made.path)));
  return name === undefined || name.trim() === "" ? "New symbol" : name;
}

/** Where the list of drafts says an orphan's symbol was. */
export function orphanPlace(orphan: Orphan): string {
  return orphan.draft.target.kind === "new"
    ? `Started in ${orphan.path}`
    : folderOf(orphan.path);
}

/** What the list of drafts says of why one is listed. */
export function whyListed(orphan: Orphan): string {
  const { draft, unopened } = orphan;
  if (draft.target.kind === "new") return "Its note was deleted or moved";
  return unopened.kind === "gone"
    ? "Deleted or moved"
    : `Does not open: ${unopened.reason}`;
}

/** `text` as a sentence, with a full stop unless it ends with one. */
function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** A folder as a question names it. */
function folderText(folder: string): string {
  return folder === "" ? "the vault's top folder" : folder;
}

/**
 * The question that offers to open an orphan as a new symbol, with the time
 * its draft was kept as `keptAt` gives it: what happened to the file or the
 * note, where the new symbol goes, and what of the drawing does not come back.
 */
export function recoveryQuestion(
  orphan: Orphan,
  keptAt: string,
): { readonly title: string; readonly content: string } {
  const { draft, path, unopened } = orphan;
  const base =
    draft.base.kind === "file"
      ? " Its base layer was in that file, so only its strokes would come back."
      : draft.base.kind === "lost"
        ? " Its base layer cannot be read, so only its strokes would come back."
        : "";
  const title = "Open the unsaved drawing as a new symbol?";
  if (draft.target.kind === "new") {
    const note = fileName(path).replace(/\.md$/i, "");
    const made = createdFile(orphan);
    const where =
      made === undefined
        ? "They can open in a new symbol, saved where new symbols go, and inserted in no note."
        : `They can open in a new symbol, saved in ${folderText(folderOf(made.path))} and inserted in no note. Its first save made ${fileName(made.path)}: saving writes over that file if nothing changed it since, and otherwise makes another beside it.`;
    return {
      title,
      content: `${note}, the note a new symbol was started in, is no longer in the vault, but Inkline kept the symbol's unsaved drawing from ${keptAt}. ${where}${base}`,
    };
  }
  const name = fileName(path);
  const what =
    unopened.kind === "gone"
      ? `${name} is no longer in the vault, but Inkline kept unsaved changes to it from ${keptAt}.`
      : `${sentence(`${name} does not open: ${unopened.reason}`)} Inkline kept unsaved changes to it from ${keptAt}.`;
  const leaves = unopened.kind === "gone" ? "" : `, and ${name} stays as it is`;
  return {
    title,
    content: `${what} They can open in a new symbol, saved in ${folderText(folderOf(path))}${leaves}.${base}`,
  };
}
