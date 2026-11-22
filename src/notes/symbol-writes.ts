// Writing a symbol's file: an editor's save of the whole file, a library's
// change to its readings and translations, and a file made where none is.
// Plain, so that unit tests drive these very functions over a vault of their
// own; Obsidian's vault is one as it is, as SymbolVault says.
//
// Every write over a symbol's file, an editor's save or a library's change,
// waits in one line, the queue a SymbolWrites makes, and the look an editor's
// save takes at its file is kept beside it, as it holds only while saves take
// turns. A file made where none is, as a new symbol's first save makes it with
// SymbolWrites.make, does not wait in it: nothing is at its path for another
// write to fall between, and the copy that makes it refuses a path where
// anything is. One SymbolWrites is made for each load of the plugin, in
// symbol-files.ts, and every editor and library view is given that one.
// Nothing else makes a queue for symbols.

import { isInkPath } from "../format/ink-file.ts";
import { readChunks } from "../format/png.ts";
import { readText, type SymbolText } from "../format/text.ts";
import { fingerprintOf } from "../editor/drafts.ts";
import {
  changedText,
  changeFile,
  CutShort,
  makeFile,
  PathTaken,
  saveFile,
  stoppable,
  unreadableText,
  withoutPaths,
  watchSave,
  WriteQueue,
  type DiskLine,
  type SaveWait,
} from "./file-writes.ts";
import type { TextChanges } from "./text-fields.ts";

/** A file of the vault, as Obsidian's `TFile` has it. */
export interface VaultFile {
  /** Where it is, which follows renames. */
  readonly path: string;
  /** The last part of its path. */
  readonly name: string;
}

/**
 * The disk under the vault, as Obsidian's adapter reaches it: every file by its
 * path, whether the vault lists it or not. The part of Obsidian's
 * `DataAdapter` that symbol writes use, under its names and signatures.
 */
export interface SymbolDisk {
  exists(path: string, sensitive?: boolean): Promise<boolean>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<{ readonly files: readonly string[] }>;
  stat(path: string): Promise<{ readonly mtime: number } | null>;
}

/**
 * The part of Obsidian's `Vault` that symbol writes use, under its names and
 * signatures, so that `app.vault` is one as it is, and a unit test's fake vault
 * is another.
 */
export interface SymbolVault<File extends VaultFile> {
  readonly adapter: SymbolDisk;
  /** The vault's file at `path` now, or null. */
  getFileByPath(path: string): File | null;
  /** The vault's folder at `path` now, `"/"` for its top, or null. */
  getFolderByPath(path: string): {
    readonly children: readonly {
      readonly name: string;
      readonly path: string;
    }[];
  } | null;
  /** What the vault lists at `path`, a file or a folder, or null. */
  getAbstractFileByPath(path: string): unknown;
  readBinary(file: File): Promise<ArrayBuffer>;
  /** Writes over `file`; resolves once the vault has it. */
  modifyBinary(file: File, data: ArrayBuffer): Promise<void>;
  /** Makes a folder, refusing as the vault does if something is there. */
  createFolder(path: string): Promise<unknown>;
}

/**
 * Why a save is refused once it has written, when its file was deleted, or
 * another put at its path, by something asked of the disk ahead of the write.
 */
const replacedAsWritten =
  "the file was deleted or replaced as it was written, so what is at its path may hold this save";

/**
 * Obsidian's line of disk operations, where this version of Obsidian keeps it,
 * or undefined, which leaves a save as it was without this. None of it is in
 * Obsidian's API, so this is the one place that reads it, and anything of
 * another shape counts as missing (#10). It can go once Obsidian's API has a
 * write that writes a file only if it is still the one at its path.
 *
 * In Obsidian 1.13.4 and 1.15.1, the desktop's file system adapter runs every
 * read, write, existence check, and deletion of a vault's files in one promise
 * chain, `promise`, which each joins at its end as it is asked: `readBinary` and
 * `modifyBinary` ask the adapter at once, with the file's path. Whatever joins
 * the chain while a save reads its file therefore runs before the save's write,
 * and only once it runs does the vault drop a file deleted or add one created.
 */
