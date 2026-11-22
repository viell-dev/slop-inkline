// Changing a symbol's file as one step. A read, a change, and a write are three
// steps to the vault, and a save writes the whole file, so two saves that both
// read before either writes would lose the first one's change without a word.
// So Inkline's writes wait for one another, and each finds and looks at its file
// inside its turn. Plain, so that unit tests can interleave them;
// symbol-writes.ts gives them the vault.

import { PngError, readChunks } from "../format/png.ts";
import { readText, writeText, type SymbolText } from "../format/text.ts";
import { textFields, type TextChanges } from "./text-fields.ts";

/**
 * How many times a file that changes under a save is read again before the
 * save gives up, which leaves it alone.
 */
const attempts = 3;

const keepsChanging = "The file keeps changing, so it was left as it is.";

/**
 * Obsidian's line of disk operations, as far as a save needs to see it. Obsidian
 * runs every read, write, and deletion of the vault's files in one line, in the
 * order they were asked, and a write takes the file's path, not the file, when
 * it joins the line. So whatever is asked of the disk while a save's last look
 * at its file is under way, as by another plugin or a sync tool working through
 * Obsidian, runs after that look and before the save's write: a deletion and a
 * new file at the path would have the write land on the new file.
 */
export interface DiskLine {
  /** What was asked of the disk last, to tell later whether more has been. */
  readonly last: () => unknown;
  /** Waits for everything asked of the disk so far. */
  readonly settle: () => Promise<void>;
}

/**
 * What a save's look at its file saw of the disk's {@link DiskLine}: what the
 * line had last been asked once the look was asked, or undefined if it did not
 * look. An object, as Obsidian's line is a promise, which an async function
 * would wait for and resolve with the result of, rather than hand back.
 */
export interface Look {
  readonly asked: unknown;
}

/**
 * How many times a save waits for what was asked of the disk during its last
 * look, and looks again, before it writes all the same, as it did before it
 * waited at all: a vault whose plugins keep the disk busy must still save.
 */
const lineWaits = 3;

/**
 * Whether anything was asked of `line` since `asked`, what it had last been
 * asked as a save's last look at its file was, so that the save waits for it.
 */
function askedSince(line: DiskLine | undefined, asked: unknown): boolean {
  return line !== undefined && asked !== undefined && line.last() !== asked;
}

/**
 * How long, in milliseconds, a save goes on before a person is told that it is
 * waiting for Obsidian. In real Obsidian, by test/e2e/manual/save-time.e2e.ts on a
 * busy machine, a save of a file near the format's largest took at most 0.7 s,
 * and 2.1 s with the library's filter redrawing all through it; a save behind
 * that one took 1.3 s. This leaves room for a slower disk or computer, so that an
 * ordinary save never shows it, however large. An editor's work on the drawing
 * comes before this and can take seconds of its own, so only the write is timed.
 * A rename gets as long, but only of nothing happening, as {@link watchRename}
 * says.
 */
export const stalledAfter = 5000;

/** What a person is told first of a save that has gone on that long. */
export const savingWaits =
  "Waiting for Obsidian to finish writing a file. Saving goes on by itself when it does.";

/** What a person is told first of a rename that has stopped for that long. */
export const renameWaits =
  "Waiting for Obsidian to finish renaming a file. The rename goes on by itself when it does.";

/** How often, in milliseconds, a rename under way is looked at. */
const renameLook = 250;

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

/**
 * A rename that something came between once Obsidian had it, so that the file
 * may not be where it was asked to go, or another file may be there, or that
 * Obsidian failed with the file at the new name all the same. Its message says
 * what happened, and where the file is now.
 */
export class RenameDisturbed extends Error {
  override name = "RenameDisturbed";
  /** Whether the file has the new name now, all the same. */
  readonly renamed: boolean;

  constructor(message: string, renamed: boolean) {
    super(message);
    this.renamed = renamed;
  }
}

