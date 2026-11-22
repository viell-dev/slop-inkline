import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readChunks } from "../../../src/format/png.ts";
import {
  readText,
  writeText,
  type SymbolText,
} from "../../../src/format/text.ts";
import {
  changedText,
  changeFile,
  CutShort,
  PathTaken,
  TextMoved,
} from "../../../src/notes/file-writes.ts";
import {
  NotListed,
  parentPath,
  sweepStaged,
  SymbolWrites,
  takenReason,
  type SymbolDisk,
  type SymbolVault,
  type VaultFile,
} from "../../../src/notes/symbol-writes.ts";
import type { TextChanges } from "../../../src/notes/text-fields.ts";

const pinned = new Uint8Array(
  await readFile(
    path.resolve(import.meta.dirname, "../../fixtures/format/v1-text.ink.png"),
  ),
);

/** Inkline's own folder in the fake vault, where a make stages its file. */
const pluginFolder = ".obsidian/plugins/inkline";

/**
 * Whether the vault leaves `path` unlisted, as Obsidian does a path with a
 * part that starts with a dot.
 */
function hidden(path: string): boolean {
  return path.split("/").some((part) => part.startsWith("."));
}

/**
 * A file of the fake vault: an object of its own, as Obsidian's `TFile` is,
 * which a rename keeps and a deletion leaves behind. It holds its bytes, and a
 * test can hold its reads and writes.
 */
class Fake implements VaultFile {
  path: string;
  bytes: Uint8Array;
  reads = 0;
  /** How many writes have started, whether or not they have finished. */
  writes = 0;
  /** What each write waits for before the file changes. */
  held?: () => Promise<void>;
  /** Called as each read ends, with how many there have been. */
  afterRead?: (reads: number) => void | Promise<void>;
  /** Has the next write stop part-way, as on a full disk, leaving this. */
  writeLeaves: Uint8Array | undefined;
  gone = false;

  constructor(path: string, bytes: Uint8Array) {
    this.path = path;
    this.bytes = bytes;
  }

  get name(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
}

/**
 * Obsidian's desktop file system adapter, as far as symbol writes go: one
 * line, which every request by path joins as it is asked, as `queue` does in
 * the `app.js` of Obsidian 1.13.4 and 1.15.1, and whose requests act on the
 * files as they run. Its `copy` is one request that makes the copy only where
 * nothing is, as the adapter's does with `COPYFILE_EXCL`, failing with the
 * code `EEXIST` otherwise, and has the vault list it. A file at a hidden path
 * is the disk's alone, as Obsidian lists none.
 *
 * The vault's own reads and writes of a file do not join the line here, so
 * that a test can hold them without holding everything else. What else is
 * asked of the disk, as by another plugin, a test asks with
 * {@link FakeDisk.ask}, which runs in the line once what is ahead of it has,
 * and a moment later, as a request to the disk does.
 */
class FakeDisk implements SymbolDisk {
  readonly #vault: FakeVault;
  readonly #unlisted = new Map<string, Uint8Array>();
  /** When each file was last written, for `stat`. */
  readonly mtimes = new Map<string, number>();
  #last: Promise<unknown> = Promise.resolve();
  /**
   * Whether `promise` is the line, as Obsidian keeps it, or something of
   * another shape, which changes as much is asked.
   */
  readonly #seen: boolean;
  #other: object = {};
  /** Every request, as its kind and path, in the order run. */
  readonly ran: string[] = [];
  /** Runs as each request is asked, once it has joined the line. */
  afterAsking?: (request: string) => void;
  /** Has the next copy stop after this many bytes, as on a full disk. */
  copyStopsAfter: number | undefined;
  /** Runs in a copy's turn before it copies, and can throw to fail it. */
  onCopy?: (to: string) => void;
  /** Has a write of a path it matches stop after two bytes, as on a full disk. */
  writeStops?: (path: string) => boolean;
  /** Has a removal of a path it matches fail, as of a file held open. */
  removeRefuses: ((path: string) => boolean) | undefined;
  /**
   * Whether the vault lists what a copy makes, as Obsidian's adapter does
   * before its `copy` resolves.
   */
  listsCopies = true;
  /** Whether the disk tells letter case apart even when not asked to. */
  readonly #caseSensitive: boolean;

  constructor(vault: FakeVault, seen: boolean, caseSensitive: boolean) {
    this.#vault = vault;
    this.#seen = seen;
    this.#caseSensitive = caseSensitive;
  }

  /** Obsidian's line, which `diskLine` reads, where it is as Obsidian's. */
  get promise(): unknown {
    return this.#seen ? this.#last : this.#other;
  }

  #queue<T>(request: string, task: () => T): Promise<T> {
    const done = this.#last.then(task, task);
    this.#last = done;
    this.#other = {};
    this.afterAsking?.(request);
    return done;
  }