export function diskLine(vault: {
  readonly adapter: object;
}): DiskLine | undefined {
  const { adapter } = vault;
  const last = (): unknown => Reflect.get(adapter, "promise");
  if (!(last() instanceof Promise)) return undefined;
  const ignore = (): void => undefined;
  return {
    last,
    settle: async () => {
      const queued = last();
      if (queued instanceof Promise) await queued.then(ignore, ignore);
    },
  };
}

/** An `ArrayBuffer` holding exactly these bytes, as the vault takes. */
export function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** The folder `path` is in, `""` for the vault's top. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Throws once `unloaded` has aborted, as Inkline unloads, so that nothing more
 * is written.
 */
export function stillAlive(unloaded: AbortSignal): void {
  if (unloaded.aborted) throw new Error("Inkline was disabled");
}

/** The names of what a folder of the vault holds, `""` for its root. */
export function namesIn(
  vault: Pick<SymbolVault<VaultFile>, "getFolderByPath">,
  folder: string,
): string[] {
  return (
    vault.getFolderByPath(folder === "" ? "/" : folder)?.children ?? []
  ).map((child) => child.name);
}

/** Whether `file` is still the vault's file at its path. */
export function present<File extends VaultFile>(
  vault: Pick<SymbolVault<File>, "getFileByPath">,
  file: File,
): boolean {
  return vault.getFileByPath(file.path) === file;
}

/**
 * `folder` as the vault lists it, where the disk reads a part of it as the
 * name of a folder the vault lists in another letter case, as Windows and
 * macOS read names: that is the same folder on the disk, and Obsidian refuses
 * to make it again with "Folder already exists." (#436). A part the vault
 * lists in no letter case, and the rest after it, stay as they are, for the
 * save to make. The disk is asked only of a part the vault does not list as
 * it is, so a system that tells letter case apart keeps a folder of its own,
 * even one it has not listed yet.
 */
async function folderAsListed(
  vault: Pick<SymbolVault<VaultFile>, "adapter" | "getFolderByPath">,
  folder: string,
): Promise<string> {
  const parts = folder.split("/");
  let listed = "";
  for (const [index, part] of parts.entries()) {
    const asked = listed === "" ? part : `${listed}/${part}`;
    if (vault.getFolderByPath(asked) !== null) {
      listed = asked;
      continue;
    }
    const other = vault
      .getFolderByPath(listed === "" ? "/" : listed)
      ?.children.find(
        (child) =>
          vault.getFolderByPath(child.path) !== null &&
          child.name.toLowerCase() === part.toLowerCase(),
      );
    // The same folder only where the disk finds the name as asked, and not
    // in that letter case: one that tells case apart can have both.
    const { adapter } = vault;
    if (
      other === undefined ||
      !(await adapter.exists(asked)) ||
      (await adapter.exists(asked, true))
    ) {
      return [asked, ...parts.slice(index + 1)].join("/");
    }
    listed = other.path;
  }
  return listed;
}

/**
 * Why a symbol's file cannot be made at `path`, where the disk has something,
 * as {@link PathTaken} says: a file or folder the vault lists there, or one
 * whose name differs only in letter case, which Windows and macOS read as the
 * same name and Obsidian does not list at the path, or one Obsidian has not
 * listed yet, as one made outside it. The disk says which of the last two it
 * is, as one that tells letter case apart can have both.
 */
