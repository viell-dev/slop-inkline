// The list of drafts: every draft that no open editor holds, by what choosing
// it does. A symbol's draft whose file opens comes back by opening that
// symbol, whose editor offers it. Any other comes back as a new symbol: a
// symbol's draft whose file is gone or does not open, as an editor offers a
// draft only for a file that opens at the path the draft was kept for, and a
// new symbol's draft, whether its note is gone or there, as the draft does not
// say where in the note the symbol was to go. Which drafts they are, the name
// a new symbol made of one starts with, and what Inkline says of each. Plain
// functions with unit tests; symbols.ts reads the files and opens the editor.

import type { InkDocument } from "../ink/document.ts";
import { symbolStem } from "../notes/names.ts";
import { restoresNothing, type CreatedFile, type Draft } from "./drafts.ts";

/**
 * Why a draft's own symbol does not offer it: the file it was kept for, or for
 * a new symbol's draft its note, is gone, or the file does not open.
 */
export type Unopened =
  | { readonly kind: "gone" }
  | {
      readonly kind: "unreadable";
      /** Why, as a clause after "does not open:", with no full stop. */
      readonly reason: string;
    };

/** What the file at a path is, for a draft kept for it. */
export type FileState =
  | {
      readonly kind: "opens";
      /** What its editor opens with. */
      readonly document: InkDocument;
      /** The name its editor's name field starts with. */
      readonly name: string;
    }
  /** Saved by a newer version of Inkline, which this one does not edit. */
  | { readonly kind: "newer" }
  | Unopened;

/**
 * A draft that opens as a new symbol, and why: the file it was kept for is
 * gone or does not open, as `unopened` says, or for a new symbol's draft, the
 * note it was started in is gone, or, with `unopened` undefined, is there.
 */
export interface AsNewSymbol {
  readonly draft: Draft;
  /**
   * The path of the file it was kept for, or for a new symbol's draft, of the
   * note it was started in.
   */
  readonly path: string;
  readonly unopened: Unopened | undefined;
}

/**
 * A draft in the list of drafts, by what choosing it does: open the symbol at
 * `path`, whose editor offers it, or for one that a newer version of Inkline
 * saved, says to update Inkline; or open it as a new symbol.
 */
export type Listed =
  | {
      readonly opens: "symbol";
      readonly draft: Draft;
      readonly path: string;
      readonly newer: boolean;
    }
  | ({ readonly opens: "new" } & AsNewSymbol);

/**
 * Every draft among `drafts`, in the order given, by what choosing it in the
 * list of drafts does, as {@link Listed} says: `state` tells what the file of
 * a symbol's draft is, and is asked once for each path, and `noteGone` whether
 * a new symbol's note is gone. A symbol's draft that would bring back nothing
 * its file lacks, as {@link restoresNothing} says, is left out, as opening the
 * symbol drops it.
 */