  /** Asks the disk to `run` something, as another plugin would. */
  ask(run: () => void = () => undefined): void {
    this.#other = {};
    this.#last = this.#last.then(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            run();
            resolve();
          });
        }),
    );
  }

  /** What the disk has at `path`, listed or not. */
  bytesAt(path: string): Uint8Array | undefined {
    return this.#unlisted.get(path) ?? this.#vault.at(path)?.bytes;
  }

  /**
   * Puts `bytes` at `path` on the disk without the vault listing them, as a
   * file made outside Obsidian is until Obsidian sees it.
   */
  putUnlisted(path: string, bytes: Uint8Array): void {
    this.#unlisted.set(path, bytes);
  }

  #put(path: string, bytes: Uint8Array): void {
    this.mtimes.set(path, Date.now());
    if (hidden(path)) {
      this.#unlisted.set(path, bytes);
      return;
    }
    const there = this.#vault.at(path);
    if (there === null) this.#vault.put(path, bytes);
    else there.bytes = bytes;
  }

  /**
   * Whether a file or folder is at `path`, by its exact name if `sensitive`
   * or the disk tells letter case apart, and otherwise in any letter case, as
   * Windows and macOS read names.
   */
  exists(path: string, sensitive = false): Promise<boolean> {
    return this.#queue(`exists ${path}`, () => {
      this.ran.push(`exists ${path}`);
      const unlisted = [...this.#unlisted.keys()];
      const there = [
        ...unlisted,
        // The folders the disk has for them, listed or not.
        ...unlisted.map((file) => parentPath(file)).filter((f) => f !== ""),
        ...this.#vault.paths(),
        ...this.#vault.folderPaths(),
      ];
      if (sensitive || this.#caseSensitive) return there.includes(path);
      const name = path.toLowerCase();
      return there.some((other) => other.toLowerCase() === name);
    });
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    return this.#queue(`read ${path}`, () => {
      this.ran.push(`read ${path}`);
      const bytes = this.bytesAt(path);
      if (bytes === undefined) throw new Error(`ENOENT: ${path}`);
      return bytes.slice().buffer;
    });
  }

  writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const bytes = new Uint8Array(data);
    return this.#queue(`write ${path}`, () => {
      this.ran.push(`write ${path}`);
      if (this.writeStops?.(path) === true) {
        this.#put(path, bytes.slice(0, 2));
        throw new Error("ENOSPC: no space left on device");
      }
      this.#put(path, bytes);
    });
  }

  copy(from: string, to: string): Promise<void> {
    return this.#queue(`copy ${to}`, () => {
      this.ran.push(`copy ${to}`);
      this.onCopy?.(to);
      const bytes = this.bytesAt(from);
      if (bytes === undefined) throw new Error(`ENOENT: ${from}`);
      // As the computer's own copy, which makes no folder.
      if (!hidden(to) && this.#vault.getFolderByPath(parentPath(to)) === null) {
        throw new Error(`ENOENT: ${to}`);
      }
      if (this.bytesAt(to) !== undefined) {
        throw Object.assign(new Error(`EEXIST: ${to}`), { code: "EEXIST" });
      }
      const stops = this.copyStopsAfter;
      this.copyStopsAfter = undefined;
      if (stops === undefined) {
        if (this.listsCopies) this.#put(to, bytes);
        else this.putUnlisted(to, bytes);
        return;
      }
      this.#put(to, bytes.slice(0, stops));
      throw Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
      });
    });
  }

  remove(path: string): Promise<void> {
    return this.#queue(`remove ${path}`, () => {
      this.ran.push(`remove ${path}`);
      if (this.removeRefuses?.(path) === true) {
        this.removeRefuses = undefined;
        throw new Error(`EBUSY: ${path}`);
      }
      if (this.#unlisted.delete(path)) return;
      const there = this.#vault.at(path);
      if (there === null) throw new Error(`ENOENT: ${path}`);
      this.#vault.delete(there);
    });
  }

  list(folder: string): Promise<{ files: string[] }> {
    return this.#queue(`list ${folder}`, () => ({
      files: [...this.#unlisted.keys(), ...this.#vault.paths()].filter(
        (file) => parentPath(file) === folder,
      ),
    }));
  }

  stat(path: string): Promise<{ mtime: number } | null> {
    return this.#queue(`stat ${path}`, () =>
      this.bytesAt(path) === undefined
        ? null
        : { mtime: this.mtimes.get(path) ?? 0 },
    );
  }
}

/**
 * Files by their paths, each an object of its own, as the vault's are: a rename
 * keeps the object, and a file made at a deleted one's path is another.
 */
class FakeVault implements SymbolVault<Fake> {
  readonly adapter: FakeDisk;
  readonly #files = new Map<string, Fake>();
  readonly #folders = new Set<string>([""]);
  /**
   * Has `createFolder` fail, as Obsidian's does where the disk has something
   * at the path once it looks, after it runs this, which can make the folder,
   * as something else can meanwhile.
   */
  createFolderFails: ((path: string) => void) | undefined;

  /**
   * With `line`, the disk keeps its line where Obsidian 1.13.4 and 1.15.1 do;
   * without it, something of another shape is there. With `caseSensitive`,
   * the disk tells letter case apart, as Linux does.
   */
  constructor({
    line = true,
    caseSensitive = false,
  }: { line?: boolean; caseSensitive?: boolean } = {}) {
    this.adapter = new FakeDisk(this, line, caseSensitive);
  }

  put(path: string, bytes: Uint8Array = pinned): Fake {
    const file = new Fake(path, bytes);
    this.#files.set(path, file);
    for (let folder = parentPath(path); folder !== "";) {
      this.#folders.add(folder);
      folder = parentPath(folder);
    }
    return file;
  }

  at(path: string): Fake | null {
    return this.#files.get(path) ?? null;
  }