export async function takenReason(
  vault: SymbolVault<VaultFile>,
  path: string,
): Promise<string> {
  const folder = parentPath(path);
  const name = folder === "" ? path : path.slice(folder.length + 1);
  const where = folder === "" ? "the vault's top folder" : folder;
  const there = vault.getAbstractFileByPath(path);
  if (there !== null) {
    const kind = vault.getFolderByPath(path) === null ? "file" : "folder";
    return `${where} already has a ${kind} named ${name}`;
  }
  const { adapter } = vault;
  const unlisted = `a file came to ${path} that Obsidian has not listed yet, and was left as it is; save again in a moment`;
  // Asked to tell letter case apart, as Windows and macOS do not unless asked.
  if (await adapter.exists(path, true).catch(() => true)) return unlisted;
  // Gone again, as a file that came and went as the save made its own.
  if (!(await adapter.exists(path).catch(() => true))) {
    return `a file came to ${path} as the symbol was saved, and has gone again; save again`;
  }
  const listed = namesIn(vault, folder).find(
    (other) => other.toLowerCase() === name.toLowerCase(),
  );
  return listed === undefined
    ? unlisted
    : `${where} has ${listed}, whose name differs from ${name} only in letter case, which this computer reads as the same name; rename or move ${listed} to save the symbol there`;
}

/**
 * What a save says when its own write stopped part-way and left `held` in
 * `name`, after the write's own `reason`. A write that failed before it opened
 * the file, as one refused by a file another program has open, can leave all
 * of `bytes` there, as when nothing changed since the last save.
 */
export function cutShortReason(
  reason: string,
  name: string,
  held: Uint8Array,
  bytes: Uint8Array,
): string {
  return held.length === bytes.length
    ? `${reason}; ${name} holds the whole symbol all the same`
    : `${reason}; ${name} holds what was written before it stopped, which saving again writes whole`;
}

/**
 * What begins the name of a file that {@link makeSymbolFile} writes in
 * Inkline's own folder before it makes a symbol's file. The dot keeps the
 * vault from listing it, so that it is never one of the vault's files, and no
 * create or delete is heard of it.
 */
const stagedPrefix = ".making-";

/**
 * How long ago, in milliseconds, a file of {@link makeSymbolFile}'s own must
 * have been written for {@link sweepStaged} to remove it. A save removes its own
 * within moments, and Obsidian gives up on a step of its disk after a minute,
 * so this leaves one of a save that may still be under way: of the load of
 * Inkline just before, as after it was turned off and on again, or of another
 * computer whose sync tool carries the folder.
 */
const sweepAfter = 5 * 60_000;

/**
 * Removes the files in Inkline's own `folder` that a save making a symbol's
 * file wrote there and could not remove, as when Obsidian closed in between,
 * once they are older than {@link sweepAfter}. Run as Inkline starts.
 */
export async function sweepStaged(
  vault: { readonly adapter: SymbolDisk },
  folder: string,
): Promise<void> {
  const { adapter } = vault;
  const listed = await adapter.list(folder).catch(() => undefined);
  for (const file of listed?.files ?? []) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    if (!name.startsWith(stagedPrefix)) continue;
    const written = await adapter.stat(file).catch(() => null);
    if (written !== null && Date.now() - written.mtime >= sweepAfter) {
      await adapter.remove(file).catch(() => undefined);
    }
  }
}

/** The `code` a Node.js error gives, as Obsidian's adapter passes it on. */
function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null
    ? Reflect.get(error, "code")
    : undefined;
}

/**
 * Thrown by {@link makeSymbolFile} when its copy made the file, whole, and the
 * vault does not list it: the one failure after which the file at the path is
 * the save's own, as nothing else can have made it there.
 */
export class NotListed extends Error {
  override name = "NotListed";

  constructor(path: string) {
    super(`${path} was written, but Obsidian has not listed it`);
  }
}

/**
 * Makes a symbol's file at `path`, through Obsidian's adapter, as
 * {@link makeFile} does, and returns it. It writes the bytes to a file of its
 * own in Inkline's `folder` first, and then has the adapter copy that to the
 * path: the adapter's `copy` makes the file only where nothing is, which the
 * computer's own copy checks as it makes it, in one of the adapter's steps, and
 * then has the vault list it, as `writeBinary` does, before it resolves. So
 * nothing else asked of Obsidian, nor a program writing to the disk outside it,
 * can come between a look at the path and the write, and nothing waits for the
 * disk to be quiet. Rejects with {@link PathTaken}, with nothing written there,
 * where the disk has something at the path.
 */
