// Changing a symbol's file as one step. A read, a change, and a write are three
// steps to the vault, and a save writes the whole file, so two saves that both
// read before either writes would lose the first one's change without a word.
// So Inkline's writes to a file wait for one another, and each looks at the file
// inside its turn. Plain, so that unit tests can interleave them; symbols.ts gives
// them the vault.

import { PngError, readChunks } from "../format/png.ts";
import { readText, writeText, type SymbolText } from "../format/text.ts";
import { textFields, type TextChanges } from "./text-fields.ts";

/**
 * How many times a file that changes under a save is read again before the
 * save gives up, which leaves it alone.
 */
const attempts = 3;

/** Thrown by {@link changedText} when a field changed since it was read. */
export class TextMoved extends Error {
  override name = "TextMoved";
  /** What the file says now. */
  readonly text: SymbolText;

  constructor(text: SymbolText) {
    super("the file changed on disk");
    this.text = text;
  }
}

/** Says what is wrong with a file that fails the format's check. */
export function unreadableText(error: unknown): unknown {
  return error instanceof PngError
    ? new Error("This file is not a whole PNG, so it cannot hold text.")
    : error;
}

/**
 * Runs what is asked of a file one at a time, in the order it was asked, and
 * goes on past one that fails. Nothing given to it may wait for a person, or
 * every save of that file would wait too: a question is asked once its turn is
 * over.
 */
export class FileQueue<File> {
  /** What each busy file's last task ends with, which never rejects. */
  readonly #last = new Map<File, Promise<void>>();

  /** Runs `task` once everything asked of `file` before it has finished. */
  run<T>(file: File, task: () => Promise<T>): Promise<T> {
    const result = (this.#last.get(file) ?? Promise.resolve()).then(task);
    const ended = (): void => {
      if (this.#last.get(file) === last) this.#last.delete(file);
    };
    const last: Promise<void> = result.then(ended, ended);
    this.#last.set(file, last);
    return result;
  }
}

/** A file, as a change to it reaches it. */
export interface FileAccess<File> {
  /** Throws unless `file` is still there to change. */
  readonly check: (file: File) => void;
  readonly read: (file: File) => Promise<Uint8Array>;
  readonly write: (file: File, bytes: ArrayBuffer) => Promise<void>;
}

/**
 * Whether `a` and `b` hold the same bytes. A plain loop, as this runs between a
 * save's last read and its write: `every` took 400 ms over 8 MiB.
 */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let at = 0; at < a.length; at++) {
    if (a[at] !== b[at]) return false;
  }
  return true;
}

/**
 * Writes what `change` makes of `file`'s bytes, unless it returns them as they
 * were. Run this in a {@link FileQueue}, which keeps Inkline's own saves out.
 *
 * The vault cannot write a binary file only if it is unchanged, so a program
 * outside Inkline, as a sync tool, can always write first. This keeps that gap
 * to what it cannot close: the file is read once more after `change`, however
 * long that took, and compared byte for byte, as a date and a size can stay the
 * same, and can lag the file. A file that differs is gone through again, so that
 * `change` sees it, and one that goes on changing is left alone.
 */
export async function changeFile<File>(
  access: FileAccess<File>,
  file: File,
  change: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    access.check(file);
    const bytes = await access.read(file);
    const changed = await change(bytes);
    if (changed === bytes) return;
    const buffer = changed.slice().buffer;
    access.check(file);
    if (!sameBytes(await access.read(file), bytes)) continue;
    await access.write(file, buffer);
    return;
  }
  throw new Error("The file keeps changing, so it was left as it is.");
}

/**
 * `bytes` with `changes` made to their text chunks, as the format's "Changing
 * the text" says, and every other byte as it was, whether or not the record can
 * be read; the same `bytes` if that changes nothing. `seen` is what the file
 * said when the values were typed: a field to change that has changed since
 * throws {@link TextMoved}, so that nobody replaces a value they have not seen.
 * Other failures throw too, with a reason to show.
 */
export async function changedText(
  bytes: Uint8Array,
  changes: TextChanges,
  seen: SymbolText,
): Promise<Uint8Array> {
  try {
    const now = await readText(readChunks(bytes));
    const moved = textFields.some(
      (field) =>
        changes[field] !== undefined &&
        now[field].join("\n") !== seen[field].join("\n"),
    );
    if (moved) throw new TextMoved(now);
    let written = bytes;
    for (const field of textFields) {
      const values = changes[field];
      if (values !== undefined) {
        written = await writeText(written, field, values);
      }
    }
    return written;
  } catch (error) {
    throw unreadableText(error);
  }
}