  paths(): string[] {
    return [...this.#files.keys()];
  }

  folderPaths(): string[] {
    return [...this.#folders].filter((folder) => folder !== "");
  }

  rename(file: Fake, path: string): void {
    this.#files.delete(file.path);
    this.#files.set(path, file);
    file.path = path;
  }

  delete(file: Fake): void {
    this.#files.delete(file.path);
    file.gone = true;
  }

  /** Takes a folder away, as with what was in it. */
  deleteFolder(folder: string): void {
    this.#folders.delete(folder);
  }

  getFileByPath(path: string): Fake | null {
    return this.at(path);
  }

  getFolderByPath(
    path: string,
  ): { children: { name: string; path: string }[] } | null {
    const folder = path === "/" ? "" : path;
    if (!this.#folders.has(folder)) return null;
    const children = [...this.#files.keys(), ...this.#folders]
      .filter((child) => child !== "" && parentPath(child) === folder)
      .map((child) => ({
        name: child.slice(child.lastIndexOf("/") + 1),
        path: child,
      }));
    return { children };
  }

  getAbstractFileByPath(path: string): unknown {
    return this.at(path) ?? (this.#folders.has(path) ? { path } : null);
  }

  async readBinary(file: Fake): Promise<ArrayBuffer> {
    const bytes = file.bytes;
    file.reads++;
    await file.afterRead?.(file.reads);
    return bytes.slice().buffer;
  }

  async modifyBinary(file: Fake, data: ArrayBuffer): Promise<void> {
    file.writes++;
    await file.held?.();
    const leaves = file.writeLeaves;
    if (leaves !== undefined) {
      file.writeLeaves = undefined;
      file.bytes = leaves;
      throw new Error("ENOSPC: no space left on device, write");
    }
    file.bytes = new Uint8Array(data);
  }

  createFolder(path: string): Promise<void> {
    const fails = this.createFolderFails;
    if (fails !== undefined) {
      fails(path);
      return Promise.reject(new Error("Folder already exists."));
    }
    if (this.getAbstractFileByPath(path) !== null) {
      return Promise.reject(new Error("Folder already exists."));
    }
    for (let folder = path; folder !== ""; folder = parentPath(folder)) {
      this.#folders.add(folder);
    }
    return Promise.resolve();
  }
}

/** The files each save wrote, as the text index was told of them. */
let refreshed: Fake[];

/** A vault's one line of writes, as a load of the plugin has. */
function writesOf(
  vault: FakeVault,
  unloaded = new AbortController().signal,
): SymbolWrites<Fake> {
  return new SymbolWrites(
    vault,
    pluginFolder,
    unloaded,
    (file) => {
      refreshed.push(file);
      return Promise.resolve();
    },
    (folder, name) => (folder === "" ? name : `${folder}/${name}`),
  );
}

const said = (file: Fake): Promise<SymbolText> =>
  readText(readChunks(file.bytes));

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, at) => byte === b[at]);
}

const unwatched = (): void => undefined;
const untold = (): void => undefined;

/**
 * What an editor checks before its save writes: it reads its file again,
 * through `writes.symbolFile`, as the editor does, and asks, here by throwing,
 * unless that holds `known`, or nothing is there. `looked` is how long it goes
 * on looking after the read, as the editor does while it works out a
 * fingerprint.
 */
function editorCheck(
  writes: SymbolWrites<Fake>,
  file: Fake,
  known: Uint8Array,
  looked: () => Promise<void> = () => Promise.resolve(),
): () => Promise<void> {
  return async () => {
    const now = await writes.symbolFile(file.path).read();
    await looked();
    if (now !== undefined && !same(now, known)) {
      throw new Error("the editor asks first");
    }
  };
}

/** An editor's save of `written` over `file`, which it knows as `known`. */
function editorSave(
  writes: SymbolWrites<Fake>,
  file: Fake,
  known: Uint8Array,
  written: Uint8Array,
  looked?: () => Promise<void>,
): Promise<Fake> {
  return writes.save(
    file,
    written,
    editorCheck(writes, file, known, looked),
    unwatched,
    untold,
  );
}

/** A library's save of `changes`, typed over `seen`. */
function librarySave(
  writes: SymbolWrites<Fake>,
  file: Fake,
  changes: TextChanges,
  seen: SymbolText,
): Promise<void> {
  return writes.writeText(file, changes, seen).done;
}

/**
 * A save of another symbol, which holds the line until `open`, as one whose
 * check the vault had not finished reading for would.
 */
function holdLine(
  writes: SymbolWrites<Fake>,
  vault: FakeVault,
): { open: () => void; held: Promise<Fake> } {
  const other = vault.put("held.ink.png");
  const { gate, open } = gated();
  const held = writes.save(other, pinned, () => gate, unwatched, untold);
  return { open, held };
}

/** A promise, and what lets it go. */
function gated(): { gate: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { gate, open };
}

async function until(done: () => boolean): Promise<void> {
  while (!done()) {
    await wait(1);
  }
}

beforeEach(() => {
  refreshed = [];
  // watchSave's timer, which a save that ends in time clears.
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("two saves of one file", () => {
  const at = "a.ink.png";

  it("keeps both fields, and the second reads what the first wrote", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const seen = await said(file);
    const { gate, open } = gated();
    file.held = () => gate;
    const first = librarySave(writes, file, { reading: ["FIRST"] }, seen);
    const second = librarySave(writes, file, { translation: ["SECOND"] }, seen);
    await until(() => file.writes === 1);
    const reads = file.reads;
    await wait(2);
    expect(file.reads).toBe(reads);
    open();
    await Promise.all([first, second]);
    expect(await said(file)).toEqual({
      reading: ["FIRST"],
      translation: ["SECOND"],
    });
  });

  it("refuses the second of two saves of one field, and says what is there", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const seen = await said(file);
    const results = await Promise.allSettled([
      librarySave(writes, file, { reading: ["FIRST"] }, seen),
      librarySave(writes, file, { reading: ["SECOND"] }, seen),
    ]);
    expect(results[0].status).toBe("fulfilled");
    const refusal = results[1];
    if (refusal.status !== "rejected") throw new Error("not refused");
    expect(refusal.reason).toBeInstanceOf(TextMoved);
    expect((refusal.reason as TextMoved).text.reading).toEqual(["FIRST"]);
    expect((await said(file)).reading).toEqual(["FIRST"]);
  });

  it("stops an editor's save that a library's save went ahead of", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const known = file.bytes;
    const seen = await said(file);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const results = await Promise.allSettled([
      librarySave(writes, file, { reading: ["TYPED"] }, seen),
      editorSave(writes, file, known, drawn),
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });

  it("has a library's save build on an editor's that went first", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const known = file.bytes;
    const seen = await said(file);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const { gate, open } = gated();
    file.held = () => gate;
    const editor = editorSave(writes, file, known, drawn);
    const library = librarySave(writes, file, { reading: ["TYPED"] }, seen);
    await until(() => file.writes === 1);
    open();
    await Promise.all([editor, library]);
    expect(await said(file)).toEqual({
      reading: ["TYPED"],
      translation: ["DRAWN"],
    });
  });
});

describe("a file replaced while its save waits", () => {
  const at = "a.ink.png";

  /**
   * The reviewer's sequence, up to the editor looking at the replacement: a save
   * holds the line, an editor's joins it, and a sync tool deletes the file and
   * puts the same bytes back, as a new file. `release` lets the editor go on.
   */
  async function replacedWhileWaiting(
    vault: FakeVault,
    writes: SymbolWrites<Fake>,
  ): Promise<{
    replacement: Fake;
    seen: SymbolText;
    editor: Promise<Fake>;
    release: () => void;
  }> {
    const old = vault.put(at);
    const seen = await said(old);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const holding = holdLine(writes, vault);
    const looked = gated();
    const editor = editorSave(writes, old, pinned, drawn, () => looked.gate);
    vault.delete(old);
    const replacement = vault.put(at);
    holding.open();
    await holding.held;
    await until(() => replacement.reads === 1);
    return { replacement, seen, editor, release: looked.open };
  }

  it("loses a write if a change to the replacement does not wait, which is the risk", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const { replacement, seen, editor, release } = await replacedWhileWaiting(
      vault,
      writes,
    );
    // A change that does not wait in Inkline's line, as one made by
    // something else would not.
    await changeFile(
      {
        check: () => undefined,
        read: async (file: Fake) =>
          new Uint8Array(await vault.readBinary(file)),
        write: (file: Fake, bytes) => vault.modifyBinary(file, bytes),
      },
      replacement,
      (bytes) => changedText(bytes, { reading: ["TYPED"] }, seen),
    );
    release();
    await editor;
    const final = await said(replacement);
    expect(final.translation).toEqual(["DRAWN"]);
    expect(final.reading).toEqual(seen.reading);
  });

  it("keeps a library's save of the replacement out of the editor's turn", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const { replacement, seen, editor, release } = await replacedWhileWaiting(
      vault,
      writes,
    );
    const library = librarySave(
      writes,
      replacement,
      { reading: ["TYPED"] },
      seen,
    );
    await wait(2);
    expect(replacement.reads).toBe(1);
    release();
    await expect(editor).resolves.toBe(replacement);
    await library;
    expect(await said(replacement)).toEqual({
      reading: ["TYPED"],
      translation: ["DRAWN"],
    });
  });

  it("writes to the replacement, and not to the file it replaced", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(at);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const holding = holdLine(writes, vault);
    const editor = editorSave(writes, old, pinned, drawn);
    vault.delete(old);
    const replacement = vault.put(at);
    holding.open();
    await holding.held;
    await expect(editor).resolves.toBe(replacement);
    expect(old.writes).toBe(0);
    expect((await said(replacement)).translation).toEqual(["DRAWN"]);
    expect(refreshed).toContain(replacement);
  });

