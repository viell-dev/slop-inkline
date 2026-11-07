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
  saveFile,
  stalledAfter,
  stoppable,
  TextMoved,
  watchSave,
  WriteQueue,
  type FileAccess,
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

  put(path: string, bytes: Uint8Array = pinned): Fake {
    const file = { ...fake(bytes), path };
    this.#files.set(path, file);
    return file;
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
    create: () => Promise.resolve(vault.put(file.path ?? "", written)),
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
            return Promise.resolve();
          }
          return Promise.reject(new Error("the editor asks first"));
        },
        write: () => Promise.reject(new Error("not to write")),
        create: () => Promise.reject(new Error("not to make")),
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

  it("leaves a file that goes on being replaced, and says so", async () => {
    const vault = new FakeVault();
    let now = vault.put(path);
    await expect(
      saveFile({
        current: () => now,
        check: () => {
          now = vault.put(path);
          return Promise.resolve();
        },
        write: () => Promise.reject(new Error("not to write")),
        create: () => Promise.reject(new Error("not to make")),
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
