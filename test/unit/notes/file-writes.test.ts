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
  makeFile,
  PathTaken,
  saveFile,
  stalledAfter,
  stoppable,
  TextMoved,
  watchRename,
  watchSave,
  withoutPaths,
  WriteQueue,
  type DiskLine,
  type FileAccess,
  type NewFile,
} from "../../../src/notes/file-writes.ts";
import type { TextChanges } from "../../../src/notes/text-fields.ts";

const pinned = new Uint8Array(
  await readFile(
    path.resolve(import.meta.dirname, "../../fixtures/format/v1-text.ink.png"),
  ),
);

/** A symbol file in a fake vault, whose reads and writes a test can hold. */
interface Fake {
  bytes: Uint8Array;
  reads: number;
  /** How many writes have started, whether or not they have finished. */
  writes: number;
  /** What each write waits for before the file changes. */
  held?: () => Promise<void>;
  /** Called as each read ends, with how many there have been. */
  afterRead?: (reads: number) => void | Promise<void>;
  gone?: boolean;
  /** Where a {@link FakeVault} holds it, which a rename changes. */
  path?: string;
}

function fake(bytes: Uint8Array = pinned): Fake {
  return { bytes, reads: 0, writes: 0 };
}

const access: FileAccess<Fake> = {
  check: (file) => {
    if (file.gone === true) throw new Error("The symbol is no longer there.");
  },
  read: async (file) => {
    const bytes = file.bytes;
    file.reads++;
    await file.afterRead?.(file.reads);
    return bytes;
  },
  write: async (file, bytes) => {
    file.writes++;
    await file.held?.();
    file.bytes = new Uint8Array(bytes);
  },
};

/**
 * What a save gives {@link saveFile} to tell its own cut-short write from
 * another file, for a save whose create never fails with a file there.
 */
const nothingMet = { bytes: pinned, read: access.read };

const said = (file: Fake): Promise<SymbolText> =>
  readText(readChunks(file.bytes));

/** A library's save of `changes`, typed over `seen`, as `writeSymbolText` runs. */
function libraryChange(
  file: Fake,
  changes: TextChanges,
  seen: SymbolText,
): Promise<void> {
  return changeFile(access, file, (bytes) => changedText(bytes, changes, seen));
}

/** An editor's save: the whole file, once it holds what the editor knows. */
async function editorWrite(
  file: Fake,
  known: Uint8Array,
  written: Uint8Array,
): Promise<void> {
  const now = await access.read(file);
  if (now !== known) throw new Error("the editor asks first");
  await access.write(file, written.slice().buffer);
}

/**
 * Files by their paths, each an object of its own, as the vault's are: a rename
 * keeps the object, and a file made at a deleted one's path is another.
 */
class FakeVault {
  readonly #files = new Map<string, Fake>();
  /**
   * What lands as {@link FakeVault.make} starts, before it looks: in Obsidian,
   * whatever was asked of the disk before the vault's look at it.
   */
  beforeMake?: () => void;

  put(path: string, bytes: Uint8Array = pinned): Fake {
    const file = { ...fake(bytes), path };
    this.#files.set(path, file);
    return file;
  }

  /**
   * Makes a file at `path`, as the vault's `createBinary` does, which refuses
   * if one is there by the time it looks.
   */
  make(path: string, bytes: Uint8Array): Promise<Fake> {
    this.beforeMake?.();
    if (this.at(path) !== null) {
      return Promise.reject(new Error("File already exists."));
    }
    return Promise.resolve(this.put(path, bytes));
  }

  at(path: string): Fake | null {
    return this.#files.get(path) ?? null;
  }

  rename(file: Fake, path: string): void {
    this.#files.delete(file.path ?? "");
    this.#files.set(path, file);
    file.path = path;
  }

  delete(file: Fake): void {
    this.#files.delete(file.path ?? "");
    file.gone = true;
  }

  /** The file to save over, for a save of `file`, as `writeSymbol` finds it. */
  current(file: Fake): Fake | null {
    return file.gone === true ? this.at(file.path ?? "") : file;
  }
}

/**
 * An editor's save of `file`, as `writeSymbol` makes it: what it looks at first
 * must be `known`, or nothing, and `looked` is how long it goes on looking after
 * the read, as the editor does while it works out a fingerprint.
 */