  it("asks about a replacement that holds something else", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(at);
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    const holding = holdLine(writes, vault);
    const editor = editorSave(writes, old, pinned, pinned);
    vault.delete(old);
    const replacement = vault.put(at, theirs);
    holding.open();
    await holding.held;
    await expect(editor).rejects.toThrow("asks first");
    expect(replacement.writes).toBe(0);
    expect(replacement.bytes).toBe(theirs);
  });

  it("makes a deleted file once for two editors, and the other asks", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(at);
    const first = await writeText(pinned, "reading", ["FIRST"]);
    const second = await writeText(pinned, "reading", ["SECOND"]);
    vault.delete(old);
    const results = await Promise.allSettled([
      editorSave(writes, old, pinned, first),
      editorSave(writes, old, pinned, second),
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(vault.at(at)?.bytes).toEqual(first);
  });
});

describe("a file renamed while its save waits", () => {
  const from = "before.ink.png";
  const to = "after.ink.png";

  it("writes where the file went, and makes nothing where it was", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(from);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const holding = holdLine(writes, vault);
    const editor = editorSave(writes, file, pinned, drawn);
    vault.rename(file, to);
    holding.open();
    await holding.held;
    await expect(editor).resolves.toBe(file);
    expect(vault.at(from)).toBeNull();
    expect((await said(file)).translation).toEqual(["DRAWN"]);
  });

  it("keeps a save asked for under the new name behind one under the old", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(from);
    const seen = await said(file);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const looked = gated();
    const editor = editorSave(writes, file, pinned, drawn, () => looked.gate);
    await until(() => file.reads === 1);
    // Mid-turn, so a line for each path would let the library's through now.
    vault.rename(file, to);
    const library = librarySave(writes, file, { reading: ["TYPED"] }, seen);
    await wait(2);
    expect(file.reads).toBe(1);
    looked.open();
    await Promise.all([editor, library]);
    expect(await said(file)).toEqual({
      reading: ["TYPED"],
      translation: ["DRAWN"],
    });
  });

  it("keeps a library's save to the file through a rename", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(from);
    const seen = await said(file);
    const holding = holdLine(writes, vault);
    const library = librarySave(writes, file, { reading: ["TYPED"] }, seen);
    vault.rename(file, to);
    holding.open();
    await Promise.all([holding.held, library]);
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });
});

