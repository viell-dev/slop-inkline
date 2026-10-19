// Drafts: unsaved strokes kept in the vault's local storage, so that a crash,
// a reload, or disabling the plugin does not lose them. Each editor writes
// only its own draft, under its own id, and says which symbol it belongs to;
// the next editor for that symbol offers it back.

import {
  parseRecord,
  recordValue,
  type BaseLayer,
  type Stroke,
} from "../format/record.ts";
import type { InkDocument } from "../ink/document.ts";
import { lineBox } from "../ink/geometry.ts";

/** A file a new symbol's first save made, or was making. */
export interface CreatedFile {
  readonly path: string;
  /** A fingerprint of the bytes last written to it. */
  readonly fingerprint: string;
}

/**
 * The symbol a draft belongs to: a file, or a new one in a note. A new
 * symbol whose first save made its file, or may have, but did not insert its
 * embed names that file too, so that recovering it can finish the save with
 * that file rather than make another.
 */
export type DraftTarget =
  | { readonly kind: "file"; readonly path: string }
  | {
      readonly kind: "new";
      readonly note: string;
      readonly file?: CreatedFile;
    };

/**
 * A draft's base layer: none, the one its symbol's file opens with, or one
 * kept in the draft itself because the file does not hold it, as after a
 * cleared drawing was saved and the clearing undone.
 */
export type DraftBase =
  | { readonly kind: "none" }
  | { readonly kind: "file" }
  | { readonly kind: "kept"; readonly layer: BaseLayer };

export interface Draft {
  /** The editor session that wrote it. */
  readonly id: string;
  readonly target: DraftTarget;
  readonly strokes: readonly Stroke[];
  readonly base: DraftBase;
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

/** The version of the stored draft's layout. */
const draftVersion = 1;
const indexKey = "inkline-drafts";
const draftPrefix = "inkline-draft:";

/**
 * Local storage for one vault, as Obsidian's `App` offers it. Writes that the
 * browser refuses, as when storage is full, fail silently.
 */
export interface VaultStorage {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCreated(value: unknown): CreatedFile | undefined {
  return isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.fingerprint === "string"
    ? { path: value.path, fingerprint: value.fingerprint }
    : undefined;
}

function parseTarget(value: unknown): DraftTarget | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "file" && typeof value.path === "string") {
    return { kind: "file", path: value.path };
  }
  if (value.kind !== "new" || typeof value.note !== "string") return undefined;
  if (value.file === undefined) return { kind: "new", note: value.note };
  const file = parseCreated(value.file);
  return file === undefined
    ? undefined
    : { kind: "new", note: value.note, file };
}

/** The box a draft's strokes are stored in; it does not limit them. */
const draftBox = { ...lineBox, width: lineBox.height };

/**
 * Reads a stored draft, checking its strokes and any base layer it keeps as
 * strictly as a record's.
 */
export function decodeDraft(stored: unknown): Draft | undefined {
  if (typeof stored !== "string") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const { id, target, base, fingerprint, savedAt, version, ink } = value;
  const parsedTarget = parseTarget(target);
  if (
    version !== draftVersion ||
    typeof id !== "string" ||
    parsedTarget === undefined ||
    (base !== "none" && base !== "file" && base !== "kept") ||
    (fingerprint !== undefined && typeof fingerprint !== "string") ||
    typeof savedAt !== "number" ||
    !Number.isFinite(savedAt)
  ) {
    return undefined;
  }
  const parsed = parseRecord(JSON.stringify(ink));
  if (!parsed.ok) return undefined;
  const { strokes, base: layer } = parsed.record;
  // A base layer is stored when it is kept, and only then.
  let from: DraftBase;
  if (base === "kept") {
    if (layer === undefined) return undefined;
    from = { kind: "kept", layer };
  } else {
    if (layer !== undefined) return undefined;
    from = { kind: base };
  }
  return {
    id,
    target: parsedTarget,
    strokes,
    base: from,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    savedAt,
  };
}