/**
 * Thrown by {@link makeFile} when the disk has something at the path, as it
 * looks or as the file is put there, with nothing written there: whatever is
 * there, it is not the save's. Its message says what, where the one who makes
 * the file can tell.
 */
export class PathTaken extends Error {
  override name = "PathTaken";

  constructor(message = "something is at the file's path") {
    super(message);
  }
}

/**
 * `error` with the paths that Node.js names after its reason taken out, as
 * "EACCES: permission denied, open '<path>'" gives, and `said` in their place,
 * so that a person is told of the file they know rather than of one of
 * Inkline's own. Its `code` stays, for whoever tells errors apart by it. Any
 * other error is as it was.
 */
export function withoutPaths(error: unknown, said: string): unknown {
  if (!(error instanceof Error)) return error;
  const reason = error.message.replace(/, \w+ '.*$/su, "");
  if (reason === error.message) return error;
  const code: unknown = Reflect.get(error, "code");
  return Object.assign(new Error(`${reason}, ${said}`), { code });
}

/**
 * Thrown when the save's own write stopped part-way, as on a full disk, and
 * left a part of the file where it was writing: by {@link saveFile} for a write
 * over a file, and by {@link makeFile} for a file it could not take back.
 * `held` is what was left, the start of what was being written, or none of it.
 * The message is the write's own reason.
 */
export class CutShort extends Error {
  override name = "CutShort";
  readonly held: Uint8Array;

  constructor(reason: unknown, held: Uint8Array) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.held = held;
  }
}

/** Says what is wrong with a file that fails the format's check. */
export function unreadableText(error: unknown): unknown {
  return error instanceof PngError
    ? new Error("This file is not a whole PNG, so it cannot hold text.")
    : error;
}

/**
 * Runs what is asked of it one at a time, in the order it was asked, and goes on
 * past one that fails. Nothing given to it may wait for a person, or every save
 * would wait too: a question is asked once its turn is over.
 *
 * There is one line for all of Inkline's writes, not one for each file, as
 * nothing names a file for as long as a save waits and runs. The vault's file
 * stays with a rename, and is another after a delete and a new file at its path;
 * a path is the other way round. Either way two saves of what is on the disk can
 * hold different keys and run together. A person starts each save, and one
 * waits about a second behind even the largest file. What it costs is that a
 * write the vault never finishes holds up every save, so {@link watchSave} tells
 * a person. The line stays closed however long that lasts: a write given up on
 * could still finish, over whatever a later save had written.
 */
export class WriteQueue {
  /** What the last task ends with, which never rejects. */
  #last: Promise<void> = Promise.resolve();