describe("an editor's save", () => {
  const at = "a.ink.png";

  it("looks again at a file that replaced the one it looked at", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(at);
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    let replacement: Fake | undefined;
    await expect(
      editorSave(writes, old, pinned, drawn, () => {
        // Its bytes passed, and they are not what is there now.
        vault.delete(old);
        replacement = vault.put(at, theirs);
        return Promise.resolve();
      }),
    ).rejects.toThrow("asks first");
    expect(replacement?.writes).toBe(0);
    expect(replacement?.bytes).toBe(theirs);
  });

  it("makes the file again, and its folder, when it goes during its look", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(`Signs/${at}`);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const made = await editorSave(writes, old, pinned, drawn, () => {
      vault.delete(old);
      vault.deleteFolder("Signs");
      return Promise.resolve();
    });
    expect(made).not.toBe(old);
    expect(vault.at(`Signs/${at}`)).toBe(made);
    expect(vault.getFolderByPath("Signs")).not.toBeNull();
    expect(old.writes).toBe(0);
    expect(made.bytes).toEqual(drawn);
    expect(refreshed).toEqual([made]);
  });

  /**
   * A replacement of the file at `at` that an editor's save falls between,
   * as in #379: the deletion runs during the save's look, and the new file,
   * holding `theirs`, lands before the disk looks as the save makes the file
   * again. Returns the editor's save, and the new file once it has landed.
   */
  function replacedAsMade(theirs: Uint8Array): {
    saving: Promise<Fake>;
    replacement: () => Fake | undefined;
  } {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(at);
    const drawn = new Uint8Array([1, 2, 3]);
    let replacement: Fake | undefined;
    vault.adapter.afterAsking = (request) => {
      if (request === `exists ${at}`) replacement ??= vault.put(at, theirs);
    };
    let looks = 0;
    const saving = editorSave(writes, old, pinned, drawn, () => {
      if (++looks === 1) vault.delete(old);
      return Promise.resolve();
    });
    return { saving, replacement: () => replacement };
  }

  it("looks at a file made at its path as it made one, and asks about it", async () => {
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    const { saving, replacement } = replacedAsMade(theirs);
    // Not the disk's refusal: the editor's own question.
    await expect(saving).rejects.toThrow("asks first");
    expect(replacement()?.writes).toBe(0);
    expect(replacement()?.bytes).toBe(theirs);
  });

  it("writes to a file made at its path as it made one, if it holds what was known", async () => {
    const { saving, replacement } = replacedAsMade(pinned);
    const saved = await saving;
    expect(saved).toBe(replacement());
    expect(saved.writes).toBe(1);
  });

  it("goes on when its folder is made meanwhile, as the vault then refuses to make it", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(`Signs/${at}`);
    vault.delete(old);
    vault.deleteFolder("Signs");
    vault.createFolderFails = (path) => {
      vault.createFolderFails = undefined;
      void vault.createFolder(path);
    };
    const made = await editorSave(writes, old, pinned, pinned);
    expect(made.path).toBe(`Signs/${at}`);
  });

  it("fails as the vault does when its folder cannot be made", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(`Signs/${at}`);
    vault.delete(old);
    vault.deleteFolder("Signs");
    vault.createFolderFails = () => undefined;
    await expect(editorSave(writes, old, pinned, pinned)).rejects.toThrow(
      "Folder already exists.",
    );
    expect(vault.at(`Signs/${at}`)).toBeNull();
  });

  it("says why the path is taken when the vault lists nothing there", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(at);
    vault.delete(old);
    // On the disk, and not yet listed, as a file made outside Obsidian.
    vault.adapter.putUnlisted(at, pinned);
    await expect(editorSave(writes, old, pinned, pinned)).rejects.toThrow(
      `a file came to ${at} that Obsidian has not listed yet`,
    );
    expect(vault.at(at)).toBeNull();
    expect(vault.adapter.bytesAt(at)).toBe(pinned);
  });

  it("tells what its write cut short left there, and says so", async () => {
    // #425: the editor then knows the part as its own, and writes it whole.
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    file.writeLeaves = drawn.slice(0, 32);
    const took: string[] = [];
    const saving = writes.save(
      file,
      drawn,
      editorCheck(writes, file, pinned),
      unwatched,
      (fingerprint) => took.push(fingerprint),
    );
    await expect(saving).rejects.toThrow(
      `ENOSPC: no space left on device, write; ${at} holds what was written before it stopped, which saving again writes whole`,
    );
    expect(took).toHaveLength(1);
    expect(refreshed).toEqual([]);
  });

  it("refuses a file deleted or replaced as it was written", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    file.held = () => {
      vault.delete(file);
      vault.put(at);
      return Promise.resolve();
    };
    await expect(editorSave(writes, file, pinned, pinned)).rejects.toThrow(
      "deleted or replaced as it was written",
    );
  });
});

describe("a deleted symbol's folder listed in another letter case", () => {
  // #436: the editor names Signs/a.ink.png, deleted with its folder, and the
  // vault lists SIGNS, which Windows and macOS read as the same folder.

  it("makes the file again in the folder as the vault lists it", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put("Signs/a.ink.png");
    vault.delete(old);
    vault.deleteFolder("Signs");
    await vault.createFolder("SIGNS");
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const made = await editorSave(writes, old, pinned, drawn);
    expect(made.path).toBe("SIGNS/a.ink.png");
    expect(made.bytes).toEqual(drawn);
    expect(vault.getFolderByPath("Signs")).toBeNull();
  });

  it("looks at a file in that folder, and writes over it if it holds what was known", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put("Signs/a.ink.png");
    vault.delete(old);
    vault.deleteFolder("Signs");
    const there = vault.put("SIGNS/a.ink.png");
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    await expect(editorSave(writes, old, pinned, drawn)).resolves.toBe(there);
    expect(there.bytes).toEqual(drawn);
    // The save's own entry ends with it: nothing reads there for that path now.
    expect(await writes.symbolFile("Signs/a.ink.png").read()).toBeUndefined();
  });

  it("asks about a file in that folder that holds something else", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put("Signs/a.ink.png");
    vault.delete(old);
    vault.deleteFolder("Signs");
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    const there = vault.put("SIGNS/a.ink.png", theirs);
    await expect(editorSave(writes, old, pinned, pinned)).rejects.toThrow(
      "asks first",
    );
    expect(there.writes).toBe(0);
  });

  it("makes a folder of its own where the disk tells letter case apart", async () => {
    const vault = new FakeVault({ caseSensitive: true });
    const writes = writesOf(vault);
    const old = vault.put("Signs/a.ink.png");
    vault.delete(old);
    vault.deleteFolder("Signs");
    await vault.createFolder("SIGNS");
    const made = await editorSave(writes, old, pinned, pinned);
    expect(made.path).toBe("Signs/a.ink.png");
    expect(vault.getFolderByPath("Signs")).not.toBeNull();
  });

  it("keeps a folder of its own the vault has not listed yet, where the disk tells letter case apart", async () => {
    const vault = new FakeVault({ caseSensitive: true });
    const writes = writesOf(vault);
    const old = vault.put("Signs/a.ink.png");
    vault.delete(old);
    vault.deleteFolder("Signs");
    await vault.createFolder("SIGNS");
    // Made outside Obsidian, which has not listed it yet.
    vault.adapter.putUnlisted("Signs/b.ink.png", pinned);
    const made = await editorSave(writes, old, pinned, pinned);
    expect(made.path).toBe("Signs/a.ink.png");
  });

  it("does not take a file in another letter case for the folder", async () => {
    // The disk reads SIGNS as Signs, but SIGNS is a file: the folder is made,
    // as the fake vault allows beside it, and nothing goes into the file.
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put("Signs/a.ink.png");
    vault.delete(old);
    vault.deleteFolder("Signs");
    vault.put("SIGNS", theirsBytes());
    const made = await editorSave(writes, old, pinned, pinned);
    expect(made.path).toBe("Signs/a.ink.png");
  });

  /** Some bytes, for a file whose bytes do not matter. */
  function theirsBytes(): Uint8Array {
    return new Uint8Array([7, 8, 9]);
  }
});