async function makeSymbolFile<File extends VaultFile>(
  vault: SymbolVault<File>,
  folder: string,
  path: string,
  buffer: ArrayBuffer,
): Promise<File> {
  const { adapter } = vault;
  const own = `${folder}/${stagedPrefix}${crypto.randomUUID()}`;
  await makeFile({
    bytes: new Uint8Array(buffer),
    exists: () => adapter.exists(path),
    // Node.js names both files in a failure, Inkline's own among them.
    stage: () =>
      adapter.writeBinary(own, buffer).catch((error: unknown) => {
        throw withoutPaths(
          error,
          "as the symbol was written in Inkline's folder",
        );
      }),
    place: () =>
      adapter.copy(own, path).catch((error: unknown) => {
        throw withoutPaths(error, `as the symbol was put at ${path}`);
      }),
    taken: (error) => errorCode(error) === "EEXIST",
    read: async () => new Uint8Array(await adapter.readBinary(path)),
    clear: () => adapter.remove(path),
    unstage: () => adapter.remove(own),
  });
  const made = vault.getFileByPath(path);
  if (made === null) throw new NotListed(path);
  return made;
}

/** Throws unless `file` is still the vault's symbol at its path. */
export function stillSymbol<File extends VaultFile>(
  vault: Pick<SymbolVault<File>, "getFileByPath">,
  file: File,
): void {
  if (!present(vault, file) || !isInkPath(file.path)) {
    throw new Error("The symbol is no longer in the vault.");
  }
}

/** A save or rename of a symbol under way. */
export interface SymbolWork {
  readonly done: Promise<void>;
  /** Stops it; returns false if it has gone to the vault, and can still end. */
  readonly stop: () => boolean;
}

/** A symbol's file as an editor reads it again, as its `SymbolFile` says. */
export interface SymbolFileReading {
  readonly path: string;
  read(): Promise<Uint8Array | undefined>;
}

/**
 * Every write over the files of the vault's symbols, from the library and the
 * editor alike, as one line, and the look an editor's save takes at its file.
 * Make one for each load of the plugin, and give that one to everything that
 * writes a symbol: two would let one's write fall between the other's read and
 * write. A file made where none is, with {@link SymbolWrites.make} on its own,
 * does not wait in the line, as that says.
 */
export class SymbolWrites<File extends VaultFile> {
  readonly #vault: SymbolVault<File>;
  /** Inkline's own folder, where {@link SymbolWrites.make} stages a file. */
  readonly #folder: string;
  /**
   * Aborts as the plugin unloads. {@link SymbolWrites.writeText} looks at it
   * before each read and write of its file, and writes nothing once it has;
   * `save` and `make` do not, as they say.
   */
  readonly #unloaded: AbortSignal;
  /** Has the text index read a file that a save wrote. */
  readonly #refreshed: (file: File) => Promise<void>;
  /**
   * The path of the file named `name` in `folder`, as the vault makes paths:
   * symbol-paths.ts's `pathIn`, with Obsidian's `normalizePath`.
   */
  readonly #pathIn: (folder: string, name: string) => string;
  /**
   * How long {@link SymbolWrites.save} goes on before `waiting` hears that it
   * waits for Obsidian: the plugin's wait, as file-writes.ts's `stalledAfter`
   * says.
   */
  readonly #stalledAfter: () => number;

  /**
   * Every write over a symbol's file, from the library and the editor alike, so
   * that one's read, check, and write cannot fall between another's, whatever
   * happens to the file meanwhile. A file a first save makes has nothing to go
   * between: it was not there to read.
   */
  readonly #queue = new WriteQueue();

  /**
   * The look an editor's save takes at its file, in the save's turn: the first
   * read of a symbol asked meanwhile notes what the disk's line had last been
   * asked once it was. Inkline's saves take turns, so one look is under way at a
   * time. Another editor's read can come first, which only notes an earlier
   * point, so that the save looks again.
   */
  #looking: { asked: unknown } | undefined;

