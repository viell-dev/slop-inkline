// Drafts: unsaved strokes kept in the vault's local storage, so that a crash,
// a reload, or disabling the plugin does not lose them. Each editor writes
// only its own draft, under its own id, and says which symbol it belongs to;
// the next editor for that symbol offers it back. A base layer that a draft
// keeps is stored once, apart from it, since it does not change as strokes
// are drawn.

import type { Pausing } from "../format/png.ts";
import {
  basePngProblem,
  limits,
  parseRecord,
  readBasePng,
  recordValue,
  slicedBasePngProblem,
  toBase64,
  toBase64Sliced,
  type BaseLayer,
  type Stroke,
} from "../format/record.ts";
import { PngError } from "../format/png.ts";
import { withoutText } from "../format/text.ts";
import type { InkDocument } from "../ink/document.ts";
import type { TypedText } from "../notes/text-fields.ts";

/** A file a new symbol's first save made, or was making. */
export interface CreatedFile {
  readonly path: string;
  /** A fingerprint of the bytes last written to it. */
  readonly fingerprint: string;
  /**
   * A fingerprint of what it held before, while the write of the bytes
   * `fingerprint` names may not have happened.
   */
  readonly previous?: string;
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
  /**
   * The same of the file without its text, as {@link drawingOf} gives it, to
   * tell a change to that text alone, which leaves the strokes lined up. A draft
   * from before there was one has none, and any change counts against it.
   */
  readonly drawing?: string;
  /** When it was kept, in milliseconds since 1970. */
  readonly savedAt: number;
  /**
   * Where the editor's grid columns passed, in pixels, so that a restored
   * drawing goes on with the grid it was drawn on; undefined if unknown.
   */
  readonly gridOrigin?: number;
  /**
   * The name typed for the symbol, where it differs from the one it has, so
   * that a restored drawing goes on with it; undefined if none was.
   */
  readonly name?: string;
  /** What was typed in its readings and translations, as with the name. */
  readonly text?: TypedText;
}

/** How long a draft is kept before it is dropped unrestored: 30 days. */
export const draftLifetime = 30 * 24 * 60 * 60 * 1000;

/**
 * The version of the stored draft's layout. A draft outlives the version of
 * Inkline that kept it, through an update and through going back to an
 * earlier version, as with BRAT or an older ZIP. So a change to the layout
 * raises this, and reads or converts drafts of the previous layout, with a
 * test that keeps a stored draft of that layout and offers it back. A draft of
 * a higher version, kept by a later Inkline, is never offered, rewritten, or
 * dropped before its lifetime ends, as {@link readLater} says.
 *
 * That holds while the store is the only writer between reading an index and
 * writing it back. Obsidian opens a vault in one window, whose popouts share
 * its scripts, so one version of the plugin writes these keys at a time, and
 * every step of {@link DraftStore} that reads an index and writes it runs
 * without pausing, so nothing else runs between. A later version keeps both.
 * It also never writes a draft of its layout under an id that holds one of an
 * earlier layout: an editor knows the draft it offers or restored by its id
 * alone until it removes or replaces it, and so would remove or replace what
 * took its place. A base layer that a later draft keeps in the shared index is
 * kept with it only under a key of {@link baseKeyForm}, the form every version
 * makes; one under any other key is not.
 */
export const draftVersion = 2;
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
  readonly width: number;
  readonly height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCreated(value: unknown): CreatedFile | undefined {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.fingerprint !== "string"
  ) {
    return undefined;
  }
  const { path, fingerprint, previous } = value;
  if (previous === undefined) return { path, fingerprint };
  return typeof previous === "string"
    ? { path, fingerprint, previous }
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