  /** Runs `task` once everything asked before it has finished. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#last.then(task);
    const ended = (): void => undefined;
    this.#last = result.then(ended, ended);
    return result;
  }
}

/**
 * Told `true` when a save has gone on for {@link stalledAfter}, and `false` when
 * it ends. A save that ends in time tells it nothing.
 */
export type SaveWait = (waiting: boolean) => void;

/**
 * `work`, as it would have ended, with `told` kept up to date for the person
 * waiting. Only they are told: the work goes on, and keeps its place in the line.
 */
export async function watchSave<T>(
  work: Promise<T>,
  told: SaveWait,
): Promise<T> {
  let ended = (): void => undefined;
  const timer = window.setTimeout(() => {
    told(true);
    ended = () => {
      told(false);
    };
  }, stalledAfter);
  try {
    return await work;
  } finally {
    window.clearTimeout(timer);
    ended();
  }
}

/** What hears of a rename while it goes on. */
export interface RenameWait {
  readonly told: SaveWait;
  /** Whether a person is being asked something, which they can take time over. */
  readonly asked: () => boolean;
}

/**
 * `work`, as it would have ended, with `told` kept up to date for the person
 * waiting, as {@link watchSave} does, but for a rename, which no clock can judge.
 * Its promise lasts as long as Obsidian's question about links stays open, and
 * after that it writes every note that links to the symbol: in real Obsidian, by
 * test/e2e/manual/rename-time.e2e.ts, up to 20 s at 3,000 notes on a busy machine,
 * where telling someone to restart would leave the rest with the old link. What
 * sets a stall apart is that nothing happens, as the vault reports each note at
 * most 0.11 s after the last, however many there are. So {@link stalledAfter}
 * counts only from the last look at which `moving` was true, however long the
 * rename has run, and a person is told only as long as that holds: `told` hears
 * `false` when it moves again.
 *
 * It counts looks, not the clock, so that a page that freezes for a while, as a
 * large save's does, or a computer that sleeps, does not look like a stall.
 */
export async function watchRename<T>(
  work: Promise<T>,
  moving: () => boolean,
  told: SaveWait,
): Promise<T> {
  let telling = false;
  const tell = (waiting: boolean): void => {
    if (waiting === telling) return;
    telling = waiting;
    told(waiting);
  };
  let still = 0;
  const timer = window.setInterval(() => {
    still = moving() ? 0 : still + renameLook;
    tell(still >= stalledAfter);
  }, renameLook);
  try {
    return await work;
  } finally {
    window.clearInterval(timer);
    tell(false);
  }
}

/** A file, as a change to it reaches it. */
export interface FileAccess<File> {
  /** Throws unless `file` is still there to change. */
  readonly check: (file: File) => void;
  readonly read: (file: File) => Promise<Uint8Array>;
  readonly write: (file: File, bytes: ArrayBuffer) => Promise<void>;
  /** The disk's line, where it can be seen, which reads and writes join. */
  readonly line?: DiskLine | undefined;
}

/** {@link FileAccess} that a person can stop a save through, while it waits. */
export interface StoppableAccess<File> {
  readonly access: FileAccess<File>;
  /**
   * Stops the save, so that it writes nothing from its next look at the file on,
   * which is the first thing a save does in its turn, and the last before it
   * writes. Returns false if its write has gone to the vault, as that can still
   * finish.
   */
  readonly stop: () => boolean;
}

/** `access`, with a way to stop a save that uses it. */
export function stoppable<File>(
  access: FileAccess<File>,
): StoppableAccess<File> {
  let stopped = false;
  let writing = false;
  return {
    access: {
      ...access,
      check: (file) => {
        if (stopped) throw new Error("The save was stopped.");
        access.check(file);
      },
      write: (file, bytes) => {
        writing = true;
        return access.write(file, bytes);
      },
    },
    stop: () => {
      stopped = true;
      return !writing;
    },
  };
}

/**
 * Whether `whole` starts with the bytes of `part`, all of them. A plain loop, as
 * {@link sameBytes} runs it between {@link changeFile}'s last read and its
 * write: `every` took 400 ms over 8 MiB.
 */
function startsWith(whole: Uint8Array, part: Uint8Array): boolean {
  if (part.length > whole.length) return false;
  for (let at = 0; at < part.length; at++) {
    if (whole[at] !== part[at]) return false;
  }
  return true;
}

/** Whether `a` and `b` hold the same bytes. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && startsWith(a, b);
}

/**
 * Writes what `change` makes of `file`'s bytes, unless it returns them as they
 * were. Run this in a {@link WriteQueue}, which keeps Inkline's own saves out.
 *
 * The vault cannot write a binary file only if it is unchanged, so a program
 * outside Inkline, as a sync tool, can always write first. This keeps that gap
 * to what it cannot close: the file is read once more after `change`, however
 * long that took, and compared byte for byte, as a date and a size can stay the
 * same, and can lag the file. A file that differs is gone through again, so that
 * `change` sees it, and one that goes on changing is left alone. So is anything
 * asked of the disk's {@link DiskLine} during that last read, which would come
 * before the write: the save waits for it, and goes through again.
 */
export async function changeFile<File>(
  access: FileAccess<File>,
  file: File,
  change: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<void> {
  let waits = 0;
  for (let attempt = 0; attempt < attempts;) {
    access.check(file);
    const bytes = await access.read(file);
    const changed = await change(bytes);
    if (changed === bytes) return;
    const buffer = changed.slice().buffer;
    access.check(file);
    const reading = access.read(file);
    const asked = access.line?.last();
    const last = await reading;
    // Once more, as the read can end with another file at this one's path.
    access.check(file);
    if (!sameBytes(last, bytes)) {
      attempt++;
      continue;
    }
    if (askedSince(access.line, asked) && waits < lineWaits) {
      waits++;
      await access.line?.settle();
      continue;
    }
    await access.write(file, buffer);
    return;
  }
  throw new Error(keepsChanging);
}

/**
 * What a write of `bytes` that failed left where it was writing, read with
 * `read`: what is there, if that is the start of `bytes`, or all of them, as a
 * write that stops part-way leaves; undefined for anything else, and where
 * nothing can be read. An empty file counts, as nothing tells it apart from a
 * write that stopped before its first byte.
 */
export async function leftBy(
  read: () => Promise<Uint8Array>,
  bytes: Uint8Array,
): Promise<Uint8Array | undefined> {
  const held = await read().catch(() => undefined);
  return held !== undefined && startsWith(bytes, held) ? held : undefined;
}

/** A file to make where nothing is, as {@link makeFile} goes about it. */
export interface NewFile {
  /** What the file is to hold. */
  readonly bytes: Uint8Array;
  /** Asks the disk whether anything is at the path. */
  readonly exists: () => Promise<boolean>;
  /** Writes `bytes` to a file of the save's own, where nothing else writes. */
  readonly stage: () => Promise<void>;
  /**
   * Copies that file to the path, as one step that makes a file only where
   * nothing is, and resolves once the file is there: rejects, with nothing put
   * there, if anything is.
   */
  readonly place: () => Promise<void>;
  /** Whether `place` rejected so because something was at the path. */
  readonly taken: (error: unknown) => boolean;
  /** Reads what the disk has at the path, listed or not. */
  readonly read: () => Promise<Uint8Array>;
  /** Removes what the disk has at the path. */
  readonly clear: () => Promise<void>;
  /** Removes the save's own file, which `stage` wrote. */
  readonly unstage: () => Promise<void>;
}

/**
 * Makes a file where the disk has nothing, or rejects with {@link PathTaken},
 * with nothing written there, where it has something.
 *
 * Obsidian's own `createBinary` asks the disk whether anything is at the path,
 * and only once it has the answer asks for the write. Whatever was asked of the
 * disk in between, as a new file at that path by another plugin or a sync tool
 * working through Obsidian, runs first, and the write lands on it (#413). So
 * this writes the bytes to a file of its own first, and then has them copied
 * to the path by `place`, whose one step looks and makes the file together, so
 * that nothing can come between them. The look before it saves writing that
 * file when the path is taken already. Nothing waits for the disk to be quiet,
 * so nothing else the disk is asked, however much, can hold the save up.
 *
 * A write of its own file that stops part-way leaves nothing at the path. A copy
 * that stops part-way can leave the start of the bytes there: this takes away a
 * file there that holds only that, as {@link leftBy} says, which is the copy's
 * own, as the copy made that file, or one nobody would miss, and the failure
 * stands. Only if it cannot does it reject with {@link CutShort}, with that
 * part, for the save to know it as its own. Its own file goes in every case.
 */
export async function makeFile(made: NewFile): Promise<void> {
  if (await made.exists()) throw new PathTaken();
  try {
    await made.stage();
    try {
      await made.place();
    } catch (error) {
      if (made.taken(error)) throw new PathTaken();
      const left = await leftBy(made.read, made.bytes);
      if (left !== undefined) {
        try {
          await made.clear();
        } catch {
          throw new CutShort(error, left);
        }
      }
      throw error;
    }
  } finally {
    // One that cannot be removed now is for the next time Inkline starts.
    await made.unstage().catch(() => undefined);
  }
}

/** A save of a whole file, as {@link saveFile} goes about it. */
export interface WholeFile<File> {
  /** The file to save over now, or null when there is none. */
  readonly current: () => File | null;
  /**
   * Rejects to stop the save, with nothing written. Resolves with its
   * {@link Look} at the file, for the save to tell whether more has been asked
   * of the disk since.
   */
  readonly check: () => Promise<Look | undefined>;
  /**
   * Writes over `file`, the one the check passed. Rejects if it could not write
   * the whole of it, which can leave a part of it there.
   */
  readonly write: (file: File) => Promise<void>;
  /**
   * Makes the file, as there is none to save over, as {@link makeFile} does:
   * rejects with {@link PathTaken}, with nothing written there, where something
   * is at the path, with {@link CutShort} for a part of its own it left there,
   * and otherwise with nothing of its own left there.
   */
  readonly create: () => Promise<File>;
  /** What `write` puts in the file. */
  readonly bytes: Uint8Array;
  /** Reads the file the check passed once `write` has failed. */
  readonly read: (file: File) => Promise<Uint8Array>;
  /** The disk's line, where it can be seen. */
  readonly line?: DiskLine | undefined;
}

/**
 * Saves a whole file, and returns the file saved. Run this in a
 * {@link WriteQueue}: waiting for a turn can end with the file renamed, deleted,
 * or replaced by another at its path, so what to save over is found here, in the
 * turn. It is found again after `check`, whose look at one file says nothing of
 * another, and a file that is not the one looked at is looked at in its turn.
 * Anything asked of the disk's {@link DiskLine} after `check` looked would come
 * before the write, so the save waits for it, and looks again.
 *
 * A file can also come to the path after the save found none and before
 * `create` makes it, as the new file of a replacement does once the old one's
 * deletion has run: `create` then refuses to make it. A file found at the path
 * after that is looked at in its turn, as one found there before would be, and
 * is never the save's own, whatever it holds: `create` has said what it left of
 * its own. With no file there, the failure stands, as `create` says it.
 *
 * A `write` over the file the check passed that fails, with that file still at
 * its path, leaves what it wrote before it stopped, as on a full disk: a file
 * holding the start of `bytes`, or all of them, as {@link leftBy} says, is the
 * save's own (#425), and the failure is {@link CutShort} with what it holds.
 * One that failed before it opened the file leaves what the check passed, a
 * whole PNG, which nothing follows: the start of no other bytes Inkline writes,
 * and so its failure stands, unless the file holds all of `bytes`, as when
 * nothing changed since the last save. That is {@link CutShort} with all of
 * them, which the editor says the file holds whole.
 */
export async function saveFile<File>(save: WholeFile<File>): Promise<File> {
  let waits = 0;
  for (let attempt = 0; attempt < attempts;) {
    const checked = save.current();
    const look = await save.check();
    const file = save.current();
    if (file !== checked) {
      attempt++;
      continue;
    }
    if (file === null) {
      try {
        return await save.create();
      } catch (error) {
        if (error instanceof CutShort || save.current() === null) throw error;
        attempt++;
        continue;
      }
    }
    if (askedSince(save.line, look?.asked) && waits < lineWaits) {
      waits++;
      await save.line?.settle();
      continue;
    }
    try {
      await save.write(file);
    } catch (error) {
      // A file no longer at its path, as one replaced as it was written, is not
      // the one this wrote, whatever it holds.
      if (save.current() !== file) throw error;
      const left = await leftBy(() => save.read(file), save.bytes);
      if (left !== undefined) throw new CutShort(error, left);
      throw error;
    }
    return file;
  }
  throw new Error(keepsChanging);
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