describe("a library's save", () => {
  const at = "a.ink.png";
  const typed = { reading: ["TYPED"] };

  it("writes nothing to a symbol no longer in the vault", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const seen = await said(file);
    vault.delete(file);
    await expect(librarySave(writes, file, typed, seen)).rejects.toThrow(
      "no longer in the vault",
    );
    expect(file.writes).toBe(0);
  });

  it("writes nothing to a file that is not a symbol", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put("a.png");
    const seen = await said(file);
    await expect(librarySave(writes, file, typed, seen)).rejects.toThrow(
      "no longer in the vault",
    );
    expect(file.writes).toBe(0);
  });

  it("refuses a file deleted or replaced as it was written", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const seen = await said(file);
    file.held = () => {
      vault.delete(file);
      vault.put(at);
      return Promise.resolve();
    };
    await expect(librarySave(writes, file, typed, seen)).rejects.toThrow(
      "deleted or replaced as it was written",
    );
  });

  it("writes nothing once Inkline unloads", async () => {
    const vault = new FakeVault();
    const unloading = new AbortController();
    const writes = writesOf(vault, unloading.signal);
    const file = vault.put(at);
    const seen = await said(file);
    const holding = holdLine(writes, vault);
    const saving = librarySave(writes, file, typed, seen);
    unloading.abort();
    holding.open();
    await expect(saving).rejects.toThrow("Inkline was disabled");
    expect(file.writes).toBe(0);
  });

  it("stops while it waits, and says when its write has gone to the vault", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const seen = await said(file);
    const holding = holdLine(writes, vault);
    const stopped = writes.writeText(file, typed, seen);
    expect(stopped.stop()).toBe(true);
    holding.open();
    await expect(stopped.done).rejects.toThrow("stopped");
    expect(file.writes).toBe(0);
    const { gate, open } = gated();
    file.held = () => gate;
    const going = writes.writeText(file, typed, seen);
    await until(() => file.writes === 1);
    expect(going.stop()).toBe(false);
    open();
    await going.done;
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });

  it("reads what a symbol says, and why not when it cannot", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    expect(await writes.readText(file)).toEqual(await said(file));
    const broken = vault.put("broken.ink.png", pinned.subarray(0, 40));
    await expect(writes.readText(broken)).rejects.toThrow("not a whole PNG");
    vault.delete(file);
    await expect(writes.readText(file)).rejects.toThrow(
      "no longer in the vault",
    );
  });
});

describe("a save and the disk's line", () => {
  const at = "a.ink.png";
  const typed = { reading: ["TYPED"] };

  it("lets a deletion asked during the library's last read run, and writes nothing to the file", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const seen = await said(file);
    // The second read is the last before the write: asked while it is under
    // way, as another plugin's deletion would be.
    file.afterRead = async (reads) => {
      await Promise.resolve();
      if (reads === 2) {
        vault.adapter.ask(() => {
          vault.delete(file);
        });
      }
    };
    await expect(librarySave(writes, file, typed, seen)).rejects.toThrow(
      "no longer in the vault",
    );
    expect(file.writes).toBe(0);
  });

  it("writes once nothing was asked of the disk during the last read", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const seen = await said(file);
    file.afterRead = async (reads) => {
      await Promise.resolve();
      if (reads === 2) vault.adapter.ask();
    };
    await librarySave(writes, file, typed, seen);
    expect(file.reads).toBe(4);
    expect(file.writes).toBe(1);
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });

  it("writes all the same once the disk stays busy, as it did before waiting", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const seen = await said(file);
    file.afterRead = async (reads) => {
      await Promise.resolve();
      if (reads % 2 === 0) vault.adapter.ask();
    };
    await librarySave(writes, file, typed, seen);
    // Three waits, each with the two reads of a round after it.
    expect(file.reads).toBe(8);
    expect(file.writes).toBe(1);
  });

  it("waits for nothing where the line is not as Obsidian keeps it", async () => {
    const vault = new FakeVault({ line: false });
    const writes = writesOf(vault);
    const file = vault.put(at);
    const seen = await said(file);
    file.afterRead = async (reads) => {
      await Promise.resolve();
      if (reads === 2) vault.adapter.ask();
    };
    await librarySave(writes, file, typed, seen);
    expect(file.reads).toBe(2);
    expect(file.writes).toBe(1);
  });

  it("lets a new file asked for after the editor's look come first, and asks about it", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const old = vault.put(at);
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    let replacement: Fake | undefined;
    let looks = 0;
    await expect(
      editorSave(writes, old, pinned, pinned, () => {
        // Asked of the disk as the editor works out what it read.
        if (++looks === 1) {
          vault.adapter.ask(() => {
            vault.delete(old);
            replacement = vault.put(at, theirs);
          });
        }
        return Promise.resolve();
      }),
    ).rejects.toThrow("asks first");
    expect(looks).toBe(2);
    expect(old.writes).toBe(0);
    expect(replacement?.writes).toBe(0);
    expect(replacement?.bytes).toBe(theirs);
  });

  it("looks once and waits for nothing for the editor when nothing more is asked", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    let looks = 0;
    const written = await editorSave(writes, file, pinned, drawn, () => {
      looks++;
      return Promise.resolve();
    });
    expect(written).toBe(file);
    expect(looks).toBe(1);
    expect(file.bytes).toEqual(drawn);
  });

  it("writes all the same for the editor once the disk stays busy", async () => {
    const vault = new FakeVault();
    const writes = writesOf(vault);
    const file = vault.put(at);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    let looks = 0;
    const written = await editorSave(writes, file, pinned, drawn, () => {
      looks++;
      vault.adapter.ask();
      return Promise.resolve();
    });
    expect(written).toBe(file);
    // The first look, and one after each of three waits.
    expect(looks).toBe(4);
    expect(file.bytes).toEqual(drawn);
  });
});

