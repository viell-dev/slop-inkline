// Drafts: unsaved strokes kept in the vault's local storage, so that a crash,
// a reload, or disabling the plugin does not lose them. Each editor writes
// only its own draft, under its own id, and says which symbol it belongs to;
// the next editor for that symbol offers it back. A base layer that a draft
// keeps is stored once, apart from it, since it does not change as strokes
// are drawn.

import {
  basePngProblem,
  limits,
  parseRecord,
  readBasePng,
  recordValue,
  toBase64,
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
 * kept with the draft because the file does not hold it, as after a cleared
 * drawing was saved and the clearing undone. `lost` is a kept one that can
 * no longer be read.
 */
export type DraftBase =
  | { readonly kind: "none" }
  | { readonly kind: "file" }
  | { readonly kind: "kept"; readonly layer: BaseLayer }
  | { readonly kind: "lost" };

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
const baseIndexKey = "inkline-draft-bases";
const basePrefix = "inkline-draft-base:";

/**
 * Local storage for one vault, as Obsidian's `App` offers it. Writes that the
 * browser refuses, as when storage is full, fail silently.
 */
export interface VaultStorage {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

/** A kept base layer's place, and the key its PNG is stored under. */
interface StoredLayer {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
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

function coordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Math.abs(value) <= limits.coordinate
  );
}

/** A kept base layer's place, within the format's limits. */
function parseLayer(value: unknown): StoredLayer | undefined {
  if (!isRecord(value)) return undefined;
  const { key, x, y, scale } = value;
  return typeof key === "string" &&
    coordinate(x) &&
    coordinate(y) &&
    typeof scale === "number" &&
    scale >= limits.baseScale.min &&
    scale <= limits.baseScale.max
    ? { key, x, y, scale }
    : undefined;
}

/** The box a draft's strokes are stored in; it does not limit them. */
const draftBox = { ...lineBox, width: lineBox.height };

interface Decoded {
  readonly draft: Draft;
  /** The key of the kept base layer it uses, if it could be read. */
  readonly baseKey?: string;
}

/**
 * Reads a stored draft, checking its strokes as strictly as a record's, and
 * any kept base layer through `bases`, which gives a key's PNG. A kept base
 * layer that cannot be read leaves the draft `lost`, with its strokes.
 */
function decode(
  stored: unknown,
  bases: (key: string) => Uint8Array | undefined,
): Decoded | undefined {
  if (typeof stored !== "string") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const { id, target, base, layer, fingerprint, savedAt, version, ink } = value;
  const parsedTarget = parseTarget(target);
  if (
    version !== draftVersion ||
    typeof id !== "string" ||
    parsedTarget === undefined ||
    (fingerprint !== undefined && typeof fingerprint !== "string") ||
    typeof savedAt !== "number" ||
    !Number.isFinite(savedAt) ||
    !isRecord(ink)
  ) {
    return undefined;
  }
  const parsed = parseRecord(JSON.stringify(ink));
  if (!parsed.ok || parsed.record.base !== undefined) return undefined;
  const common = {
    id,
    target: parsedTarget,
    strokes: parsed.record.strokes,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    savedAt,
  };
  if (base === "none" || base === "file" || base === "lost") {
    return layer === undefined
      ? { draft: { ...common, base: { kind: base } } }
      : undefined;
  }
  if (base !== "kept") return undefined;
  const place = parseLayer(layer);
  if (place === undefined) return undefined;
  const png = bases(place.key);
  if (png === undefined)
    return { draft: { ...common, base: { kind: "lost" } } };
  const { x, y, scale } = place;
  return {
    draft: { ...common, base: { kind: "kept", layer: { x, y, scale, png } } },
    baseKey: place.key,
  };
}

/**
 * Reads a stored draft, as {@link DraftStore} does; `bases` gives the PNG a
 * kept base layer's key names.
 */
export function decodeDraft(
  stored: unknown,
  bases: (key: string) => Uint8Array | undefined = () => undefined,
): Draft | undefined {
  return decode(stored, bases)?.draft;
}

/** A draft as the text stored for it, with its kept base layer's key. */
function encodeDraft(draft: Draft, baseKey: string | undefined): string {
  const { id, target, strokes, base, fingerprint, savedAt } = draft;
  const layer =
    base.kind === "kept" && baseKey !== undefined
      ? {
          base: "kept",
          layer: {
            key: baseKey,
            x: base.layer.x,
            y: base.layer.y,
            scale: base.layer.scale,
          },
        }
      : { base: base.kind === "kept" ? "lost" : base.kind };
  return JSON.stringify({
    version: draftVersion,
    id,
    target,
    ...layer,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    savedAt,
    ink: recordValue({ box: draftBox, strokes }),
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
 * otherwise with the draft, as when what the file holds is not known.
 */
export function draftBase(
  document: InkDocument,
  saved: InkDocument | undefined,
): DraftBase {
  const layer = document.base;
  if (layer === undefined) return { kind: "none" };
  const held = saved?.base;
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

/**
 * The drafts of one vault, with an index of their ids, and the base layers
 * they keep, with an index of their keys. One store serves every editor
 * while the plugin is loaded.
 */
export class DraftStore {
  readonly #storage: VaultStorage;
  readonly #now: () => number;
  /** Drafts that an open editor owns or restored: offered to no other. */
  readonly #held = new Set<string>();
  /** Base layer PNGs stored or read, by key, and their keys by PNG. */
  readonly #pngs = new Map<string, Uint8Array>();
  readonly #keys = new WeakMap<Uint8Array, string>();

  constructor(storage: VaultStorage, now: () => number = Date.now) {
    this.#storage = storage;
    this.#now = now;
  }

  #list(key: string): string[] {
    const values = this.#storage.loadLocalStorage(key);
    return Array.isArray(values)
      ? values.filter((value): value is string => typeof value === "string")
      : [];
  }

  #setList(key: string, values: readonly string[]): void {
    this.#storage.saveLocalStorage(key, values.length === 0 ? null : values);
  }

  /**
   * Writes `text` under `key` and lists `id` in the index at `index`,
   * returning whether storage kept both; it drops what it refuses, so each
   * write is read back. A refused write leaves the value it would have
   * replaced. A value the index would not list is removed again, since
   * nothing could find it.
   */
  #write(key: string, text: string, index: string, id: string): boolean {
    this.#storage.saveLocalStorage(key, text);
    if (this.#storage.loadLocalStorage(key) !== text) return false;
    const ids = this.#list(index);
    if (ids.includes(id)) return true;
    this.#setList(index, [...ids, id]);
    if (this.#list(index).includes(id)) return true;
    this.#storage.saveLocalStorage(key, null);
    return false;
  }

  /** The stored PNG a base layer key names, read once and checked. */
  #png(key: string): Uint8Array | undefined {
    const known = this.#pngs.get(key);
    if (known !== undefined) return known;
    const png = readBasePng(this.#storage.loadLocalStorage(basePrefix + key));
    if (png === undefined) return undefined;
    this.#pngs.set(key, png);
    this.#keys.set(png, key);
    return png;
  }

  /**
   * Stores a base layer's PNG once, returning its key, if it was kept. A key
   * this store knows is used again while the index lists it; another store
   * may have dropped it since, unused, and then it is stored again.
   */
  #keepPng(png: Uint8Array): string | undefined {
    const known = this.#keys.get(png);
    if (known !== undefined) {
      if (this.#list(baseIndexKey).includes(known)) return known;
      this.#keys.delete(png);
      this.#pngs.delete(known);
    }
    if (basePngProblem(png) !== undefined) return undefined;
    const key = crypto.randomUUID();
    if (!this.#write(basePrefix + key, toBase64(png), baseIndexKey, key)) {
      return undefined;
    }
    this.#pngs.set(key, png);
    this.#keys.set(png, key);
    return key;
  }

  /** Marks a draft as an open editor's, so that no other is offered it. */
  hold(id: string): void {
    this.#held.add(id);
  }

  release(id: string): void {
    this.#held.delete(id);
  }

  /**
   * Every readable draft, newest first, dropping expired and broken ones and
   * the base layers that no draft uses any more.
   */
  list(): Draft[] {
    const ids = this.#list(indexKey);
    const drafts: Draft[] = [];
    const used = new Set<string>();
    for (const id of ids) {
      const decoded = decode(
        this.#storage.loadLocalStorage(draftPrefix + id),
        (key) => this.#png(key),
      );
      const draft = decoded?.draft;
      if (draft?.id !== id || this.#now() - draft.savedAt > draftLifetime) {
        this.#storage.saveLocalStorage(draftPrefix + id, null);
        continue;
      }
      if (decoded?.baseKey !== undefined) used.add(decoded.baseKey);
      drafts.push(draft);
    }
    if (drafts.length !== ids.length) {
      this.#setList(
        indexKey,
        drafts.map(({ id }) => id),
      );
    }
    const keys = this.#list(baseIndexKey);
    const kept = keys.filter((key) => used.has(key));
    if (kept.length !== keys.length) {
      for (const key of keys) {
        if (used.has(key)) continue;
        this.#storage.saveLocalStorage(basePrefix + key, null);
        const png = this.#pngs.get(key);
        if (png !== undefined) this.#keys.delete(png);
        this.#pngs.delete(key);
      }
      this.#setList(baseIndexKey, kept);
    }
    return drafts.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** The drafts for a symbol, newest first, other than open editors'. */
  forTarget(target: DraftTarget): Draft[] {
    return this.list().filter(
      (draft) => !this.#held.has(draft.id) && sameTarget(draft.target, target),
    );
  }

  /**
   * Keeps a draft, replacing the one with its id, and returns whether it was
   * kept. A draft that reading would refuse, or that storage refuses, is not
   * kept, and the one it would have replaced stays. A kept base layer is
   * stored once, the first time a draft uses it.
   */
  put(draft: Draft): boolean {
    const { base } = draft;
    let baseKey: string | undefined;
    if (base.kind === "kept") {
      baseKey = this.#keepPng(base.layer.png);
      if (baseKey === undefined) return false;
    }
    const text = encodeDraft(draft, baseKey);
    const png = base.kind === "kept" ? base.layer.png : undefined;
    if (
      decode(text, (key) => (key === baseKey ? png : undefined)) === undefined
    ) {
      return false;
    }
    return this.#write(draftPrefix + draft.id, text, indexKey, draft.id);
  }

  remove(id: string): void {
    this.#storage.saveLocalStorage(draftPrefix + id, null);
    this.#setList(
      indexKey,
      this.#list(indexKey).filter((other) => other !== id),
    );
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