function editorSave(
  vault: FakeVault,
  file: Fake,
  known: Uint8Array,
  written: Uint8Array,
  looked: () => Promise<void> = () => Promise.resolve(),
): Promise<Fake> {
  return saveFile({
    current: () => vault.current(file),
    check: async () => {
      const now = vault.current(file);
      if (now === null) return;
      const bytes = await access.read(now);
      await looked();
      if (bytes !== known) throw new Error("the editor asks first");
    },
    write: (now) => access.write(now, written.slice().buffer),
    create: () => vault.make(file.path ?? "", written),
    bytes: written,
    read: access.read,
  });
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

describe("WriteQueue", () => {
  it("runs tasks one at a time, in order, past a failure", async () => {
    const queue = new WriteQueue();
    const log: string[] = [];
    const { gate, open } = gated();
    const first = queue.run(async () => {
      log.push("first starts");
      await gate;
      log.push("first ends");
      throw new Error("first failed");
    });
    const second = queue.run(() => {
      log.push("second");
      return Promise.resolve("done");
    });
    await until(() => log.length > 0);
    await wait(2);
    expect(log).toEqual(["first starts"]);
    open();
    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("done");
    expect(log).toEqual(["first starts", "first ends", "second"]);
  });

  it("goes on past a task that throws before it returns a promise", async () => {
    const queue = new WriteQueue();
    const failed = queue.run(() => {
      throw new Error("failed at once");
    });
    await expect(failed).rejects.toThrow("failed at once");
    await expect(queue.run(() => Promise.resolve(2))).resolves.toBe(2);
  });

  it("starts again once its tasks have ended", async () => {
    const queue = new WriteQueue();
    await queue.run(() => Promise.resolve());
    await expect(queue.run(() => Promise.resolve(2))).resolves.toBe(2);
  });
});

describe("two saves of one file", () => {
  it("loses one without the queue, which is what the queue is for", async () => {
    const file = fake();
    const seen = await said(file);
    const { gate, open } = gated();
    // Both read before either writes, as they can with nothing to stop them.
    file.held = async () => {
      if (file.writes === 2) open();
      await gate;
    };
    await Promise.all([
      libraryChange(file, { reading: ["FIRST"] }, seen),
      libraryChange(file, { translation: ["SECOND"] }, seen),
    ]);
    const final = await said(file);
    expect(final.translation).toEqual(["SECOND"]);
    expect(final.reading).toEqual(seen.reading);
  });

  it("keeps both fields, and the second reads what the first wrote", async () => {
    const queue = new WriteQueue();
    const file = fake();
    const seen = await said(file);
    const { gate, open } = gated();
    file.held = () => gate;
    const first = queue.run(() =>
      libraryChange(file, { reading: ["FIRST"] }, seen),
    );
    const second = queue.run(() =>
      libraryChange(file, { translation: ["SECOND"] }, seen),
    );
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
    const queue = new WriteQueue();
    const file = fake();
    const seen = await said(file);
    const results = await Promise.allSettled([
      queue.run(() => libraryChange(file, { reading: ["FIRST"] }, seen)),
      queue.run(() => libraryChange(file, { reading: ["SECOND"] }, seen)),
    ]);
    expect(results[0].status).toBe("fulfilled");
    const refusal = results[1];
    if (refusal.status !== "rejected") throw new Error("not refused");
    expect(refusal.reason).toBeInstanceOf(TextMoved);
    expect((refusal.reason as TextMoved).text.reading).toEqual(["FIRST"]);
    expect((await said(file)).reading).toEqual(["FIRST"]);
  });

  it("stops an editor's save that a library's save went ahead of", async () => {
    const queue = new WriteQueue();
    const file = fake();
    const known = file.bytes;
    const seen = await said(file);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const results = await Promise.allSettled([
      queue.run(() => libraryChange(file, { reading: ["TYPED"] }, seen)),
      queue.run(() => editorWrite(file, known, drawn)),
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });

  it("has a library's save build on an editor's that went first", async () => {
    const queue = new WriteQueue();
    const file = fake();
    const known = file.bytes;
    const seen = await said(file);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const { gate, open } = gated();
    file.held = () => gate;
    const editor = queue.run(() => editorWrite(file, known, drawn));
    const library = queue.run(() =>
      libraryChange(file, { reading: ["TYPED"] }, seen),
    );
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
  const path = "a.ink.png";

  /**
   * The reviewer's sequence, up to the editor looking at the replacement: a save
   * holds the line, an editor's joins it, and a sync tool deletes the file and
   * puts the same bytes back, as a new file. `release` lets the editor go on.
   */
  async function replacedWhileWaiting(queue: WriteQueue): Promise<{
    replacement: Fake;
    seen: SymbolText;
    editor: Promise<Fake>;
    release: () => void;
  }> {
    const vault = new FakeVault();
    const old = vault.put(path);
    const seen = await said(old);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const holding = gated();
    const held = queue.run(() => holding.gate);
    const looked = gated();
    const editor = queue.run(() =>
      editorSave(vault, old, pinned, drawn, () => looked.gate),
    );
    vault.delete(old);
    const replacement = vault.put(path);
    holding.open();
    await held;
    await until(() => replacement.reads === 1);
    return { replacement, seen, editor, release: looked.open };
  }

  it("loses a write if the library's save does not wait, which is the risk", async () => {
    const { replacement, seen, editor, release } = await replacedWhileWaiting(
      new WriteQueue(),
    );
    await libraryChange(replacement, { reading: ["TYPED"] }, seen);
    release();
    await editor;
    const final = await said(replacement);
    expect(final.translation).toEqual(["DRAWN"]);
    expect(final.reading).toEqual(seen.reading);
  });

  it("keeps a library's save of the replacement out of the editor's turn", async () => {
    const queue = new WriteQueue();
    const { replacement, seen, editor, release } =
      await replacedWhileWaiting(queue);
    const library = queue.run(() =>
      libraryChange(replacement, { reading: ["TYPED"] }, seen),
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
    const old = vault.put(path);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const queue = new WriteQueue();
    const { gate, open } = gated();
    const held = queue.run(() => gate);
    const editor = queue.run(() => editorSave(vault, old, pinned, drawn));
    vault.delete(old);
    const replacement = vault.put(path);
    open();
    await held;
    await expect(editor).resolves.toBe(replacement);
    expect(old.writes).toBe(0);
    expect((await said(replacement)).translation).toEqual(["DRAWN"]);
  });

  it("asks about a replacement that holds something else", async () => {
    const vault = new FakeVault();
    const old = vault.put(path);
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    const queue = new WriteQueue();
    const { gate, open } = gated();
    const held = queue.run(() => gate);
    const editor = queue.run(() => editorSave(vault, old, pinned, pinned));
    vault.delete(old);
    const replacement = vault.put(path, theirs);
    open();
    await held;
    await expect(editor).rejects.toThrow("asks first");
    expect(replacement.writes).toBe(0);
    expect(replacement.bytes).toBe(theirs);
  });

  it("makes a deleted file once for two editors, and the other asks", async () => {
    const vault = new FakeVault();
    const old = vault.put(path);
    const first = await writeText(pinned, "reading", ["FIRST"]);
    const second = await writeText(pinned, "reading", ["SECOND"]);
    vault.delete(old);
    const queue = new WriteQueue();
    const results = await Promise.allSettled([
      queue.run(() => editorSave(vault, old, pinned, first)),
      queue.run(() => editorSave(vault, old, pinned, second)),
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(vault.at(path)?.bytes).toBe(first);
  });
});

describe("a file renamed while its save waits", () => {
  const from = "before.ink.png";
  const to = "after.ink.png";

  it("writes where the file went, and makes nothing where it was", async () => {
    const vault = new FakeVault();
    const file = vault.put(from);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const queue = new WriteQueue();
    const { gate, open } = gated();
    const held = queue.run(() => gate);
    const editor = queue.run(() => editorSave(vault, file, pinned, drawn));
    vault.rename(file, to);
    open();
    await held;
    await expect(editor).resolves.toBe(file);
    expect(vault.at(from)).toBeNull();
    expect((await said(file)).translation).toEqual(["DRAWN"]);
  });

  it("keeps a save asked for under the new name behind one under the old", async () => {
    const vault = new FakeVault();
    const file = vault.put(from);
    const seen = await said(file);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const queue = new WriteQueue();
    const looked = gated();
    const editor = queue.run(() =>
      editorSave(vault, file, pinned, drawn, () => looked.gate),
    );
    await until(() => file.reads === 1);
    // Mid-turn, so a line for each path would let the library's through now.
    vault.rename(file, to);
    const library = queue.run(() =>
      libraryChange(file, { reading: ["TYPED"] }, seen),
    );
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
    const file = vault.put(from);
    const seen = await said(file);
    const queue = new WriteQueue();
    const { gate, open } = gated();
    const held = queue.run(() => gate);
    const library = queue.run(() =>
      libraryChange(file, { reading: ["TYPED"] }, seen),
    );
    vault.rename(file, to);
    open();
    await Promise.all([held, library]);
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });
});

describe("saveFile", () => {
  const path = "a.ink.png";

  it("writes nothing when the check rejects", async () => {
    const vault = new FakeVault();
    const file = vault.put(path);
    await expect(
      saveFile({
        current: () => file,
        check: () => Promise.reject(new Error("refused")),
        write: (now) => access.write(now, pinned.slice().buffer),
        create: () => Promise.reject(new Error("not to make")),
        ...nothingMet,
      }),
    ).rejects.toThrow("refused");
    expect(file.writes).toBe(0);
  });

  it("looks again at a file that came during its look, and asks about it", async () => {
    const vault = new FakeVault();
    const old = vault.put(path);
    vault.delete(old);
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    let looks = 0;
    await expect(
      saveFile({
        current: () => vault.current(old),
        check: () => {
          looks++;
          if (looks === 1) {
            // Nothing there to look at, and then there is.
            vault.put(path, theirs);
            return Promise.resolve(undefined);
          }
          return Promise.reject(new Error("the editor asks first"));
        },
        write: () => Promise.reject(new Error("not to write")),
        create: () => Promise.reject(new Error("not to make")),
        ...nothingMet,
      }),
    ).rejects.toThrow("asks first");
    expect(looks).toBe(2);
    expect(vault.at(path)?.bytes).toBe(theirs);
  });

  it("looks again at a file that replaced the one it looked at", async () => {
    const vault = new FakeVault();
    const old = vault.put(path);
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    let replacement: Fake | undefined;
    await expect(
      editorSave(vault, old, pinned, drawn, () => {
        // Its bytes passed, and they are not what is there now.
        vault.delete(old);
        replacement = vault.put(path, theirs);
        return Promise.resolve();
      }),
    ).rejects.toThrow("asks first");
    expect(replacement?.writes).toBe(0);
    expect(replacement?.bytes).toBe(theirs);
  });

  it("makes the file again when it goes during its look", async () => {
    const vault = new FakeVault();
    const old = vault.put(path);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const made = await editorSave(vault, old, pinned, drawn, () => {
      vault.delete(old);
      return Promise.resolve();
    });
    expect(made).not.toBe(old);
    expect(vault.at(path)).toBe(made);
    expect(old.writes).toBe(0);
    expect(made.bytes).toBe(drawn);
  });

  /**
   * A replacement of the file at `path` that an editor's save falls between,
   * as in #379: the deletion runs during the save's look, and the new file,
   * holding `theirs`, lands before the vault looks as the save makes the file
   * again. Returns the editor's save, and the new file once it has landed.
   */
  function replacedAsMade(theirs: Uint8Array): {
    saving: Promise<Fake>;
    replacement: () => Fake | undefined;
  } {
    const vault = new FakeVault();
    const old = vault.put(path);
    const drawn = new Uint8Array([1, 2, 3]);
    let replacement: Fake | undefined;
    vault.beforeMake = () => {
      replacement ??= vault.put(path, theirs);
    };
    let looks = 0;
    const saving = editorSave(vault, old, pinned, drawn, () => {
      if (++looks === 1) vault.delete(old);
      return Promise.resolve();
    });
    return { saving, replacement: () => replacement };
  }

  it("looks at a file made at its path as it made one, and asks about it", async () => {
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    const { saving, replacement } = replacedAsMade(theirs);
    // Not the vault's "File already exists.": the editor's own question.
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

  it("fails as the vault does when nothing came to its path", async () => {
    let makes = 0;
    await expect(
      saveFile({
        current: () => null,
        check: () => Promise.resolve(undefined),
        write: () => Promise.reject(new Error("not to write")),
        create: () => {
          makes++;
          return Promise.reject(new Error("the disk is full"));
        },
        ...nothingMet,
      }),
    ).rejects.toThrow("the disk is full");
    expect(makes).toBe(1);
  });

  it("passes on the part of its own that its create says it left", async () => {
    // As makeFile says of a copy that stopped part-way and could not be taken
    // away, for the editor to know that file as its own.
    const vault = new FakeVault();
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const part = drawn.slice(0, 64);
    let looks = 0;
    const saving = saveFile({
      current: () => vault.at(path),
      check: () => {
        looks++;
        return Promise.resolve(undefined);
      },
      write: () => Promise.reject(new Error("not to write")),
      create: () => {
        vault.put(path, part);
        return Promise.reject(
          new CutShort(new Error("ENOSPC: no space left on device"), part),
        );
      },
      bytes: drawn,
      read: access.read,
    });
    await expect(saving).rejects.toThrow("ENOSPC");
    const error: unknown = await saving.catch((thrown: unknown) => thrown);
    expect(error instanceof CutShort && error.held).toEqual(part);
    expect(looks).toBe(1);
  });

  // makeFile has said what it left of its own: a file found after any other
  // failure is never the save's, even an empty one, which a write that stopped
  // before its first byte would also leave.
  for (const [failure, failed] of [
    ["with the path taken", () => new PathTaken()],
    ["as the disk filled", () => new Error("ENOSPC: no space left on device")],
  ] as const) {
    it(`looks at a file found at its path after its create failed ${failure}, whatever it holds`, async () => {
      const vault = new FakeVault();
      const drawn = await writeText(pinned, "translation", ["DRAWN"]);
      let looks = 0;
      await expect(
        saveFile({
          current: () => vault.at(path),
          check: () => {
            looks++;
            return vault.at(path) === null
              ? Promise.resolve(undefined)
              : Promise.reject(new Error("the editor asks first"));
          },
          write: () => Promise.reject(new Error("not to write")),
          create: () => {
            vault.put(path, new Uint8Array());
            return Promise.reject(failed());
          },
          bytes: drawn,
          read: access.read,
        }),
      ).rejects.toThrow("asks first");
      expect(looks).toBe(2);
      expect(vault.at(path)?.writes).toBe(0);
    });
  }

  // #425, at a save over a file: the vault keeps what its write left, as when
  // it makes one, as after a first failure on a disk that is still full.
  for (const [left, part] of [
    ["the start of", (drawn: Uint8Array) => drawn.slice(0, 32)],
    ["all of", (drawn: Uint8Array) => drawn.slice()],
    ["none of", () => new Uint8Array()],
  ] as const) {
    it(`fails as the vault does when its write over the file left ${left} it`, async () => {
      const vault = new FakeVault();
      const known = await writeText(pinned, "reading", ["KNOWN"]);
      const file = vault.put(path, known);
      const drawn = await writeText(pinned, "translation", ["DRAWN"]);
      const saving = saveFile({
        current: () => vault.current(file),
        check: () => Promise.resolve(undefined),
        write: (now) => {
          now.bytes = part(drawn);
          return Promise.reject(
            new Error("ENOSPC: no space left on device, write"),
          );
        },
        create: () => Promise.reject(new Error("not to make")),
        bytes: drawn,
        read: access.read,
      });
      await expect(saving).rejects.toThrow("ENOSPC");
      const error: unknown = await saving.catch((thrown: unknown) => thrown);
      expect(error instanceof CutShort && error.held).toEqual(part(drawn));
    });
  }

  it("fails as its write did when that left the file as it was", async () => {
    // As a locked file refuses the write before it opens: what is there is
    // what the check passed, which the editor knows already.
    const vault = new FakeVault();
    const file = vault.put(path);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const saving = saveFile({
      current: () => vault.current(file),
      check: () => Promise.resolve(undefined),
      write: () => Promise.reject(new Error("EBUSY: resource busy or locked")),
      create: () => Promise.reject(new Error("not to make")),
      bytes: drawn,
      read: access.read,
    });
    await expect(saving).rejects.toThrow("EBUSY");
    expect(await saving.catch((thrown: unknown) => thrown)).not.toBeInstanceOf(
      CutShort,
    );
    expect(file.bytes).toBe(pinned);
  });

  it("fails as its write did when the file was replaced as it wrote", async () => {
    // Whatever the replacement holds, it is not what this wrote.
    const vault = new FakeVault();
    const file = vault.put(path);
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const saving = saveFile({
      current: () => vault.current(file),
      check: () => Promise.resolve(undefined),
      write: (now) => {
        vault.delete(now);
        vault.put(path, drawn.slice(0, 32));
        return Promise.reject(new Error("ENOENT: no such file or directory"));
      },
      create: () => Promise.reject(new Error("not to make")),
      bytes: drawn,
      // As the vault reads a file, by its path.
      read: (found) => access.read(vault.at(found.path ?? "") ?? found),
    });
    await expect(saving).rejects.toThrow("ENOENT");
    expect(await saving.catch((thrown: unknown) => thrown)).not.toBeInstanceOf(
      CutShort,
    );
  });

  it("says why the path is taken, as create does, when the vault has nothing there", async () => {
    await expect(
      saveFile({
        current: () => null,
        check: () => Promise.resolve(undefined),
        write: () => Promise.reject(new Error("not to write")),
        create: () =>
          Promise.reject(new PathTaken("a.ink.png differs in letter case")),
        ...nothingMet,
      }),
    ).rejects.toThrow("differs in letter case");
  });

  it("leaves a file found as it made one to the next round's look, without reading it", async () => {
    const vault = new FakeVault();
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    let looks = 0;
    let makes = 0;
    let reads = 0;
    await expect(
      saveFile({
        current: () => vault.at(path),
        check: () => {
          looks++;
          // The editor's own look, which refuses what it cannot read.
          return vault.at(path) === null
            ? Promise.resolve(undefined)
            : Promise.reject(new Error("the editor cannot read it"));
        },
        write: () => Promise.reject(new Error("not to write")),
        create: () => {
          makes++;
          vault.put(path, new Uint8Array([9, 9, 9]));
          return Promise.reject(new Error("File already exists."));
        },
        bytes: drawn,
        read: () => {
          reads++;
          return Promise.reject(new Error("EIO: i/o error, read"));
        },
      }),
    ).rejects.toThrow("the editor cannot read it");
    expect({ looks, makes, reads }).toEqual({ looks: 2, makes: 1, reads: 0 });
    expect(vault.at(path)?.writes).toBe(0);
  });

  it("goes round at most three times for a file that comes as it makes one and goes", async () => {
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    let there: Fake | null = null;
    let makes = 0;
    await expect(
      saveFile({
        current: () => there,
        // Gone again as soon as it is looked at.
        check: () => {
          there = null;
          return Promise.resolve(undefined);
        },
        write: () => Promise.reject(new Error("not to write")),
        create: () => {
          // Without a bound, it would go on for good, inside the line every
          // other save waits in.
          if (++makes > 10) throw new Error("it went round for good");
          there = fake(theirs);
          return Promise.reject(new PathTaken());
        },
        bytes: pinned,
        read: access.read,
      }),
    ).rejects.toThrow("keeps changing");
    // Each look found the file gone, and the make after it found it there.
    expect(makes).toBe(2);
  });

  it("leaves a file that goes on being replaced, and says so", async () => {
    const vault = new FakeVault();
    let now = vault.put(path);
    await expect(
      saveFile({
        current: () => now,
        check: () => {
          now = vault.put(path);
          return Promise.resolve(undefined);
        },
        write: () => Promise.reject(new Error("not to write")),
        create: () => Promise.reject(new Error("not to make")),
        ...nothingMet,
      }),
    ).rejects.toThrow("keeps changing");
  });
});

describe("changeFile", () => {
  const typed = { reading: ["TYPED"] };

  it("writes nothing when nothing changes", async () => {
    const file = fake();
    const seen = await said(file);
    await libraryChange(file, { reading: seen.reading }, seen);
    expect(file.writes).toBe(0);
    expect(file.bytes).toBe(pinned);
  });

  it("goes round again for a change that lands during its own, and keeps it", async () => {
    const file = fake();
    const seen = await said(file);
    const theirs = await writeText(pinned, "translation", ["THEIRS"]);
    // After the first read, with the second, which compares them, still to come.
    file.afterRead = (reads) => {
      if (reads === 1) file.bytes = theirs;
    };
    await libraryChange(file, typed, seen);
    expect(await said(file)).toEqual({
      reading: ["TYPED"],
      translation: ["THEIRS"],
    });
  });

  it("stops at a change to the same field, with nothing written", async () => {
    const file = fake();
    const seen = await said(file);
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    file.afterRead = (reads) => {
      if (reads === 1) file.bytes = theirs;
    };
    await expect(libraryChange(file, typed, seen)).rejects.toBeInstanceOf(
      TextMoved,
    );
    expect(file.writes).toBe(0);
    expect(file.bytes).toBe(theirs);
  });

  it("goes by the bytes, as a date and a size can stay the same", async () => {
    const file = fake();
    const seen = await said(file);
    const same = pinned.slice();
    const last = same.length - 1;
    same[last] = (same[last] ?? 0) ^ 1;
    file.afterRead = (reads) => {
      if (reads === 1) file.bytes = same;
    };
    await libraryChange(file, typed, seen);
    expect(file.reads).toBeGreaterThan(2);
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });

  it("leaves a file that goes on changing, and says so", async () => {
    const file = fake();
    const seen = await said(file);
    const versions = await Promise.all(
      ["A", "B", "C", "D", "E", "F", "G"].map((word) =>
        writeText(pinned, "translation", [word]),
      ),
    );
    file.afterRead = (reads) => {
      file.bytes = versions[reads] ?? file.bytes;
    };
    await expect(libraryChange(file, typed, seen)).rejects.toThrow(
      "keeps changing",
    );
    expect(file.writes).toBe(0);
  });

  it("writes nothing to a file that went while it was read", async () => {
    const file = fake();
    const seen = await said(file);
    file.afterRead = () => {
      file.gone = true;
    };
    await expect(libraryChange(file, typed, seen)).rejects.toThrow(
      "no longer there",
    );
    expect(file.writes).toBe(0);
  });

  it("writes nothing to a file that went during its last read", async () => {
    const file = fake();
    const seen = await said(file);
    file.afterRead = (reads) => {
      if (reads === 2) file.gone = true;
    };
    await expect(libraryChange(file, typed, seen)).rejects.toThrow(
      "no longer there",
    );
    expect(file.writes).toBe(0);
  });

  it("says what is wrong with a file that is not a whole PNG", async () => {
    const file = fake(pinned.subarray(0, 40));
    await expect(
      libraryChange(file, typed, { reading: [], translation: [] }),
    ).rejects.toThrow("not a whole PNG");
    expect(file.writes).toBe(0);
  });
});

describe("A rename that waits for Obsidian", () => {
  /** What the person was told, in order. */
  let told: boolean[];
  const waiting = (still: boolean): void => {
    told.push(still);
  };
  let end: () => void;
  let fail: (error: Error) => void;
  let gate: Promise<void>;
  /** What the rename says of itself at each look. */
  let moving: boolean;
  let looks: number;
  const look = (): boolean => {
    looks++;
    return moving;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setInterval, clearInterval });
    told = [];
    moving = false;
    looks = 0;
    gate = new Promise((resolve, reject) => {
      end = resolve;
      fail = reject;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("says nothing of a rename that ends in time", async () => {
    const renamed = watchRename(gate, look, waiting);
    await vi.advanceTimersByTimeAsync(stalledAfter - 1);
    end();
    await renamed;
    await vi.advanceTimersByTimeAsync(stalledAfter * 2);
    expect(told).toEqual([]);
  });

  it("says so once nothing has happened for the wait, and when it ends", async () => {
    const renamed = watchRename(gate, look, waiting);
    await vi.advanceTimersByTimeAsync(stalledAfter - 1);
    expect(told).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(told).toEqual([true]);
    // It says so once, however long that lasts.
    await vi.advanceTimersByTimeAsync(stalledAfter * 10);
    expect(told).toEqual([true]);
    end();
    await renamed;
    expect(told).toEqual([true, false]);
  });

  it("goes on for as long as it keeps moving, then counts from the last move", async () => {
    const renamed = watchRename(gate, look, waiting);
    moving = true;
    await vi.advanceTimersByTimeAsync(stalledAfter * 20);
    expect(told).toEqual([]);
    moving = false;
    await vi.advanceTimersByTimeAsync(stalledAfter - 1);
    expect(told).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(told).toEqual([true]);
    end();
    await renamed;
  });

  it("takes it back when the rename moves again, and counts from there", async () => {
    const renamed = watchRename(gate, look, waiting);
    await vi.advanceTimersByTimeAsync(stalledAfter);
    expect(told).toEqual([true]);
    moving = true;
    await vi.advanceTimersByTimeAsync(250);
    expect(told).toEqual([true, false]);
    moving = false;
    await vi.advanceTimersByTimeAsync(stalledAfter - 1);
    expect(told).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(told).toEqual([true, false, true]);
    end();
    await renamed;
  });

  it("ends the wait as the rename fails, and fails as it did", async () => {
    const renamed = watchRename(gate, look, waiting);
    await vi.advanceTimersByTimeAsync(stalledAfter);
    fail(new Error("the disk says no"));
    await expect(renamed).rejects.toThrow("the disk says no");
    expect(told).toEqual([true, false]);
  });

  it("stops looking once the rename ends", async () => {
    const renamed = watchRename(gate, look, waiting);
    await vi.advanceTimersByTimeAsync(1000);
    end();
    await renamed;
    const seen = looks;
    await vi.advanceTimersByTimeAsync(stalledAfter * 2);
    expect(looks).toBe(seen);
  });

  it("goes by looks, so that a clock that jumps does not look like a stall", async () => {
    const renamed = watchRename(gate, look, waiting);
    await vi.advanceTimersByTimeAsync(1000);
    // A computer that slept, or a page that froze for a minute, then one look.
    vi.setSystemTime(Date.now() + 60_000);
    await vi.advanceTimersByTimeAsync(250);
    expect(told).toEqual([]);
    end();
    await renamed;
  });
});

describe("A save that waits for Obsidian", () => {
  const typed = { reading: ["TYPED"] };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** What a person waiting for a save has been told, in order. */
  function listener(): { told: boolean[]; waiting: (still: boolean) => void } {
    const told: boolean[] = [];
    return { told, waiting: (still) => told.push(still) };
  }

  /** A write that the vault does not finish, holding the queue's line. */
  async function heldWrite(queue: WriteQueue): Promise<{
    file: Fake;
    written: Promise<void>;
    open: () => void;
  }> {
    const { gate, open } = gated();
    const file = fake();
    file.held = () => gate;
    const known = file.bytes;
    const written = queue.run(() => editorWrite(file, known, pinned));
    await vi.advanceTimersByTimeAsync(0);
    expect(file.writes).toBe(1);
    return { file, written, open };
  }

  it("waits five seconds, as chosen from what large saves measured", () => {
    expect(stalledAfter).toBe(5000);
  });

  it("says nothing of a save that ends in time", async () => {
    const { told, waiting } = listener();
    const { gate, open } = gated();
    const saved = watchSave(gate, waiting);
    await vi.advanceTimersByTimeAsync(stalledAfter - 1);
    open();
    await saved;
    await vi.advanceTimersByTimeAsync(stalledAfter * 2);
    expect(told).toEqual([]);
  });

  it("says so once the wait is up, and when the save ends", async () => {
    const { told, waiting } = listener();
    const { gate, open } = gated();
    const saved = watchSave(
      gate.then(() => "done"),
      waiting,
    );
    await vi.advanceTimersByTimeAsync(stalledAfter - 1);
    expect(told).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(told).toEqual([true]);
    await vi.advanceTimersByTimeAsync(stalledAfter * 10);
    expect(told).toEqual([true]);
    open();
    await expect(saved).resolves.toBe("done");
    expect(told).toEqual([true, false]);
  });

  it("stops waiting when a save fails, and still fails", async () => {
    const { told, waiting } = listener();
    let fail = (_reason: Error): void => undefined;
    const saved = watchSave(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
      waiting,
    );
    const failed = expect(saved).rejects.toThrow("no disk");
    await vi.advanceTimersByTimeAsync(stalledAfter);
    fail(new Error("no disk"));
    await failed;
    expect(told).toEqual([true, false]);
  });

  it("keeps the line closed, however long a write takes", async () => {
    const queue = new WriteQueue();
    const { written, open } = await heldWrite(queue);
    const other = fake();
    const seen = await said(other);
    const { told, waiting } = listener();
    const behind = watchSave(
      queue.run(() => libraryChange(other, typed, seen)),
      waiting,
    );
    await vi.advanceTimersByTimeAsync(stalledAfter * 100);
    // The save behind is told, and has neither read nor written: the write
    // ahead of it could still finish, whatever it would have done by then.
    expect(told).toEqual([true]);
    expect(other.reads).toBe(0);
    expect(other.writes).toBe(0);
    open();
    await written;
    await behind;
    expect(told).toEqual([true, false]);
    expect((await said(other)).reading).toEqual(["TYPED"]);
  });

  it("leaves nothing of a save stopped in the line, which then moves on", async () => {
    const queue = new WriteQueue();
    const { written, open } = await heldWrite(queue);
    const other = fake();
    const seen = await said(other);
    const before = other.bytes;
    const { access: stopping, stop } = stoppable(access);
    const stopped = queue.run(() =>
      changeFile(stopping, other, (bytes) => changedText(bytes, typed, seen)),
    );
    const ended = expect(stopped).rejects.toThrow("stopped");
    const next = fake();
    const after = queue.run(() => libraryChange(next, typed, seen));
    await vi.advanceTimersByTimeAsync(stalledAfter);
    expect(stop()).toBe(true);
    open();
    await written;
    await ended;
    await after;
    expect(other.reads).toBe(0);
    expect(other.writes).toBe(0);
    expect(other.bytes).toBe(before);
    expect((await said(next)).reading).toEqual(["TYPED"]);
  });

  it("stops a save held in a read, before it writes", async () => {
    const queue = new WriteQueue();
    const file = fake();
    const seen = await said(file);
    const { gate, open } = gated();
    file.afterRead = (reads) => (reads === 2 ? gate : undefined);
    const { access: stopping, stop } = stoppable(access);
    const stopped = queue.run(() =>
      changeFile(stopping, file, (bytes) => changedText(bytes, typed, seen)),
    );
    const ended = expect(stopped).rejects.toThrow("stopped");
    await vi.advanceTimersByTimeAsync(0);
    await until(() => file.reads === 2);
    expect(stop()).toBe(true);
    open();
    await ended;
    expect(file.writes).toBe(0);
  });

  it("says so when a save's write has gone to the vault, and it can still finish", async () => {
    const queue = new WriteQueue();
    const file = fake();
    const seen = await said(file);
    const { gate, open } = gated();
    file.held = () => gate;
    const { access: stopping, stop } = stoppable(access);
    const saved = queue.run(() =>
      changeFile(stopping, file, (bytes) => changedText(bytes, typed, seen)),
    );
    await until(() => file.writes === 1);
    expect(stop()).toBe(false);
    open();
    await saved;
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });

  it("stops nothing by saying nothing: a save not stopped goes on", async () => {
    const file = fake();
    const seen = await said(file);
    const { access: stopping } = stoppable(access);
    await changeFile(stopping, file, (bytes) =>
      changedText(bytes, typed, seen),
    );
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });
});

/**
 * Obsidian's line of disk operations, as a test runs it: what is asked of it
 * waits until it settles, and `last` changes with each thing asked. Like
 * Obsidian's, `last` is a promise, which resolves with what the last thing
 * asked returned, so that a save which hands it on through an async function,
 * which would wait for it rather than return it, fails here.
 */
class FakeLine implements DiskLine {
  #asked: Promise<unknown> = Promise.resolve(new ArrayBuffer(0));
  readonly #waiting: (() => void)[] = [];
  /** How many times a save has waited for it. */
  settles = 0;

  readonly last = (): unknown => this.#asked;

  /** Asks the disk to `run` something, which happens once it settles. */
  ask(run: () => void = () => undefined): void {
    this.#asked = Promise.resolve(new ArrayBuffer(0));
    this.#waiting.push(run);
  }

  readonly settle = (): Promise<void> => {
    this.settles++;
    for (const run of this.#waiting.splice(0)) run();
    return Promise.resolve();
  };
}

describe("a save and the disk's line", () => {
  const typed = { reading: ["TYPED"] };

  /** A library's save with `line`, as `writeSymbolText` runs it. */
  function lineChange(
    file: Fake,
    line: DiskLine,
    seen: SymbolText,
  ): Promise<void> {
    return changeFile({ ...access, line }, file, (bytes) =>
      changedText(bytes, typed, seen),
    );
  }

  it("lets a deletion asked during the library's last read run, and writes nothing to the file", async () => {
    const file = fake();
    const seen = await said(file);
    const line = new FakeLine();
    // The second read is the last before the write: asked while it is under
    // way, as another plugin's deletion would be.
    file.afterRead = async (reads) => {
      await Promise.resolve();
      if (reads === 2) {
        line.ask(() => {
          file.gone = true;
        });
      }
    };
    await expect(lineChange(file, line, seen)).rejects.toThrow(
      "no longer there",
    );
    expect(line.settles).toBe(1);
    expect(file.writes).toBe(0);
  });

  it("writes once nothing was asked of the disk during the last read", async () => {
    const file = fake();
    const seen = await said(file);
    const line = new FakeLine();
    file.afterRead = async (reads) => {
      await Promise.resolve();
      if (reads === 2) line.ask();
    };
    await lineChange(file, line, seen);
    expect(line.settles).toBe(1);
    expect(file.reads).toBe(4);
    expect(file.writes).toBe(1);
    expect((await said(file)).reading).toEqual(["TYPED"]);
  });

  it("writes all the same once the disk stays busy, as it did before waiting", async () => {
    const file = fake();
    const seen = await said(file);
    const line = new FakeLine();
    file.afterRead = async (reads) => {
      await Promise.resolve();
      if (reads % 2 === 0) line.ask();
    };
    await lineChange(file, line, seen);
    expect(line.settles).toBe(3);
    expect(file.writes).toBe(1);
  });

  it("waits for nothing where the line cannot be seen", async () => {
    const file = fake();
    const seen = await said(file);
    await libraryChange(file, typed, seen);
    expect(file.reads).toBe(2);
    expect(file.writes).toBe(1);
  });

  it("lets a new file asked for after the editor's look come first, and asks about it", async () => {
    const vault = new FakeVault();
    const path = "a.ink.png";
    const old = vault.put(path);
    const theirs = await writeText(pinned, "reading", ["THEIRS"]);
    const line = new FakeLine();
    let replacement: Fake | undefined;
    let looks = 0;
    await expect(
      saveFile({
        current: () => vault.current(old),
        check: async () => {
          looks++;
          const now = vault.current(old);
          if (now === null) return undefined;
          const bytes = await access.read(now);
          const asked = line.last();
          if (looks === 1) {
            // Asked of the disk as the editor works out what it read.
            line.ask(() => {
              vault.delete(old);
              replacement = vault.put(path, theirs);
            });
          }
          if (bytes !== pinned) throw new Error("the editor asks first");
          return { asked };
        },
        write: (now) => access.write(now, pinned.slice().buffer),
        create: () => Promise.reject(new Error("not to make")),
        ...nothingMet,
        line,
      }),
    ).rejects.toThrow("asks first");
    expect(looks).toBe(2);
    expect(replacement?.writes).toBe(0);
    expect(replacement?.bytes).toBe(theirs);
  });

  it("looks once and waits for nothing for the editor when nothing more is asked", async () => {
    const vault = new FakeVault();
    const file = vault.put("a.ink.png");
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const line = new FakeLine();
    let looks = 0;
    const written = await saveFile({
      current: () => vault.current(file),
      // As the editor's look does: an async function, reading the file, that
      // resolves with the line as it was once the read was asked.
      check: async () => {
        looks++;
        const reading = access.read(file);
        const look = { asked: line.last() };
        await reading;
        return look;
      },
      write: (now) => access.write(now, drawn.slice().buffer),
      create: () => Promise.reject(new Error("not to make")),
      ...nothingMet,
      line,
    });
    expect(written).toBe(file);
    expect(looks).toBe(1);
    expect(line.settles).toBe(0);
    expect(file.bytes).toEqual(drawn);
  });

  it("writes all the same for the editor once the disk stays busy", async () => {
    const vault = new FakeVault();
    const file = vault.put("a.ink.png");
    const drawn = await writeText(pinned, "translation", ["DRAWN"]);
    const line = new FakeLine();
    const written = await saveFile({
      current: () => vault.current(file),
      check: () => {
        const asked = line.last();
        line.ask();
        return Promise.resolve({ asked });
      },
      write: (now) => access.write(now, drawn.slice().buffer),
      create: () => Promise.reject(new Error("not to make")),
      ...nothingMet,
      line,
    });
    expect(written).toBe(file);
    expect(line.settles).toBe(3);
    expect(file.bytes).toEqual(drawn);
  });
});

/**
 * Obsidian's desktop file system adapter, as far as making a file goes: one
 * line, which every request joins as it is asked, as `queue` does in the
 * `app.js` of Obsidian 1.13.4 and 1.15.1, and whose requests act on the files
 * as they run. Its `copy` is one request that makes the copy only where
 * nothing is, as the adapter's does with `COPYFILE_EXCL`, failing with the
 * code `EEXIST` otherwise.
 */
class FakeAdapter {
  promise: Promise<unknown> = Promise.resolve();
  readonly files = new Map<string, Uint8Array>();
  /** Every request, as its kind and path, in the order run. */
  readonly ran: string[] = [];
  /** Has the next copy stop after this many bytes, as on a full disk. */
  copyStopsAfter: number | undefined;
  /** Has the next removal of this path fail, as of a file held open. */
  removeRefuses: string | undefined;

  #queue<T>(task: () => T): Promise<T> {
    const done = this.promise.then(task, task);
    this.promise = done;
    return done;
  }

  exists(path: string): Promise<boolean> {
    return this.#queue(() => {
      this.ran.push(`exists ${path}`);
      return this.files.has(path);
    });
  }

  read(path: string): Promise<Uint8Array> {
    return this.#queue(() => {
      this.ran.push(`read ${path}`);
      const bytes = this.files.get(path);
      if (bytes === undefined) throw new Error(`ENOENT: ${path}`);
      return bytes;
    });
  }

  writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    return this.#queue(() => {
      this.ran.push(`write ${path}`);
      this.files.set(path, bytes);
    });
  }

  copy(from: string, to: string): Promise<void> {
    return this.#queue(() => {
      this.ran.push(`copy ${to}`);
      const bytes = this.files.get(from);
      if (bytes === undefined) throw new Error(`ENOENT: ${from}`);
      if (this.files.has(to)) {
        throw Object.assign(new Error(`EEXIST: ${to}`), { code: "EEXIST" });
      }
      const stops = this.copyStopsAfter;
      this.copyStopsAfter = undefined;
      if (stops === undefined) {
        this.files.set(to, bytes);
        return;
      }
      this.files.set(to, bytes.slice(0, stops));
      throw Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
      });
    });
  }

  remove(path: string): Promise<void> {
    return this.#queue(() => {
      this.ran.push(`remove ${path}`);
      if (this.removeRefuses === path) {
        this.removeRefuses = undefined;
        throw new Error(`EBUSY: ${path}`);
      }
      if (!this.files.delete(path)) throw new Error(`ENOENT: ${path}`);
    });
  }
}

