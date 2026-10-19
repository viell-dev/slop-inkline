// Drafts: unsaved strokes kept in the vault's local storage, so that a crash,
// a reload, or disabling the plugin does not lose them. Each editor writes
// only its own draft, under its own id, and says which symbol it belongs to;
// the next editor for that symbol offers it back.

import {
  formatName,
  formatVersion,
  parseRecord,
  type Stroke,
} from "../format/record.ts";
import type { InkDocument } from "../ink/document.ts";
import { lineBox } from "../ink/geometry.ts";

/** The symbol a draft belongs to: a file, or a new one in a note. */
export type DraftTarget =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "new"; readonly note: string };

export interface Draft {
  /** The editor session that wrote it. */
  readonly id: string;
  readonly target: DraftTarget;
  readonly strokes: readonly Stroke[];
  /** Whether the document's base layer was cleared. */
  readonly baseCleared: boolean;
  /**
   * A fingerprint of the file the strokes line up with, from when it was
   * opened or last saved, or undefined for a symbol not saved yet.
   */
  readonly fingerprint?: string;
  /** When it was kept, in milliseconds since 1970. */
  readonly savedAt: number;
}

/** How long a draft is kept before it is dropped unrestored: 30 days. */
export const draftLifetime = 30 * 24 * 60 * 60 * 1000;

const indexKey = "inkline-drafts";
const draftPrefix = "inkline-draft:";

/** Local storage for one vault, as Obsidian's `App` offers it. */
export interface VaultStorage {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTarget(value: unknown): DraftTarget | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "file" && typeof value.path === "string") {
    return { kind: "file", path: value.path };
  }
  if (value.kind === "new" && typeof value.note === "string") {
    return { kind: "new", note: value.note };
  }
  return undefined;
}

/** Reads a stored draft, checking it as strictly as a record. */
export function decodeDraft(value: unknown): Draft | undefined {
  if (!isRecord(value)) return undefined;
  const { id, target, strokes, baseCleared, fingerprint, savedAt, version } =
    value;
  const parsedTarget = parseTarget(target);
  if (
    version !== formatVersion ||
    typeof id !== "string" ||
    parsedTarget === undefined ||
    typeof baseCleared !== "boolean" ||
    (fingerprint !== undefined && typeof fingerprint !== "string") ||
    typeof savedAt !== "number" ||
    !Number.isFinite(savedAt)
  ) {
    return undefined;
  }
  // The strokes go through the record's checks, in a box that fits any.
  const parsed = parseRecord(
    JSON.stringify({
      format: formatName,
      version: formatVersion,
      box: { ...lineBox, width: lineBox.height },
      strokes,
    }),
  );
  if (!parsed.ok) return undefined;
  return {
    id,
    target: parsedTarget,
    strokes: parsed.record.strokes,
    baseCleared,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    savedAt,
  };
}

function encodeDraft(draft: Draft): Record<string, unknown> {
  return { version: formatVersion, ...draft };
}

/** Whether two targets name the same symbol. */
export function sameTarget(a: DraftTarget, b: DraftTarget): boolean {
  return a.kind === "file" && b.kind === "file"
    ? a.path === b.path
    : a.kind === "new" && b.kind === "new" && a.note === b.note;
}

/** The document a draft restores onto the file's own document. */
export function restoreDraft(original: InkDocument, draft: Draft): InkDocument {
  return draft.baseCleared || original.base === undefined
    ? { strokes: draft.strokes }
    : { strokes: draft.strokes, base: original.base };
}

/** The drafts of one vault, with an index of their ids. */
export class DraftStore {
  readonly #storage: VaultStorage;
  readonly #now: () => number;

  constructor(storage: VaultStorage, now: () => number = Date.now) {
    this.#storage = storage;
    this.#now = now;
  }

  #ids(): string[] {
    const ids = this.#storage.loadLocalStorage(indexKey);
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  }

  #setIds(ids: readonly string[]): void {
    this.#storage.saveLocalStorage(indexKey, ids.length === 0 ? null : ids);
  }

  /** Every readable draft, newest first, dropping expired and broken ones. */
  list(): Draft[] {
    const drafts: Draft[] = [];
    const kept: string[] = [];
    for (const id of this.#ids()) {
      const draft = decodeDraft(
        this.#storage.loadLocalStorage(draftPrefix + id),
      );
      if (draft?.id !== id || this.#now() - draft.savedAt > draftLifetime) {
        this.#storage.saveLocalStorage(draftPrefix + id, null);
        continue;
      }
      kept.push(id);
      drafts.push(draft);
    }
    this.#setIds(kept);
    return drafts.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** The drafts for a symbol, newest first, other than `exceptId`'s. */
  forTarget(target: DraftTarget, exceptId?: string): Draft[] {
    return this.list().filter(
      (draft) => draft.id !== exceptId && sameTarget(draft.target, target),
    );
  }

  put(draft: Draft): void {
    this.#storage.saveLocalStorage(draftPrefix + draft.id, encodeDraft(draft));
    const ids = this.#ids();
    if (!ids.includes(draft.id)) this.#setIds([...ids, draft.id]);
  }

  remove(id: string): void {
    this.#storage.saveLocalStorage(draftPrefix + id, null);
    this.#setIds(this.#ids().filter((other) => other !== id));
  }

  /** Follows a rename: drafts for the file, or new ones in the note, move. */
  rename(from: string, to: string): void {
    for (const draft of this.list()) {
      const { target } = draft;
      if (target.kind === "file" && target.path === from) {
        this.put({ ...draft, target: { kind: "file", path: to } });
      } else if (target.kind === "new" && target.note === from) {
        this.put({ ...draft, target: { kind: "new", note: to } });
      }
    }
  }
}

/** A fingerprint of a file's bytes, to tell whether it changed: SHA-256. */
export async function fingerprintOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