/** A draft as the text stored for it. */
function encodeDraft(draft: Draft): string {
  const { id, target, strokes, base, fingerprint, savedAt } = draft;
  const ink =
    base.kind === "kept"
      ? { box: draftBox, strokes, base: base.layer }
      : { box: draftBox, strokes };
  return JSON.stringify({
    version: draftVersion,
    id,
    target,
    base: base.kind,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    savedAt,
    ink: recordValue(ink),
  });
}

/** Whether two targets name the same symbol. */
export function sameTarget(a: DraftTarget, b: DraftTarget): boolean {
  return a.kind === "file" && b.kind === "file"
    ? a.path === b.path
    : a.kind === "new" && b.kind === "new" && a.note === b.note;
}

/**
 * How a draft of `document` keeps its base layer: as the file's own when it
 * is the base layer of `saved`, the document as the file now holds it, and
 * otherwise in the draft.
 */
export function draftBase(
  document: InkDocument,
  saved: InkDocument,
): DraftBase {
  const layer = document.base;
  if (layer === undefined) return { kind: "none" };
  const held = saved.base;
  return held?.png === layer.png &&
    held.x === layer.x &&
    held.y === layer.y &&
    held.scale === layer.scale
    ? { kind: "file" }
    : { kind: "kept", layer };
}

/** The document a draft restores onto the file's own document. */
export function restoreDraft(original: InkDocument, draft: Draft): InkDocument {
  const { strokes, base } = draft;
  const layer =
    base.kind === "kept"
      ? base.layer
      : base.kind === "file"
        ? original.base
        : undefined;
  return layer === undefined ? { strokes } : { strokes, base: layer };
}

/** A target after `from` was renamed to `to`, or the same target. */
function renamedTarget(
  target: DraftTarget,
  from: string,
  to: string,
): DraftTarget {
  if (target.kind === "file") {
    return target.path === from ? { kind: "file", path: to } : target;
  }
  const note = target.note === from ? to : target.note;
  const file =
    target.file?.path === from ? { ...target.file, path: to } : target.file;
  if (note === target.note && file === target.file) return target;
  return file === undefined
    ? { kind: "new", note }
    : { kind: "new", note, file };
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
    const ids = this.#ids();
    const drafts: Draft[] = [];
    for (const id of ids) {
      const draft = decodeDraft(
        this.#storage.loadLocalStorage(draftPrefix + id),
      );
      if (draft?.id !== id || this.#now() - draft.savedAt > draftLifetime) {
        this.#storage.saveLocalStorage(draftPrefix + id, null);
        continue;
      }
      drafts.push(draft);
    }
    if (drafts.length !== ids.length) this.#setIds(drafts.map(({ id }) => id));
    return drafts.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** The drafts for a symbol, newest first, other than `exceptId`'s. */
  forTarget(target: DraftTarget, exceptId?: string): Draft[] {
    return this.list().filter(
      (draft) => draft.id !== exceptId && sameTarget(draft.target, target),
    );
  }

  /**
   * Keeps a draft, replacing the one with its id, and returns whether it was
   * kept: each write is read back, since storage drops what it refuses. A
   * draft that could not be kept leaves the one it would have replaced.
   */
  put(draft: Draft): boolean {
    const key = draftPrefix + draft.id;
    const text = encodeDraft(draft);
    this.#storage.saveLocalStorage(key, text);
    if (this.#storage.loadLocalStorage(key) !== text) return false;
    const ids = this.#ids();
    if (ids.includes(draft.id)) return true;
    this.#setIds([...ids, draft.id]);
    if (this.#ids().includes(draft.id)) return true;
    // Not in the index, it would never be found: free its space instead.
    this.#storage.saveLocalStorage(key, null);
    return false;
  }

  remove(id: string): void {
    this.#storage.saveLocalStorage(draftPrefix + id, null);
    this.#setIds(this.#ids().filter((other) => other !== id));
  }

  /**
   * Follows a rename: drafts for the file, new ones in the note, and new ones
   * whose first save made the file move with it.
   */
  rename(from: string, to: string): void {
    for (const draft of this.list()) {
      const target = renamedTarget(draft.target, from, to);
      if (target !== draft.target) this.put({ ...draft, target });
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
