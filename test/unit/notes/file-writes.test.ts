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

/**
 * A change of `changes`, typed over `seen`, as {@link changeFile} makes it with
 * {@link changedText}. Inkline's own, through its line of writes, is tested in
 * symbol-writes.test.ts.
 */
function textChange(
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

  /** The file to save over for a save of `file`: it, or what is at its path. */
  current(file: Fake): Fake | null {
    return file.gone === true ? this.at(file.path ?? "") : file;
  }
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
      textChange(file, { reading: ["FIRST"] }, seen),
      textChange(file, { translation: ["SECOND"] }, seen),
    ]);
    const final = await said(file);
    expect(final.translation).toEqual(["SECOND"]);
    expect(final.reading).toEqual(seen.reading);
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
    await textChange(file, { reading: seen.reading }, seen);
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
    await textChange(file, typed, seen);
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
    await expect(textChange(file, typed, seen)).rejects.toBeInstanceOf(
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
    await textChange(file, typed, seen);
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
    await expect(textChange(file, typed, seen)).rejects.toThrow(
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
    await expect(textChange(file, typed, seen)).rejects.toThrow(
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
    await expect(textChange(file, typed, seen)).rejects.toThrow(
      "no longer there",
    );
    expect(file.writes).toBe(0);
  });

  it("says what is wrong with a file that is not a whole PNG", async () => {
    const file = fake(pinned.subarray(0, 40));
    await expect(
      textChange(file, typed, { reading: [], translation: [] }),
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
    const renamed = watchRename(gate, look, waiting, stalledAfter);
    await vi.advanceTimersByTimeAsync(stalledAfter - 1);
    end();
    await renamed;
    await vi.advanceTimersByTimeAsync(stalledAfter * 2);
    expect(told).toEqual([]);
  });

  it("says so once nothing has happened for the wait, and when it ends", async () => {
    const renamed = watchRename(gate, look, waiting, stalledAfter);
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
    const renamed = watchRename(gate, look, waiting, stalledAfter);
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
    const renamed = watchRename(gate, look, waiting, stalledAfter);
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
    const renamed = watchRename(gate, look, waiting, stalledAfter);
    await vi.advanceTimersByTimeAsync(stalledAfter);
    fail(new Error("the disk says no"));
    await expect(renamed).rejects.toThrow("the disk says no");
    expect(told).toEqual([true, false]);
  });

  it("stops looking once the rename ends", async () => {
    const renamed = watchRename(gate, look, waiting, stalledAfter);
    await vi.advanceTimersByTimeAsync(1000);
    end();
    await renamed;
    const seen = looks;
    await vi.advanceTimersByTimeAsync(stalledAfter * 2);
    expect(looks).toBe(seen);
  });

  it("waits as long as it is given, as the tests' shorter wait", async () => {
    const renamed = watchRename(gate, look, waiting, 2000);
    await vi.advanceTimersByTimeAsync(1999);
    expect(told).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(told).toEqual([true]);
    end();
    await renamed;
    expect(told).toEqual([true, false]);
  });

  it("goes by looks, so that a clock that jumps does not look like a stall", async () => {
    const renamed = watchRename(gate, look, waiting, stalledAfter);
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
    const saved = watchSave(gate, waiting, stalledAfter);
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
      stalledAfter,
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

  it("waits as long as it is given, as the tests' shorter wait", async () => {
    const { told, waiting } = listener();
    const { gate, open } = gated();
    const saved = watchSave(gate, waiting, 2000);
    await vi.advanceTimersByTimeAsync(1999);
    expect(told).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(told).toEqual([true]);
    open();
    await saved;
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
      stalledAfter,
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
      queue.run(() => textChange(other, typed, seen)),
      waiting,
      stalledAfter,
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
    const after = queue.run(() => textChange(next, typed, seen));
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

  /** A change made with {@link changeFile} that sees `line`. */
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
    await textChange(file, typed, seen);
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
      // An async function, reading the file, that resolves with the line as
      // it was once the read was asked.
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