/** What a draft kept of a symbol's text, without what it cannot read. */
function parseText(value: unknown): TypedText | undefined {
  if (!isRecord(value)) return undefined;
  const { reading, translation } = value;
  const text = {
    ...(typeof reading === "string" ? { reading } : {}),
    ...(typeof translation === "string" ? { translation } : {}),
  };
  return Object.keys(text).length === 0 ? undefined : text;
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
  const { key, x, y, width, height } = value;
  return typeof key === "string" &&
    coordinate(x) &&
    coordinate(y) &&
    coordinate(width) &&
    coordinate(height) &&
    width >= 1 &&
    height >= 1
    ? { key, x, y, width, height }
    : undefined;
}

/**
 * The key of the kept base layer that a stored draft names, if it names one,
 * read without checking its strokes or reading the layer. A draft that
 * {@link decode} would refuse still names its layer here: it keeps the layer
 * until {@link DraftStore.list} drops both.
 */
function storedBaseKey(stored: unknown): string | undefined {
  if (typeof stored !== "string") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return undefined;
  }
  return isRecord(value) &&
    value.base === "kept" &&
    isRecord(value.layer) &&
    typeof value.layer.key === "string"
    ? value.layer.key
    : undefined;
}

/**
 * A stored draft of a later layout than this version reads: every string it
 * holds, and when it was kept and the symbol it belongs to, where those read
 * as this layout's. Its strings name the base layers it keeps somewhere, as
 * each key is a random UUID that nothing else holds by chance.
 */
interface LaterDraft {
  readonly strings: readonly string[];
  readonly savedAt?: number;
  readonly target?: DraftTarget;
}

/**
 * Every string in a value read from JSON, its property names included, at
 * any depth: as decoded, so that an escape such as `\u002d` reads as the
 * character it stands for.
 */
function stringsOf(value: unknown): string[] {
  const strings: string[] = [];
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next === "string") {
      strings.push(next);
    } else if (typeof next === "object" && next !== null && !seen.has(next)) {
      seen.add(next);
      if (Array.isArray(next)) {
        const items: readonly unknown[] = next;
        for (const item of items) pending.push(item);
      } else {
        for (const [name, item] of Object.entries(next)) {
          strings.push(name);
          pending.push(item);
        }
      }
    }
  }
  return strings;
}

/**
 * The base of {@link laterNamed}'s rolling hash, which works in 32-bit
 * integers, wrapping as they overflow.
 */
const hashBase = 131;

/** The rolling hash of `length` characters of `text` from `at`. */
function hashOf(text: string, at: number, length: number): number {
  let hash = 0;
  for (let index = at; index < at + length; index++) {
    hash = (Math.imul(hash, hashBase) + text.charCodeAt(index)) | 0;
  }
  return hash;
}

/**
 * The form of every kept base layer's key that versions from 0.9.2 on have
 * made, with `crypto.randomUUID()`: 36 characters, lowercase hexadecimal
 * digits in groups of 8, 4, 4, 4 and 12, joined by hyphens.
 */
const baseKeyForm =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const baseKeyLength = 36;

/**
 * The keys of kept base layers among `keys` that a draft of a later layout
 * names, whole or inside a longer string. Only a key of {@link baseKeyForm} is
 * looked for, as the layout's rule in AGENTS.md says: a base layer stored
 * under any other key is not kept for a later draft, and costs nothing here.
 * Each string is read once for all of them: a rolling hash of every run of a
 * key's length finds the keys it may be, and a comparison tells. A search for
 * each key in turn takes seconds for a draft of many strings beside many base
 * layers, and cutting out every run to look it up a fifth of a second for a
 * string of a million characters.
 */
