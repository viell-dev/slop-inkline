// Drafts: unsaved strokes kept in the vault's local storage, so that a crash,
// a reload, or disabling the plugin does not lose them. The next time the
// same symbol is opened, the editor offers them back.

import {
  formatName,
  formatVersion,
  parseRecord,
  type Stroke,
} from "../format/record.ts";
import type { InkDocument } from "../ink/document.ts";
import { lineBox } from "../ink/geometry.ts";

/** The local storage key prefix for drafts. */
const prefix = "inkline-draft:";

/** What a draft holds: the strokes, and whether the base layer was cleared. */
export interface Draft {
  readonly strokes: readonly Stroke[];
  readonly baseCleared: boolean;
  /** When it was kept, in milliseconds since 1970. */
  readonly savedAt: number;
}

/** The storage key for a symbol file's draft, or a new symbol's in a note. */
export function draftKey(
  target: { readonly file: string } | { readonly newIn: string },
): string {
  return "file" in target
    ? `${prefix}file:${target.file}`
    : `${prefix}new:${target.newIn}`;
}

/**
 * The value to store for a document. The base layer is not stored, since it
 * comes from the file again, and can be megabytes; only whether it was
 * cleared.
 */
export function encodeDraft(
  document: InkDocument,
  savedAt: number,
): Record<string, unknown> {
  return {
    format: formatName,
    version: formatVersion,
    strokes: document.strokes,
    baseCleared: document.base === undefined,
    savedAt,
  };
}

/** Reads a stored draft, checking it as strictly as a record. */
export function decodeDraft(value: unknown): Draft | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { strokes, baseCleared, savedAt } = value as Record<string, unknown>;
  if (typeof baseCleared !== "boolean" || typeof savedAt !== "number") {
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
  return parsed.ok
    ? { strokes: parsed.record.strokes, baseCleared, savedAt }
    : undefined;
}

/** The document a draft restores, from the file's own document. */
export function restoreDraft(original: InkDocument, draft: Draft): InkDocument {
  return draft.baseCleared || original.base === undefined
    ? { strokes: draft.strokes }
    : { strokes: draft.strokes, base: original.base };
}

/** Where drafts are kept: the vault's local storage. */
export interface DraftStore {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}