export async function listDrafts(
  drafts: readonly Draft[],
  state: (path: string) => Promise<FileState>,
  noteGone: (path: string) => boolean,
): Promise<Listed[]> {
  const states = new Map<string, FileState>();
  const listed: Listed[] = [];
  for (const draft of drafts) {
    const { target } = draft;
    if (target.kind === "new") {
      const { note } = target;
      listed.push({
        opens: "new",
        draft,
        path: note,
        unopened: noteGone(note) ? { kind: "gone" } : undefined,
      });
      continue;
    }
    const { path } = target;
    let found = states.get(path);
    if (found === undefined) {
      found = await state(path);
      states.set(path, found);
    }
    if (found.kind === "opens") {
      if (!restoresNothing(draft, found.document, found.name)) {
        listed.push({ opens: "symbol", draft, path, newer: false });
      }
    } else if (found.kind === "newer") {
      listed.push({ opens: "symbol", draft, path, newer: true });
    } else {
      listed.push({ opens: "new", draft, path, unopened: found });
    }
  }
  return listed;
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
export function createdFile({ target }: Draft): CreatedFile | undefined {
  return target.kind === "new" ? target.file : undefined;
}

/**
 * The name a new symbol made of a draft starts with: the name typed in the
 * draft, as it was typed. Otherwise, for a symbol's draft, the file's own name,
 * unless `taken` says its folder has a symbol of that name, as when the file
 * that does not open is still there; and for a new symbol's draft, none. With
 * none, the first save takes the next number, or for a new symbol's draft
 * whose first save made a file, keeps that file's name.
 */
export function recoveredName(
  { draft, path }: AsNewSymbol,
  taken: (name: string) => boolean,
): string | undefined {
  if (draft.name !== undefined) return draft.name;
  if (draft.target.kind === "new") return undefined;
  const own = symbolStem(fileName(path));
  return own === undefined || taken(own) ? undefined : own;
}

/** What the list of drafts calls a draft's symbol. */
export function listedName({ draft, path }: Listed): string {
  if (draft.target.kind === "file") {
    const file = fileName(path);
    return symbolStem(file) ?? file;
  }
  const made = createdFile(draft);
  const name =
    draft.name ??
    (made === undefined ? undefined : symbolStem(fileName(made.path)));
  return name === undefined || name.trim() === "" ? "New symbol" : name;
}

/**
 * What the list of drafts finds a draft by, as a search goes: the name it
 * shows, the path of the file or note it was kept for, and the file its first
 * save made, if any.
 */
export function listedSearchTexts(listed: Listed): string[] {
  const made = createdFile(listed.draft);
  return [
    listedName(listed),
    listed.path,
    ...(made === undefined ? [] : [made.path]),
  ];
}

/** Where the list of drafts says a draft's symbol was. */
export function listedPlace({ draft, path }: Listed): string {
  return draft.target.kind === "new" ? `Started in ${path}` : folderOf(path);
}

/** `text` as a sentence, with a full stop unless it ends with one. */
function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/**
 * What the list of drafts says of a draft kept at `keptAt`, the time as the
 * person reads times: what became of its symbol, and what choosing it does.
 */
export function listedDetail(listed: Listed, keptAt: string): string {
  const kept = `Kept ${keptAt}.`;
  if (listed.opens === "symbol") {
    return listed.newer
      ? `${kept} Its file is from a newer version of Inkline: update Inkline, then open it to restore its unsaved changes.`
      : `${kept} Opens the symbol, to restore its unsaved changes.`;
  }
  const { draft, unopened } = listed;
  if (draft.target.kind === "new") {
    return unopened === undefined
      ? `${kept} Opens the unsaved drawing as a new symbol, inserted in no note.`
      : `${kept} Its note was deleted or moved: opens the unsaved drawing as a new symbol, inserted in no note.`;
  }
  return unopened?.kind === "unreadable"
    ? `${kept} ${sentence(`Its file does not open: ${unopened.reason}`)} Opens its unsaved changes as a new symbol.`
    : `${kept} Its file was deleted or moved: opens its unsaved changes as a new symbol.`;
}

/** A folder as a question names it. */
function folderText(folder: string): string {
  return folder === "" ? "the vault's top folder" : folder;
}

/**
 * The question that offers to open a draft as a new symbol, with the time it
 * was kept as `keptAt` gives it: what happened to the file or the note, where
 * the new symbol goes, how to put a new symbol's in a note, and what of the
 * drawing does not come back.
 */
export function recoveryQuestion(
  { draft, path, unopened }: AsNewSymbol,
  keptAt: string,
): { readonly title: string; readonly content: string } {
  const base =
    draft.base.kind === "file"
      ? " Its base layer was in that file, so only its strokes would come back."
      : draft.base.kind === "lost"
        ? " Its base layer cannot be read, so only its strokes would come back."
        : "";
  const title = "Open the unsaved drawing as a new symbol?";
  if (draft.target.kind === "new") {
    const note = fileName(path).replace(/\.md$/i, "");
    const made = createdFile(draft);
    const what =
      unopened === undefined
        ? `Inkline kept the unsaved drawing of a new symbol started in ${note}, from ${keptAt}.`
        : `${note}, the note a new symbol was started in, is no longer in the vault, but Inkline kept the symbol's unsaved drawing from ${keptAt}.`;
    const where =
      made === undefined
        ? "It can open in a new symbol, saved where new symbols go, and inserted in no note."
        : `It can open in a new symbol, saved in ${folderText(folderOf(made.path))} and inserted in no note. Its first save made ${fileName(made.path)}: saving writes over that file if nothing changed it since, and otherwise makes another beside it.`;
    return {
      title,
      content: `${what} ${where} Once it is saved, run Inkline: Insert existing symbol with the cursor where you want it.${base}`,
    };
  }
  const name = fileName(path);
  const what =
    unopened?.kind === "unreadable"
      ? `${sentence(`${name} does not open: ${unopened.reason}`)} Inkline kept unsaved changes to it from ${keptAt}.`
      : `${name} is no longer in the vault, but Inkline kept unsaved changes to it from ${keptAt}.`;
  const leaves =
    unopened?.kind === "unreadable" ? `, and ${name} stays as it is` : "";
  return {
    title,
    content: `${what} They can open in a new symbol, saved in ${folderText(folderOf(path))}${leaves}.${base}`,
  };
}