function laterNamed(draft: LaterDraft, keys: ReadonlySet<string>): Set<string> {
  const named = new Set<string>();
  // The keys looked for, by their hash.
  const hashes = new Map<number, string[]>();
  let count = 0;
  for (const key of keys) {
    if (!baseKeyForm.test(key)) continue;
    count++;
    const hash = hashOf(key, 0, baseKeyLength);
    hashes.set(hash, [...(hashes.get(hash) ?? []), key]);
  }
  if (count === 0) return named;
  // What the first of a run's characters adds to its hash.
  let first = 1;
  for (let index = 1; index < baseKeyLength; index++) {
    first = Math.imul(first, hashBase);
  }
  for (const text of draft.strings) {
    if (text.length < baseKeyLength) continue;
    let hash = hashOf(text, 0, baseKeyLength);
    for (let at = 0; ; at++) {
      const candidates = hashes.get(hash);
      if (candidates !== undefined) {
        for (const key of candidates) {
          if (text.startsWith(key, at)) named.add(key);
        }
      }
      if (at + baseKeyLength >= text.length) break;
      const rest = (hash - Math.imul(text.charCodeAt(at), first)) | 0;
      hash =
        (Math.imul(rest, hashBase) + text.charCodeAt(at + baseKeyLength)) | 0;
    }
    if (named.size === count) return named;
  }
  return named;
}

/**
 * Reads a stored draft whose `version` is higher than {@link draftVersion},
 * as a later version of Inkline keeps one, so that this version keeps it for
 * that version after someone goes back from it: never offered, as its layout
 * cannot be read, and never rewritten, as that could damage it. It is dropped
 * once its lifetime ends, if when it was kept can be read, with the base
 * layers that no other draft names. Undefined for a draft of this layout or an
 * earlier one, and for anything else.
 */