describe("making a symbol's file", () => {
  const at = "a.ink.png";
  const ours = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const theirs = new Uint8Array([7, 8, 9]);

  /** Makes the file at `at`, holding `ours`, through `writes`. */
  function make(writes: SymbolWrites<Fake>): Promise<Fake> {
    return writes.make(at, ours.slice().buffer);
  }

  /** The file a make wrote in Inkline's folder before it made one. */
  function ownOf(disk: FakeDisk): string {
    const own = disk.ran
      .find((request) => request.startsWith(`write ${pluginFolder}/`))
      ?.slice("write ".length);
    if (own === undefined) throw new Error("no file of its own was written");
    return own;
  }

  it("makes a file where the disk has nothing, and takes its own away", async () => {
    const vault = new FakeVault();
    const disk = vault.adapter;
    const made = await make(writesOf(vault));
    expect(made).toBe(vault.at(at));
    expect(made.bytes).toEqual(ours);
    const own = ownOf(disk);
    expect(own).toMatch(
      /^\.obsidian\/plugins\/inkline\/\.making-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(disk.bytesAt(own)).toBeUndefined();
    expect(disk.ran).toEqual([
      `exists ${at}`,
      `write ${own}`,
      `copy ${at}`,
      `remove ${own}`,
    ]);
  });

  it("leaves a file asked for just after its look, as the vault's own would write over it", async () => {
    // #413. The vault's createBinary looks, and asks for its write once it
    // has the answer: a file asked for in between runs first.
    const raced = new FakeVault().adapter;
    const look = raced.exists(at);
    void raced.writeBinary(at, theirs.slice().buffer);
    if (!(await look)) await raced.writeBinary(at, ours.slice().buffer);
    expect(raced.bytesAt(at)).toEqual(ours);
    // The copy makes the file only where nothing is.
    const vault = new FakeVault();
    const disk = vault.adapter;
    disk.afterAsking = (request) => {
      if (request === `exists ${at}`) {
        void disk.writeBinary(at, theirs.slice().buffer);
      }
    };
    await expect(make(writesOf(vault))).rejects.toThrow(PathTaken);
    expect(disk.bytesAt(at)).toEqual(theirs);
    expect(disk.bytesAt(ownOf(disk))).toBeUndefined();
  });

  it("leaves a file that comes as it writes its own, and writes nothing there", async () => {
    const vault = new FakeVault();
    const disk = vault.adapter;
    disk.afterAsking = (request) => {
      if (request.startsWith(`write ${pluginFolder}/`)) {
        void disk.writeBinary(at, theirs.slice().buffer);
      }
    };
    await expect(make(writesOf(vault))).rejects.toThrow(PathTaken);
    expect(disk.bytesAt(at)).toEqual(theirs);
    expect(disk.bytesAt(ownOf(disk))).toBeUndefined();
  });

  it("leaves a file asked for before its look, and writes nothing of its own", async () => {
    const vault = new FakeVault();
    const disk = vault.adapter;
    void disk.writeBinary(at, theirs.slice().buffer);
    await expect(make(writesOf(vault))).rejects.toThrow(PathTaken);
    expect(disk.bytesAt(at)).toEqual(theirs);
    expect(disk.ran).toEqual([`write ${at}`, `exists ${at}`]);
  });

  /**
   * Has `disk` do `ask(n)` for n from 1 to `count`, each once the one before
   * has run, as another plugin or Inkline's own index reading file after file
   * does, and says how many have run.
   */
  function chain(
    disk: FakeDisk,
    count: number,
    ask: (n: number) => Promise<unknown>,
  ): () => number {
    let done = 0;
    void (async () => {
      for (let n = 1; n <= count; n++) {
        await ask(n).catch(() => undefined);
        done = n;
      }
    })();
    return () => done;
  }

  it("makes the file beside a chain of reads, without waiting for them", async () => {
    // The review of #434: a save that waited for the disk to be quiet was
    // refused beside 300 reads asked one after another, as Inkline's own
    // index asks them.
    const vault = new FakeVault();
    const disk = vault.adapter;
    vault.put("note.md", theirs);
    const reads = chain(disk, 300, () => disk.readBinary("note.md"));
    await make(writesOf(vault));
    expect(disk.bytesAt(at)).toEqual(ours);
    expect(reads()).toBeLessThan(10);
  });

  // A plugin writing its files one after another, and one of them at the path,
  // at each place in the run: a file it makes there before the copy is left,
  // and one after it is its own write over the symbol, as any write is.
  for (const nth of [1, 2, 3, 4, 5, 14]) {
    it(`leaves a file that a run of writes makes at its path first, as write ${String(nth)} of 14`, async () => {
      const vault = new FakeVault();
      const disk = vault.adapter;
      const writes = chain(disk, 14, (n) =>
        disk.writeBinary(
          n === nth ? at : `${String(n)}.md`,
          theirs.slice().buffer,
        ),
      );
      const outcome = await make(writesOf(vault)).then(
        () => "made",
        (error: unknown) => (error instanceof PathTaken ? "left" : error),
      );
      await until(() => writes() === 14);
      const theirsAt = disk.ran.indexOf(`write ${at}`);
      const copyAt = disk.ran.indexOf(`copy ${at}`);
      // No copy at all when the look found it.
      expect(outcome).toBe(
        copyAt === -1 || theirsAt < copyAt ? "left" : "made",
      );
      expect(disk.bytesAt(at)).toEqual(theirs);
      const own = disk.ran.find((request) =>
        request.startsWith(`write ${pluginFolder}/`),
      );
      if (own !== undefined) {
        expect(disk.bytesAt(own.slice("write ".length))).toBeUndefined();
      }
    });
  }

  it("leaves nothing at the path when its own file cannot be written whole", async () => {
    const vault = new FakeVault();
    const disk = vault.adapter;
    disk.writeStops = (path) => path.startsWith(`${pluginFolder}/`);
    await expect(make(writesOf(vault))).rejects.toThrow("ENOSPC");
    expect(disk.bytesAt(at)).toBeUndefined();
    expect(disk.bytesAt(ownOf(disk))).toBeUndefined();
    expect(disk.ran).not.toContain(`copy ${at}`);
  });

  for (const [left, stops] of [
    ["the start of", 2],
    ["none of", 0],
  ] as const) {
    it(`takes away ${left} the file that a copy cut short left, and fails as it did`, async () => {
      const vault = new FakeVault();
      const disk = vault.adapter;
      disk.copyStopsAfter = stops;
      const failure = await make(writesOf(vault)).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(CutShort);
      expect(String(failure)).toContain("ENOSPC");
      expect(disk.bytesAt(at)).toBeUndefined();
      expect(disk.bytesAt(ownOf(disk))).toBeUndefined();
    });
  }

  it("says what a copy cut short left, when it cannot take that away", async () => {
    const vault = new FakeVault();
    const disk = vault.adapter;
    disk.copyStopsAfter = 2;
    disk.removeRefuses = (path) => path === at;
    const failure = await make(writesOf(vault)).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CutShort);
    expect(failure instanceof CutShort && failure.held).toEqual(
      ours.slice(0, 2),
    );
    expect(String(failure)).toContain("ENOSPC");
    expect(disk.bytesAt(at)).toEqual(ours.slice(0, 2));
    expect(disk.bytesAt(ownOf(disk))).toBeUndefined();
  });

  it("leaves what is at the path after a failed copy if it is not the start of its bytes", async () => {
    // As a file another program wrote there once the copy had failed.
    const vault = new FakeVault();
    const disk = vault.adapter;
    disk.onCopy = (to) => {
      vault.put(to, theirs);
      throw new Error("EIO: i/o error");
    };
    await expect(make(writesOf(vault))).rejects.toThrow("EIO");
    expect(disk.bytesAt(at)).toEqual(theirs);
    expect(disk.ran).not.toContain(`remove ${at}`);
  });

  it("says the symbol's path, not its own file's, when the disk names both", async () => {
    const vault = new FakeVault();
    const disk = vault.adapter;
    disk.onCopy = (to) => {
      throw Object.assign(
        new Error(
          `EACCES: permission denied, copyfile '/vault/${pluginFolder}/.making-1' -> '/vault/${to}'`,
        ),
        { code: "EACCES" },
      );
    };
    await expect(make(writesOf(vault))).rejects.toThrow(
      `EACCES: permission denied, as the symbol was put at ${at}`,
    );
  });

  it("says when its copy made the file whole and Obsidian has not listed it", async () => {
    // #437: the one failure after which the file at the path is the save's own.
    const vault = new FakeVault();
    const disk = vault.adapter;
    disk.listsCopies = false;
    const failure = await make(writesOf(vault)).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(NotListed);
    expect(String(failure)).toContain(
      `${at} was written, but Obsidian has not listed it`,
    );
    expect(disk.bytesAt(at)).toEqual(ours);
  });

  it("makes the file all the same when its own cannot be taken away", async () => {
    // Left for the sweep as Inkline next starts.
    const vault = new FakeVault();
    const disk = vault.adapter;
    disk.removeRefuses = (path) => path.startsWith(`${pluginFolder}/`);
    await make(writesOf(vault));
    expect(disk.bytesAt(at)).toEqual(ours);
    expect(disk.bytesAt(ownOf(disk))).toEqual(ours);
  });
});

