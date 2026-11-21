// Drafts whose symbol's file is gone or does not open, which no editor can
// offer, as an editor offers a draft only for a file that opens at the path
// the draft was kept for: which drafts they are, the name a new symbol made
// of one starts with, and what Inkline says of one. Plain functions with unit
// tests; symbols.ts reads the files and opens the editor.

import { symbolStem } from "../notes/names.ts";
import type { Draft } from "./drafts.ts";

/** Why the file a draft was kept for does not open in an editor. */
export type Unopened =
  | { readonly kind: "gone" }
  | {
      readonly kind: "unreadable";
      /** Why, as a clause after "does not open:", with no full stop. */
      readonly reason: string;
    };

/** A draft kept for a symbol's file that is gone or does not open. */
export interface Orphan {
  readonly draft: Draft;
  /** The path of the file it was kept for. */
  readonly path: string;
  readonly unopened: Unopened;
}

/** What `path`'s file is, for a draft kept for it: undefined if it opens. */
export type FileState = (path: string) => Promise<Unopened | undefined>;

/**
 * The drafts among `drafts` that were kept for a symbol's file that is gone
 * or does not open, as `state` tells, in the order given. A new symbol's
 * draft is not one: its note offers it as a new symbol is started there.
 * `state` is asked once for each path.
 */
export async function findOrphans(
  drafts: readonly Draft[],
  state: FileState,
): Promise<Orphan[]> {
  const states = new Map<string, Unopened | undefined>();
  const orphans: Orphan[] = [];
  for (const draft of drafts) {
    if (draft.target.kind !== "file") continue;
    const { path } = draft.target;
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

/**
 * The name a new symbol made of `draft`, kept for the file at `path`, starts
 * with: the name typed in the draft, as it was typed, or else the file's own,
 * unless `taken` says its folder has a symbol of that name, as when the file
 * that does not open is still there. Then none, so that the first save takes
 * the next number rather than being refused.
 */
export function recoveredName(
  draft: Draft,
  path: string,
  taken: (name: string) => boolean,
): string | undefined {
  if (draft.name !== undefined) return draft.name;
  const own = symbolStem(fileName(path));
  return own === undefined || taken(own) ? undefined : own;
}

/** What the list of drafts says of why one is listed. */
export function unopenedText(unopened: Unopened): string {
  return unopened.kind === "gone"
    ? "Deleted or moved"
    : `Does not open: ${unopened.reason}`;
}

/** `text` as a sentence, with a full stop unless it ends with one. */
function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/**
 * The question that offers to open an orphan as a new symbol, with the time
 * its draft was kept as `keptAt` gives it: what happened to the file, where
 * the new symbol goes, and what of the drawing does not come back.
 */
export function recoveryQuestion(
  orphan: Orphan,
  keptAt: string,
): { readonly title: string; readonly content: string } {
  const { draft, path, unopened } = orphan;
  const name = fileName(path);
  const folder = folderOf(path);
  const what =
    unopened.kind === "gone"
      ? `${name} is no longer in the vault, but Inkline kept unsaved changes to it from ${keptAt}.`
      : `${sentence(`${name} does not open: ${unopened.reason}`)} Inkline kept unsaved changes to it from ${keptAt}.`;
  const where = folder === "" ? "the vault's top folder" : folder;
  const leaves = unopened.kind === "gone" ? "" : `, and ${name} stays as it is`;
  const base =
    draft.base.kind === "file"
      ? " Its base layer was in that file, so only its strokes would come back."
      : draft.base.kind === "lost"
        ? " Its base layer cannot be read, so only its strokes would come back."
        : "";
  return {
    title: "Open the unsaved drawing as a new symbol?",
    content: `${what} They can open in a new symbol, saved in ${where}${leaves}.${base}`,
  };
}