function readLater(stored: unknown): LaterDraft | undefined {
  let value: unknown = stored;
  if (typeof stored === "string") {
    try {
      value = JSON.parse(stored);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(value)) return undefined;
  const { version, savedAt } = value;
  // So that a version that is not a number, NaN included, is none.
  if (!(typeof version === "number" && version > draftVersion)) {
    return undefined;
  }
  const target = parseTarget(value.target);
  return {
    strings: stringsOf(value),
    ...(typeof savedAt === "number" && Number.isFinite(savedAt)
      ? { savedAt }
      : {}),
    ...(target === undefined ? {} : { target }),
  };
}

/**
 * Whether the stored draft `stored` may name the kept base layer `key`: as
 * {@link storedBaseKey} reads it, or, for a draft of a later layout, which
 * may name it elsewhere, as {@link laterNamed} reads it.
 */
function mayName(stored: unknown, key: string): boolean {
  if (storedBaseKey(stored) === key) return true;
  const later = readLater(stored);
  return later !== undefined && laterNamed(later, new Set([key])).size > 0;
}

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
  const { drawing, gridOrigin, name, text } = value;
  const parsedTarget = parseTarget(target);
  const parsedText = parseText(text);
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
    // Only a warning goes by this, so it is no reason to lose the strokes.
    ...(typeof drawing === "string" ? { drawing } : {}),
    savedAt,
    // Only the grid is lost if this cannot be read, not the strokes.
    ...(typeof gridOrigin === "number" && Number.isFinite(gridOrigin)
      ? { gridOrigin }
      : {}),
    // Nor if the name or the text cannot be read.
    ...(typeof name === "string" ? { name } : {}),
    ...(parsedText === undefined ? {} : { text: parsedText }),
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
  const { x, y, width, height } = place;
  return {
    draft: {
      ...common,
      base: { kind: "kept", layer: { x, y, width, height, png } },
    },
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
  const { id, target, strokes, base, fingerprint, savedAt, gridOrigin } = draft;
  const { drawing, name, text } = draft;
  const layer =
    base.kind === "kept" && baseKey !== undefined
      ? {
          base: "kept",
          layer: {
            key: baseKey,
            x: base.layer.x,
            y: base.layer.y,
            width: base.layer.width,
            height: base.layer.height,
          },
        }
      : { base: base.kind === "kept" ? "lost" : base.kind };
  return JSON.stringify({
    version: draftVersion,
    id,
    target,
    ...layer,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    ...(drawing === undefined ? {} : { drawing }),
    savedAt,
    ...(gridOrigin === undefined ? {} : { gridOrigin }),
    ...(name === undefined ? {} : { name }),
    ...(text === undefined ? {} : { text }),
    ink: recordValue({ strokes }),
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
  return sameLayer(saved?.base, layer)
    ? { kind: "file" }
    : { kind: "kept", layer };
}

/** Whether two PNGs hold the same bytes. */
function samePng(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
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

/**
 * Whether restoring `draft` over `opened`, the document its symbol's file
 * holds, under the name `name`, would bring back nothing: the same strokes, the
 * same base layer in the same place, and the same name, with no text typed. A
 * draft whose kept base layer can no longer be read always brings back
 * something, as what it held is not known. Its grid's origin does not count,
 * as it changes no drawing.
 */
export function restoresNothing(
  draft: Draft,
  opened: InkDocument,
  name: string,
): boolean {
  if (draft.text !== undefined || draft.base.kind === "lost") return false;
  if (draft.name !== undefined && draft.name !== name) return false;
  const restored = restoreDraft(opened, draft);
  return (
    sameLayer(restored.base, opened.base) &&
    JSON.stringify(recordValue({ strokes: restored.strokes })) ===
      JSON.stringify(recordValue({ strokes: opened.strokes }))
  );
}

/**
 * Which of `offered`, the drafts kept for an editor's symbol, newest first,
 * the editor offers back, and which it drops as bringing back nothing. For a
 * symbol's file, a `target` of kind `file`, a draft that would restore
 * nothing over `opened` under `name`, as {@link restoresNothing} says, is
 * dropped, as after a save that ended once Inkline was off, until one that
 * would bring something back, which is offered. A new symbol's draft is
 * always offered, as restoring it can finish its first save. The draft whose
 * id is `first`, as one chosen from the list of drafts, goes before the
 * others, if it is among them.
 */
export function draftOffer(
  target: DraftTarget,
  offered: readonly Draft[],
  opened: InkDocument,
  name: string,
  first?: string,
): { readonly offer: Draft | undefined; readonly drop: readonly string[] } {
  const drop: string[] = [];
  const chosen = offered.filter(({ id }) => id === first);
  const others = offered.filter(({ id }) => id !== first);
  for (const draft of [...chosen, ...others]) {
    if (target.kind !== "file" || !restoresNothing(draft, opened, name)) {
      return { offer: draft, drop };
    }
    drop.push(draft.id);
  }
  return { offer: undefined, drop };
}

/**
 * The base layer of `draft` that an editor opening it as a new symbol cannot
 * show, which that editor's own draft goes on naming until a save: one taken
 * from its symbol's file, or one kept with it that cannot be decoded, as
 * `readable` says. Undefined when the editor shows the draft's base layer, or
 * it has none.
 */
export function unshownBase(
  draft: Draft,
  readable: boolean,
): DraftBase | undefined {
  const { base } = draft;
  return base.kind === "file" || (base.kind === "kept" && !readable)
    ? base
    : undefined;
}

/**
 * The question that offers `draft` back: that the symbol has unsaved changes
 * from `keptAt`, the time it was kept as the person reads times, and then, as
 * each applies, that the symbol was saved again since, so that its strokes
 * may not line up; that only the symbol's readings or translations changed,
 * when the draft would put text back that was typed; and that its base layer
 * cannot be read, when `readable` is false. `file` is the symbol's file as the
 * editor follows it, its fingerprints undefined for a new symbol, which has
 * no file to compare the draft's with.
 */
export function offerQuestion(
  draft: Draft,
  readable: boolean,
  file: {
    readonly fingerprint: string | undefined;
    readonly drawing: string | undefined;
  },
  keptAt: string,
): { readonly title: string; readonly content: string } {
  const changed =
    draft.fingerprint !== undefined &&
    file.fingerprint !== undefined &&
    draft.fingerprint !== file.fingerprint;
  // The strokes line up with the drawing, so a change to the text alone leaves
  // them where they were, and matters only to text the draft would put back.
  const textOnly =
    changed && draft.drawing !== undefined && draft.drawing === file.drawing;
  const moved =
    changed && !textOnly
      ? " The symbol was saved again since then, so its strokes may not line up."
      : "";
  const retyped =
    textOnly && Object.keys(draft.text ?? {}).length > 0
      ? " Its readings or translations changed since then, so look over what you typed before saving."
      : "";
  const unreadable = readable
    ? ""
    : " Its base layer cannot be read, so only its strokes would come back.";
  return {
    title: "Restore the unsaved drawing?",
    content: `This symbol has unsaved changes from ${keptAt}.${moved}${retyped}${unreadable}`,
  };
}

/** Whether two base layers, or none, are the same picture in the same place. */
function sameLayer(
  a: BaseLayer | undefined,
  b: BaseLayer | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    samePng(a.png, b.png) &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
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
  /**
   * The key of the base layer that each draft this store kept names, or
   * undefined for none, by the draft's id: a put would otherwise read back
   * the draft it replaces to find it, which costs about as much again as
   * writing the new one.
   */
  readonly #baseKeys = new Map<string, string | undefined>();

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
    return this.#kept(key, text, index, id);
  }

  /** Reads back what {@link #write} wrote, and lists it. */
  #kept(key: string, text: string, index: string, id: string): boolean {
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

  /** The key of a stored base layer's PNG, while the index lists it. */
  #storedKey(png: Uint8Array): string | undefined {
    const known = this.#keys.get(png);
    if (known === undefined) return undefined;
    if (this.#list(baseIndexKey).includes(known)) return known;
    this.#forgetPng(known);
    return undefined;
  }

  /**
   * Stores a base layer's PNG once, returning its key, and whether this
   * stored it, if it was kept. A key this store knows is used again while the
   * index lists it; another store may have dropped it since, unused, and then
   * it is stored again.
   */
  #keepPng(png: Uint8Array): { key: string; stored: boolean } | undefined {
    const known = this.#storedKey(png);
    if (known !== undefined) return { key: known, stored: false };
    if (basePngProblem(png) !== undefined) return undefined;
    const key = crypto.randomUUID();
    if (!this.#write(basePrefix + key, toBase64(png), baseIndexKey, key)) {
      return undefined;
    }
    this.#pngs.set(key, png);
    this.#keys.set(png, key);
    return { key, stored: true };
  }

  /**
   * Stores a base layer's PNG ahead of the draft that will keep it, as
   * {@link put} would, but a little at a time, with its write and its reading
   * back in separate tasks. `put` cannot pause, and for a large one all of
   * that in one go stops the page for up to half a second. One this leaves
   * unstored, `put` tries itself, and reports as it always does.
   */
  async keepBase(png: Uint8Array, options: Pausing = {}): Promise<void> {
    if (this.#storedKey(png) !== undefined) return;
    if ((await slicedBasePngProblem(png, options)) !== undefined) return;
    const text = await toBase64Sliced(png, options);
    // A stroke drawn meanwhile keeps a draft, whose put stores it at once; a
    // second copy would only take up room that later drafts need.
    if (this.#storedKey(png) !== undefined) return;
    const key = crypto.randomUUID();
    this.#storage.saveLocalStorage(basePrefix + key, text);
    await options.pause?.();
    if (!this.#kept(basePrefix + key, text, baseIndexKey, key)) return;
    // Or while this wrote it, and then this copy is the second.
    if (this.#storedKey(png) !== undefined) {
      this.#dropPng(key);
      return;
    }
    this.#pngs.set(key, png);
    this.#keys.set(png, key);
  }

  #forgetPng(key: string): void {
    const png = this.#pngs.get(key);
    if (png !== undefined) this.#keys.delete(png);
    this.#pngs.delete(key);
  }

  /** Removes a stored base layer that no draft uses. */
  #dropPng(key: string): void {
    this.#storage.saveLocalStorage(basePrefix + key, null);
    this.#setList(
      baseIndexKey,
      this.#list(baseIndexKey).filter((other) => other !== key),
    );
    this.#forgetPng(key);
  }

  /** The key of the base layer that the stored draft `id` names, if any. */
  #baseKeyOf(id: string): string | undefined {
    return this.#baseKeys.has(id)
      ? this.#baseKeys.get(id)
      : storedBaseKey(this.#storage.loadLocalStorage(draftPrefix + id));
  }

  /**
   * Removes the stored base layer `key` if no stored draft names it. Every
   * draft is read from storage rather than from what this store knows, as an
   * editor before a reload may have written it, or a later version of
   * Inkline. Only a put or a removal asks, for the layer its draft stopped
   * naming, so a layer stored ahead of the draft that will keep it is never
   * dropped here, and drafts are read only when a base layer changes, not for
   * every stroke.
   */
  #dropUnused(key: string): void {
    for (const id of this.#list(indexKey)) {
      const stored = this.#storage.loadLocalStorage(draftPrefix + id);
      if (mayName(stored, key)) return;
    }
    this.#dropPng(key);
  }

  /** Whether a draft kept at `savedAt` is past its lifetime. */
  #expired(savedAt: number): boolean {
    return this.#now() - savedAt > draftLifetime;
  }

  /**
   * When the stored draft `id` was kept, while {@link list} would still keep
   * it: listed, stored in this layout under its own id, and not expired.
   * Undefined once any store has removed or dropped it, and once it has
   * expired, though no list has dropped it yet. It reads that one draft, and
   * drops nothing, unlike a list.
   */
  keptAt(id: string): number | undefined {
    if (!this.#list(indexKey).includes(id)) return undefined;
    const stored = this.#storage.loadLocalStorage(draftPrefix + id);
    if (typeof stored !== "string") return undefined;
    let value: unknown;
    try {
      value = JSON.parse(stored);
    } catch {
      return undefined;
    }
    if (!isRecord(value) || value.version !== draftVersion || value.id !== id) {
      return undefined;
    }
    const { savedAt } = value;
    return typeof savedAt === "number" &&
      Number.isFinite(savedAt) &&
      this.#now() - savedAt <= draftLifetime
      ? savedAt
      : undefined;
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
   * the base layers that no draft uses any more. A draft of a later layout is
   * not listed, and stays, as {@link readLater} says, with every base layer
   * its text names.
   */
  list(): Draft[] {
    return this.#read().drafts;
  }

  /** What {@link list} reads: the drafts it lists, and those of later layouts. */
  #read(): { drafts: Draft[]; later: LaterDraft[] } {
    const ids = this.#list(indexKey);
    const listed: string[] = [];
    const drafts: Draft[] = [];
    const used = new Set<string>();
    const later: LaterDraft[] = [];
    for (const id of ids) {
      const stored = this.#storage.loadLocalStorage(draftPrefix + id);
      const decoded = decode(stored, (key) => this.#png(key));
      const draft = decoded?.draft;
      if (draft?.id === id && !this.#expired(draft.savedAt)) {
        if (decoded?.baseKey !== undefined) used.add(decoded.baseKey);
        drafts.push(draft);
        listed.push(id);
        continue;
      }
      const newer = decoded === undefined ? readLater(stored) : undefined;
      if (
        newer !== undefined &&
        (newer.savedAt === undefined || !this.#expired(newer.savedAt))
      ) {
        later.push(newer);
        listed.push(id);
        continue;
      }
      this.#storage.saveLocalStorage(draftPrefix + id, null);
    }
    if (listed.length !== ids.length) this.#setList(indexKey, listed);
    const keys = this.#list(baseIndexKey);
    const unnamed = new Set(keys.filter((key) => !used.has(key)));
    for (const draft of later) {
      if (unnamed.size === 0) break;
      for (const key of laterNamed(draft, unnamed)) {
        used.add(key);
        unnamed.delete(key);
      }
    }
    const kept = keys.filter((key) => used.has(key));
    if (kept.length !== keys.length) {
      for (const key of keys) {
        if (used.has(key)) continue;
        this.#storage.saveLocalStorage(basePrefix + key, null);
        this.#forgetPng(key);
      }
      this.#setList(baseIndexKey, kept);
    }
    return { drafts: drafts.sort((a, b) => b.savedAt - a.savedAt), later };
  }

  /**
   * Every draft {@link list} gives that no open editor owns or restored,
   * newest first, whatever its symbol: the drafts {@link forTarget} offers.
   */
  unheld(): Draft[] {
    return this.list().filter((draft) => !this.#held.has(draft.id));
  }

  /** The drafts for a symbol, newest first, other than open editors'. */
  forTarget(target: DraftTarget): Draft[] {
    return this.offers(target).drafts;
  }

  /**
   * The drafts for a symbol, as {@link forTarget} gives them, and whether a
   * draft of a later layout is kept for it, as after going back from a later
   * version, which can offer it. One whose symbol cannot be read as this
   * layout's is not counted. Both come from one list, as reading every draft
   * again would cost as much again, which for a large one is a pause.
   */
  offers(target: DraftTarget): { drafts: Draft[]; newer: boolean } {
    const { drafts, later } = this.#read();
    return {
      drafts: drafts.filter(
        (draft) =>
          !this.#held.has(draft.id) && sameTarget(draft.target, target),
      ),
      newer: later.some(
        (draft) =>
          draft.target !== undefined && sameTarget(draft.target, target),
      ),
    };
  }

  /**
   * Keeps a draft, replacing the one with its id, and returns whether it was
   * kept. A draft that reading would refuse, or that storage refuses, is not
   * kept, and the one it would have replaced stays. A kept base layer is
   * stored once, the first time a draft uses it, and dropped once a draft
   * kept in its place replaces the last one that named it.
   */
  put(draft: Draft): boolean {
    const replaced = this.#baseKeyOf(draft.id);
    const { base } = draft;
    const png = base.kind === "kept" ? base.layer.png : undefined;
    const kept = png === undefined ? undefined : this.#keepPng(png);
    if (png !== undefined && kept === undefined) return false;
    const baseKey = kept?.key;
    const text = encodeDraft(draft, baseKey);
    const written =
      decode(text, (key) => (key === baseKey ? png : undefined)) !==
        undefined &&
      this.#write(draftPrefix + draft.id, text, indexKey, draft.id);
    if (!written) {
      // A base layer stored for a draft that was not kept is of no use.
      if (kept?.stored === true) this.#dropPng(kept.key);
      return false;
    }
    this.#baseKeys.set(draft.id, baseKey);
    // Not before: until this draft was kept, the one it replaced was the one
    // to recover, with its base layer.
    if (replaced !== undefined && replaced !== baseKey) {
      this.#dropUnused(replaced);
    }
    return true;
  }

  /** Removes a draft, and its base layer unless another draft names it. */
  remove(id: string): void {
    const named = this.#baseKeyOf(id);
    this.#storage.saveLocalStorage(draftPrefix + id, null);
    this.#setList(
      indexKey,
      this.#list(indexKey).filter((other) => other !== id),
    );
    this.#baseKeys.delete(id);
    if (named !== undefined) this.#dropUnused(named);
  }

  /**
   * Follows a rename: drafts for the file, new ones in the note, and new ones
   * whose first save made the file move with it. A draft of a later layout
   * stays as it is, as this version cannot rewrite what it cannot read.
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

/**
 * A fingerprint of everything in a file but its readings and translations, to
 * tell a change to them from a change to its drawing; undefined for a file that
 * is not a whole PNG, which has no text to leave out. Everything else counts,
 * byte for byte, so that a change this does not see can only be to that text.
 */
export async function drawingOf(
  bytes: Uint8Array,
): Promise<string | undefined> {
  try {
    return await fingerprintOf(withoutText(bytes));
  } catch (error) {
    if (error instanceof PngError) return undefined;
    throw error;
  }
}
