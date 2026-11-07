// What the vault's symbols say about themselves, remembered so that a search
// need not read a file for each key press, which issue 189 measured at over ten
// seconds for 10,000 symbols. It is only a cache: the files stay the source of
// truth, and it starts empty each time, as a start reads even 10,000 symbols in
// the background in about a quarter of a minute. Plain, so that unit tests can
// drive it; the plugin gives it the vault.

import { readFileText } from "../format/text.ts";
import { searchableText, type SearchableText } from "./search.ts";

/**
 * The largest file read, in bytes. A symbol's image and record come to about 20
 * MiB at the format's limits, so nothing legitimate is left out. A larger file
 * is declined by its size, without reading it, as the format allows.
 */
export const maxIndexedBytes = 32 * 1024 * 1024;

/**
 * The most chunks of one keyword tried in a file. A file has one, and a tool
 * that copies chunks a few. Trying each of 65,000 void ones takes seconds, so a
 * file with more than this is declined, as the format allows, which leaves it
 * findable by its name.
 */
export const maxIndexedAttempts = 16;

/** The files of the vault, as the index reads them. */
export interface TextSource<File> {
  /** Every symbol file now. */
  readonly files: () => readonly File[];
  readonly size: (file: File) => number;
  readonly read: (file: File) => Promise<Uint8Array>;
}

const none: SearchableText = searchableText({ reading: [], translation: [] });

/**
 * Each symbol's text, read one file at a time in the background, as reading
 * eight at once was no faster. A file is keyed by its own object, which follows
 * renames. A search looks only at what has been read so far, and never waits.
 */
export class SymbolTextIndex<File extends object> {
  readonly #source: TextSource<File>;
  /** Told when the index has caught up with everything it was told of. */
  readonly #caughtUp: () => void;
  readonly #entries = new Map<File, SearchableText>();
  /** Files to read, oldest report first. */
  readonly #queue = new Set<File>();
  /** The file being read, until it is read or goes. */
  #reading: File | undefined;
  /** What is working through the queue, while something is. */
  #running: Promise<void> | undefined;
  #stopped = true;

  constructor(source: TextSource<File>, caughtUp: () => void) {
    this.#source = source;
    this.#caughtUp = caughtUp;
  }

  /** Reads every symbol file in the background, from nothing. */
  start(): void {
    this.#stopped = false;
    for (const file of this.#source.files()) this.#queue.add(file);
    this.#run();
  }

  /** Forgets everything, and stops reading after the file being read. */
  stop(): void {
    this.#stopped = true;
    this.#queue.clear();
    this.#entries.clear();
    this.#reading = undefined;
  }

  /** Reads `file` again, as it is new or changed. */
  changed(file: File): void {
    if (this.#stopped) return;
    this.#queue.add(file);
    this.#run();
  }

  /** Forgets `file`, as it was deleted, or is no longer a symbol. */
  removed(file: File): void {
    this.#queue.delete(file);
    this.#entries.delete(file);
    if (this.#reading === file) this.#reading = undefined;
  }

  /** What `file` says, or undefined until it has been read. */
  textOf(file: File): SearchableText | undefined {
    return this.#entries.get(file);
  }

  /** Whether files are still to be read, so that a search may miss some. */
  get reading(): boolean {
    return this.#running !== undefined;
  }

  /**
   * Reads `file` now, for a caller that has just changed it, ahead of whatever
   * else is waiting to be read, which can be thousands of files.
   */
  async refresh(file: File): Promise<void> {
    const text = await this.#read(file);
    if (text !== undefined && !this.#stopped) this.#entries.set(file, text);
  }

  #run(): void {
    if (this.#running !== undefined || this.#queue.size === 0) return;
    this.#running = this.#work().finally(() => {
      this.#running = undefined;
      if (this.#stopped) return;
      // A report can land just as the work ends.
      if (this.#queue.size > 0) this.#run();
      else this.#caughtUp();
    });
  }

  async #work(): Promise<void> {
    for (;;) {
      const [file] = this.#queue;
      if (file === undefined || this.#stopped) return;
      this.#queue.delete(file);
      this.#reading = file;
      const text = await this.#read(file);
      // Deleted meanwhile leaves `#reading` empty; changed again, it is back in
      // the queue, and this reading is soon replaced.
      if (this.#reading === file && text !== undefined) {
        this.#entries.set(file, text);
      }
      this.#reading = undefined;
    }
  }

  /**
   * What `file` says now: nothing for a damaged file, or one declined, so that
   * neither stops the rest. Undefined when it could not be read at all, as
   * while a sync tool holds it, which keeps what was known; the vault's next
   * report of a change reads it again.
   */
  async #read(file: File): Promise<SearchableText | undefined> {
    if (this.#source.size(file) > maxIndexedBytes) return none;
    let bytes: Uint8Array;
    try {
      bytes = await this.#source.read(file);
    } catch {
      return undefined;
    }
    try {
      const text = await readFileText(bytes, maxIndexedAttempts);
      return text.reading.length + text.translation.length === 0
        ? none
        : searchableText(text);
    } catch {
      // A file that fails the check of a PNG's structure, or anything else
      // about this one file, which must not stop the others.
      return none;
    }
  }
}