  /**
   * Where a save that made a deleted symbol's file again found its folder
   * listed in another letter case, which the disk read as the same name
   * (#436): the path it made the file at, or found a file at, by the symbol's
   * own path, as its editor still names it. `#fileAt` finds the file there, so
   * that the editor's look and the save's next round look at that file as at
   * one at the symbol's own path. An entry lasts only as long as the save that
   * made it: the next one finds the folder again, asking the disk, so that an
   * entry made in a moment the disk was read wrongly, or left by an editor
   * closed since, never leads a later save to a file it did not find itself.
   */
  readonly #listedPaths = new Map<string, string>();

  constructor(
    vault: SymbolVault<File>,
    folder: string,
    unloaded: AbortSignal,
    refreshed: (file: File) => Promise<void>,
    pathIn: (folder: string, name: string) => string,
    stalledAfter: () => number,
  ) {
    this.#vault = vault;
    this.#folder = folder;
    this.#unloaded = unloaded;
    this.#refreshed = refreshed;
    this.#pathIn = pathIn;
    this.#stalledAfter = stalledAfter;
  }

  /** The vault's file at `path`, or where `#listedPaths` puts it. */
  #fileAt(path: string): File | null {
    const file = this.#vault.getFileByPath(path);
    if (file !== null) return file;
    const listed = this.#listedPaths.get(path);
    return listed === undefined ? null : this.#vault.getFileByPath(listed);
  }

  /**
   * Makes a symbol's file at `path`, where the disk has nothing, as
   * {@link makeSymbolFile} does, with its own file in Inkline's folder. On its
   * own, as a new symbol's first save calls it, it does not wait in the line of
   * writes: nothing is at the path for another write to fall between, and the
   * adapter's copy refuses a path where anything is. Called by `save`, for a
   * file deleted, it runs in that save's turn. It does not look at the plugin's
   * unload signal, which its callers look at before they call it.
   */
  make(path: string, buffer: ArrayBuffer): Promise<File> {
    return makeSymbolFile(this.#vault, this.#folder, path, buffer);
  }

  /** The symbol file at `path`, as the editor reads it again. */
  symbolFile(path: string): SymbolFileReading {
    const vault = this.#vault;
    return {
      path,
      read: async () => {
        const file = this.#fileAt(path);
        if (file === null) return undefined;
        const reading = vault.readBinary(file);
        if (this.#looking !== undefined && this.#looking.asked === undefined) {
          this.#looking.asked = diskLine(vault)?.last();
        }
        return new Uint8Array(await reading);
      },
    };
  }

  /**
   * What `file` says about its symbol now, read from the file, whatever its
   * record. Throws with a reason to show if it cannot say anything.
   */
  async readText(file: File): Promise<SymbolText> {
    const vault = this.#vault;
    stillSymbol(vault, file);
    const bytes = new Uint8Array(await vault.readBinary(file));
    try {
      return await readText(readChunks(bytes));
    } catch (error) {
      throw unreadableText(error);
    }
  }

  /**
   * Changes a symbol's readings and translations and nothing else: its file's
   * text chunks, as {@link changedText} says, with every other byte as it was. No
   * note changes, as its name stays. A field changed since `seen`, by another
   * save or anything else, rejects with `TextMoved`, with nothing written; one
   * that this save leaves alone keeps what the other save gave it. Once
   * Inkline unloads, it writes nothing more, as an editor's save.
   */
  writeText(file: File, changes: TextChanges, seen: SymbolText): SymbolWork {
    const vault = this.#vault;
    const unloaded = this.#unloaded;
    const { access, stop } = stoppable<File>({
      check: (symbol) => {
        stillAlive(unloaded);
        stillSymbol(vault, symbol);
      },
      read: async (symbol) => new Uint8Array(await vault.readBinary(symbol)),
      write: async (symbol, bytes) => {
        await vault.modifyBinary(symbol, bytes);
        if (!present(vault, symbol)) throw new Error(replacedAsWritten);
      },
      line: diskLine(vault),
    });
    const done = this.#queue.run(() =>
      changeFile(access, file, (bytes) => changedText(bytes, changes, seen)),
    );
    return { done, stop };
  }

  /**
   * Writes a symbol's bytes to its file, wherever a rename took it, or, once that
   * was deleted, to what is at its path, or a new file there, with the folders it
   * needs; returns the file written, which a search finds by what it now says at
   * once, ahead of whatever else is waiting to be read. `check` goes first, in the
   * write's turn, so that no other save of Inkline's can come between it and the
   * write, and rejects to write nothing. `waiting` hears if that takes too long.
   *
   * A write of its own over the file that stops part-way, as on a full disk,
   * leaves the start of these bytes there, which no version of Inkline can read,
   * and so can one that makes the file again, if what it left cannot be taken
   * away. `took` hears its fingerprint, so that the editor knows that file as its
   * own (#425): the next save then writes over it, which loses nothing, as it
   * holds only the start of what that save writes, where the editor would
   * otherwise refuse every save until the file was deleted.
   *
   * It does not look at the plugin's unload signal. What keeps it from writing
   * once Inkline unloads is its callers in symbols.ts, which look at the signal
   * before they call it, and the editor's `check`, which throws once unloading
   * has closed the editor. A write that the check has let through goes to the
   * vault, and can still finish.
   */
  save(
    file: File,
    bytes: Uint8Array,
    check: () => Promise<void>,
    waiting: SaveWait,
    took: (fingerprint: string) => void,
  ): Promise<File> {
    const vault = this.#vault;
    const buffer = toBuffer(bytes);
    const save = (): Promise<File> =>
      this.#queue.run(() =>
        saveFile({
          current: () =>
            present(vault, file) ? file : this.#fileAt(file.path),
          check: async () => {
            const look: { asked: unknown } = { asked: undefined };
            this.#looking = look;
            try {
              await check();
            } finally {
              if (this.#looking === look) this.#looking = undefined;
            }
            return look;
          },
          write: async (now) => {
            await vault.modifyBinary(now, buffer);
            if (!present(vault, now)) throw new Error(replacedAsWritten);
          },
          bytes,
          read: async (found) => new Uint8Array(await vault.readBinary(found)),
          line: diskLine(vault),
          create: async () => {
            const wanted = parentPath(file.path);
            const folder =
              wanted === "" ? "" : await folderAsListed(vault, wanted);
            // Where the folder is there in another letter case, the file goes
            // in it, which on such a disk is where it was.
            const path =
              folder === wanted ? file.path : this.#pathIn(folder, file.name);
            if (path !== file.path) this.#listedPaths.set(file.path, path);
            if (folder !== "" && vault.getAbstractFileByPath(folder) === null) {
              try {
                await vault.createFolder(folder);
              } catch (error) {
                // Obsidian makes a folder only where the disk has nothing once
                // it looks, and something else can have made this one meanwhile.
                if (vault.getFolderByPath(folder) === null) throw error;
              }
            }
            try {
              return await this.make(path, buffer);
            } catch (error) {
              // A file the vault lists at the path, the symbol's own or the
              // one in its folder as listed, is looked at in the save's next
              // round; anything else is said in Inkline's words.
              if (error instanceof PathTaken) {
                throw new PathTaken(await takenReason(vault, path));
              }
              throw error;
            }
          },
        }).finally(() => {
          this.#listedPaths.delete(file.path);
        }),
      );
    const write = async (): Promise<File> => {
      let written: File;
      try {
        written = await save();
      } catch (error) {
        if (!(error instanceof CutShort)) throw error;
        took(await fingerprintOf(error.held));
        throw new Error(
          cutShortReason(error.message, file.name, error.held, bytes),
        );
      }
      await this.#refreshed(written);
      return written;
    };
    return watchSave(write(), waiting, this.#stalledAfter());
  }
}