/** Where {@link making} writes its own file before it makes one. */
const own = ".making-1";

/**
 * The file at `path` made with `adapter`, as `makeSymbolFile` makes one, with
 * its own file at {@link own}. `staging` runs as its own file is asked for.
 */
function making(
  adapter: FakeAdapter,
  path: string,
  bytes: Uint8Array,
  { staging }: { staging?: () => void } = {},
): NewFile {
  return {
    bytes,
    exists: () => adapter.exists(path),
    stage: () => {
      staging?.();
      return adapter.writeBinary(own, bytes);
    },
    place: () => adapter.copy(own, path),
    taken: (error) =>
      typeof error === "object" &&
      error !== null &&
      Reflect.get(error, "code") === "EEXIST",
    read: () => adapter.read(path),
    clear: () => adapter.remove(path),
    unstage: () => adapter.remove(own),
  };
}

describe("makeFile", () => {
  const path = "a.ink.png";
  const ours = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const theirs = new Uint8Array([7, 8, 9]);

  it("makes a file where the disk has nothing, and takes its own away", async () => {
    const adapter = new FakeAdapter();
    await makeFile(making(adapter, path, ours));
    expect(adapter.files.get(path)).toBe(ours);
    expect(adapter.files.has(own)).toBe(false);
    expect(adapter.ran).toEqual([
      `exists ${path}`,
      `write ${own}`,
      `copy ${path}`,
      `remove ${own}`,
    ]);
  });

  it("leaves a file asked for just after its look, as the vault's own would write over it", async () => {
    // #413. The vault's createBinary looks, and asks for its write once it
    // has the answer: a file asked for in between runs first.
    const vault = new FakeAdapter();
    const look = vault.exists(path);
    void vault.writeBinary(path, theirs);
    if (!(await look)) await vault.writeBinary(path, ours);
    expect(vault.files.get(path)).toBe(ours);
    // The copy makes the file only where nothing is.
    const adapter = new FakeAdapter();
    const made = making(adapter, path, ours);
    await expect(
      makeFile({
        ...made,
        exists: () => {
          const looking = made.exists();
          void adapter.writeBinary(path, theirs);
          return looking;
        },
      }),
    ).rejects.toThrow(PathTaken);
    expect(adapter.files.get(path)).toBe(theirs);
    expect(adapter.files.has(own)).toBe(false);
  });

  it("leaves a file that comes as it writes its own, and writes nothing there", async () => {
    const adapter = new FakeAdapter();
    await expect(
      makeFile(
        making(adapter, path, ours, {
          staging: () => void adapter.writeBinary(path, theirs),
        }),
      ),
    ).rejects.toThrow(PathTaken);
    expect(adapter.files.get(path)).toBe(theirs);
    expect(adapter.files.has(own)).toBe(false);
  });

  it("leaves a file asked for before its look, and writes nothing of its own", async () => {
    const adapter = new FakeAdapter();
    void adapter.writeBinary(path, theirs);
    await expect(makeFile(making(adapter, path, ours))).rejects.toThrow(
      PathTaken,
    );
    expect(adapter.files.get(path)).toBe(theirs);
    expect(adapter.ran).not.toContain(`write ${own}`);
  });

  /**
   * Has `adapter` do `ask(n)` for n from 1 to `count`, each once the one
   * before has run, as another plugin or Inkline's own index reading file
   * after file does, and says how many have run.
   */
  function chain(
    adapter: FakeAdapter,
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
    const adapter = new FakeAdapter();
    adapter.files.set("note.md", theirs);
    const reads = chain(adapter, 300, () => adapter.read("note.md"));
    await makeFile(making(adapter, path, ours));
    expect(adapter.files.get(path)).toBe(ours);
    expect(reads()).toBeLessThan(10);
  });

  // A plugin writing its files one after another, and one of them at the path,
  // at each place in the run: a file it makes there before the copy is left,
  // and one after it is its own write over the symbol, as any write is.
  for (const nth of [1, 2, 3, 4, 5, 14]) {
    it(`leaves a file that a run of writes makes at its path first, as write ${String(nth)} of 14`, async () => {
      const adapter = new FakeAdapter();
      const writes = chain(adapter, 14, (n) =>
        adapter.writeBinary(n === nth ? path : `${String(n)}.md`, theirs),
      );
      const outcome = await makeFile(making(adapter, path, ours)).then(
        () => "made",
        (error: unknown) => (error instanceof PathTaken ? "left" : error),
      );
      await until(() => writes() === 14);
      const theirsAt = adapter.ran.indexOf(`write ${path}`);
      const copyAt = adapter.ran.indexOf(`copy ${path}`);
      // No copy at all when the look found it.
      expect(outcome).toBe(
        copyAt === -1 || theirsAt < copyAt ? "left" : "made",
      );
      expect(adapter.files.get(path)).toBe(theirs);
      expect(adapter.files.has(own)).toBe(false);
    });
  }

  it("leaves nothing at the path when its own file cannot be written whole", async () => {
    const adapter = new FakeAdapter();
    const made = making(adapter, path, ours);
    await expect(
      makeFile({
        ...made,
        stage: async () => {
          await adapter.writeBinary(own, ours.slice(0, 2));
          throw new Error("ENOSPC: no space left on device");
        },
      }),
    ).rejects.toThrow("ENOSPC");
    expect(adapter.files.has(path)).toBe(false);
    expect(adapter.files.has(own)).toBe(false);
    expect(adapter.ran).not.toContain(`copy ${path}`);
  });

  for (const [left, stops] of [
    ["the start of", 2],
    ["none of", 0],
  ] as const) {
    it(`takes away ${left} the file that a copy cut short left, and fails as it did`, async () => {
      const adapter = new FakeAdapter();
      adapter.copyStopsAfter = stops;
      const failure = await makeFile(making(adapter, path, ours)).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(CutShort);
      expect(String(failure)).toContain("ENOSPC");
      expect(adapter.files.has(path)).toBe(false);
      expect(adapter.files.has(own)).toBe(false);
    });
  }

  it("says what a copy cut short left, when it cannot take that away", async () => {
    const adapter = new FakeAdapter();
    adapter.copyStopsAfter = 2;
    adapter.removeRefuses = path;
    const failure = await makeFile(making(adapter, path, ours)).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CutShort);
    expect(failure instanceof CutShort && failure.held).toEqual(
      ours.slice(0, 2),
    );
    expect(String(failure)).toContain("ENOSPC");
    expect(adapter.files.get(path)).toEqual(ours.slice(0, 2));
    expect(adapter.files.has(own)).toBe(false);
  });

  it("leaves what is at the path after a failed copy if it is not the start of its bytes", async () => {
    // As a file another program wrote there once the copy had failed.
    const adapter = new FakeAdapter();
    const made = making(adapter, path, ours);
    await expect(
      makeFile({
        ...made,
        place: async () => {
          await adapter.writeBinary(path, theirs);
          throw new Error("EIO: i/o error");
        },
      }),
    ).rejects.toThrow("EIO");
    expect(adapter.files.get(path)).toBe(theirs);
    expect(adapter.ran).not.toContain(`remove ${path}`);
  });

  it("makes the file all the same when its own cannot be taken away", async () => {
    // Left for the sweep as Inkline next starts.
    const adapter = new FakeAdapter();
    adapter.removeRefuses = own;
    await makeFile(making(adapter, path, ours));
    expect(adapter.files.get(path)).toBe(ours);
    expect(adapter.files.has(own)).toBe(true);
  });
});

describe("withoutPaths", () => {
  const said = "as the symbol was put at Signs/gate.ink.png";

  it("says the file a person knows in place of the paths Node.js names", () => {
    const failed = Object.assign(
      new Error(
        "ENOENT: no such file or directory, copyfile '/vault/.obsidian/plugins/inkline/.making-1' -> '/vault/Signs/gate.ink.png'",
      ),
      { code: "ENOENT" },
    );
    const plain = withoutPaths(failed, said);
    expect(plain).toBeInstanceOf(Error);
    expect(String(plain)).toBe(
      "Error: ENOENT: no such file or directory, as the symbol was put at Signs/gate.ink.png",
    );
    expect(plain instanceof Error && Reflect.get(plain, "code")).toBe("ENOENT");
  });

  it("leaves an error that names no path as it is", () => {
    const failed = new Error("ENOSPC: no space left on device, write");
    expect(withoutPaths(failed, said)).toBe(failed);
    expect(withoutPaths("not an error", said)).toBe("not an error");
  });
});