describe("takenReason", () => {
  it("says what the vault lists at the path, a file or a folder", async () => {
    const vault = new FakeVault();
    vault.put("Signs/a.ink.png");
    expect(await takenReason(vault, "Signs/a.ink.png")).toBe(
      "Signs already has a file named a.ink.png",
    );
    await vault.createFolder("b.ink.png");
    expect(await takenReason(vault, "b.ink.png")).toBe(
      "the vault's top folder already has a folder named b.ink.png",
    );
  });

  it("says a file the vault has not listed is there, or has gone again", async () => {
    const vault = new FakeVault();
    vault.adapter.putUnlisted("a.ink.png", pinned);
    expect(await takenReason(vault, "a.ink.png")).toBe(
      "a file came to a.ink.png that Obsidian has not listed yet, and was left as it is; save again in a moment",
    );
    expect(await takenReason(vault, "b.ink.png")).toBe(
      "a file came to b.ink.png as the symbol was saved, and has gone again; save again",
    );
  });

  it("says whose name differs only in letter case, after a file at the very path", async () => {
    const vault = new FakeVault();
    vault.put("Signs/A.ink.png");
    expect(await takenReason(vault, "Signs/a.ink.png")).toBe(
      "Signs has A.ink.png, whose name differs from a.ink.png only in letter case, which this computer reads as the same name; rename or move A.ink.png to save the symbol there",
    );
    // A disk that tells letter case apart can have both.
    vault.adapter.putUnlisted("Signs/a.ink.png", pinned);
    expect(await takenReason(vault, "Signs/a.ink.png")).toBe(
      "a file came to Signs/a.ink.png that Obsidian has not listed yet, and was left as it is; save again in a moment",
    );
  });
});

describe("sweepStaged", () => {
  it("removes the files a make left in Inkline's folder once they are five minutes old", async () => {
    const vault = new FakeVault();
    const disk = vault.adapter;
    const old = `${pluginFolder}/.making-old`;
    const recent = `${pluginFolder}/.making-recent`;
    const data = `${pluginFolder}/data.json`;
    for (const file of [old, recent, data]) {
      await disk.writeBinary(file, theirsOf());
    }
    const now = Date.now();
    disk.mtimes.set(old, now - 5 * 60_000);
    disk.mtimes.set(recent, now - 4 * 60_000);
    disk.mtimes.set(data, now - 60 * 60_000);
    await sweepStaged(vault, pluginFolder);
    expect(disk.bytesAt(old)).toBeUndefined();
    expect(disk.bytesAt(recent)).toBeDefined();
    expect(disk.bytesAt(data)).toBeDefined();
  });

  /** Some bytes, for a file whose bytes do not matter. */
  function theirsOf(): ArrayBuffer {
    return new Uint8Array([7, 8, 9]).buffer;
  }
});
