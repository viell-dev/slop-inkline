import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { readChunks, writeChunks } from "../../../src/format/png.ts";
import { writeText } from "../../../src/format/text.ts";
import {
  maxIndexedAttempts,
  maxIndexedBytes,
  SymbolTextIndex,
} from "../../../src/notes/text-index.ts";

const plain = new Uint8Array(
  await readFile(
    path.resolve(
      import.meta.dirname,
      "../../fixtures/format/v1-strokes.ink.png",
    ),
  ),
);

/** A symbol file in a fake vault. */
interface Fake {
  name: string;
  bytes: Uint8Array;
  size?: number;
  /** What its read waits for, if anything. */
  gate?: Promise<void>;
  failing?: boolean;
}

async function said(...values: readonly string[]): Promise<Uint8Array> {
  return writeText(plain, "reading", values);
}

/** An index over `files`, counting what it reads and tells. */
function indexOf(files: Fake[]) {
  const counts = { reads: 0, caughtUp: 0 };
  const index = new SymbolTextIndex<Fake>(
    {
      files: () => files,
      size: (file) => file.size ?? file.bytes.length,
      read: async (file) => {
        counts.reads++;
        await file.gate;
        if (file.failing === true) throw new Error("held by another program");
        return file.bytes;
      },
    },
    () => {
      counts.caughtUp++;
    },
  );
  return { index, counts };
}

/** Waits until nothing is left to read. */
async function settled(index: SymbolTextIndex<Fake>): Promise<void> {
  while (index.reading) {
    await wait(1);
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

const readings = (index: SymbolTextIndex<Fake>, file: Fake) =>
  index.textOf(file)?.text.reading;

describe("SymbolTextIndex", () => {
  it("reads every file in the background, and says when it has caught up", async () => {
    const files = [
      { name: "a", bytes: await said("TA") },
      { name: "b", bytes: await said("KA", "GA") },
      { name: "c", bytes: plain },
    ];
    const { index, counts } = indexOf(files);
    index.start();
    expect(index.reading).toBe(true);
    await settled(index);
    expect(readings(index, files[0] as Fake)).toEqual(["TA"]);
    expect(readings(index, files[1] as Fake)).toEqual(["KA", "GA"]);
    expect(readings(index, files[2] as Fake)).toEqual([]);
    expect(counts).toEqual({ reads: 3, caughtUp: 1 });
  });

  it("answers from what it has while it reads, without waiting", async () => {
    const { gate, open } = gated();
    const slow = { name: "slow", bytes: await said("KA"), gate };
    const quick = { name: "quick", bytes: await said("TA") };
    const { index } = indexOf([quick, slow]);
    index.start();
    while (index.textOf(quick) === undefined) {
      await wait(1);
    }
    expect(index.reading).toBe(true);
    expect(index.textOf(slow)).toBeUndefined();
    open();
    await settled(index);
    expect(readings(index, slow)).toEqual(["KA"]);
  });

  it("goes on past a damaged file, which says nothing", async () => {
    const damaged = { name: "damaged", bytes: plain.subarray(0, 40) };
    const empty = { name: "empty", bytes: new Uint8Array() };
    const after = { name: "after", bytes: await said("TA") };
    const { index } = indexOf([damaged, empty, after]);
    index.start();
    await settled(index);
    expect(readings(index, damaged)).toEqual([]);
    expect(readings(index, empty)).toEqual([]);
    expect(readings(index, after)).toEqual(["TA"]);
  });

  it("declines a file larger than a symbol can be, without reading it", async () => {
    const large = {
      name: "large",
      bytes: await said("TA"),
      size: maxIndexedBytes + 1,
    };
    const { index, counts } = indexOf([large]);
    index.start();
    await settled(index);
    expect(readings(index, large)).toEqual([]);
    expect(counts.reads).toBe(0);
  });

  it("declines a field with more void chunks than it will try", async () => {
    const keyword = new TextEncoder().encode("Inkline reading");
    const unusable = new Uint8Array(keyword.length + 2);
    unusable.set(keyword);
    const padded = (count: number): Uint8Array => {
      const [header, ...rest] = readChunks(plain);
      if (header === undefined) throw new Error("no chunks");
      return writeChunks([
        header,
        ...Array.from({ length: count }, () => ({
          type: "zTXt",
          data: unusable,
        })),
        ...rest,
      ]);
    };
    const within = {
      name: "within",
      bytes: await writeText(padded(maxIndexedAttempts - 1), "reading", ["TA"]),
    };
    // Past the limit once the chunk it would have used is behind them.
    const past = {
      name: "past",
      bytes: await (async () => {
        const chunks = readChunks(await said("TA"));
        const text = chunks.find(({ type }) => type === "iTXt");
        if (text === undefined) throw new Error("no text");
        const [header, ...rest] = chunks.filter((each) => each !== text);
        if (header === undefined) throw new Error("no chunks");
        return writeChunks([
          header,
          ...Array.from({ length: maxIndexedAttempts }, () => ({
            type: "zTXt",
            data: unusable,
          })),
          text,
          ...rest,
        ]);
      })(),
    };
    const { index } = indexOf([within, past]);
    index.start();
    await settled(index);
    expect(readings(index, within)).toEqual(["TA"]);
    expect(readings(index, past)).toEqual([]);
  });

  it("reads a changed file again, and keeps what it knew if it cannot", async () => {
    const file: Fake = { name: "a", bytes: await said("TA") };
    const { index } = indexOf([file]);
    index.start();
    await settled(index);
    file.bytes = await said("KA");
    index.changed(file);
    await settled(index);
    expect(readings(index, file)).toEqual(["KA"]);
    file.failing = true;
    index.changed(file);
    await settled(index);
    expect(readings(index, file)).toEqual(["KA"]);
  });

  it("reads again a file that changes while it is read", async () => {
    const { gate, open } = gated();
    const file: Fake = { name: "a", bytes: await said("TA"), gate };
    const { index, counts } = indexOf([file]);
    index.start();
    while (counts.reads === 0) {
      await wait(1);
    }
    file.bytes = await said("KA");
    index.changed(file);
    open();
    await settled(index);
    expect(counts.reads).toBe(2);
    expect(readings(index, file)).toEqual(["KA"]);
  });

  it("drops a file that goes, even while it is read", async () => {
    const { gate, open } = gated();
    const file = { name: "a", bytes: await said("TA"), gate };
    const { index, counts } = indexOf([file]);
    index.start();
    while (counts.reads === 0) {
      await wait(1);
    }
    index.removed(file);
    open();
    await settled(index);
    expect(index.textOf(file)).toBeUndefined();
  });

  it("reads a file now for a caller that changed it, ahead of the rest", async () => {
    const { gate, open } = gated();
    const file: Fake = { name: "a", bytes: await said("TA") };
    const slow = { name: "slow", bytes: await said("GA"), gate };
    const { index } = indexOf([slow, file]);
    index.start();
    file.bytes = await said("KA");
    await index.refresh(file);
    expect(readings(index, file)).toEqual(["KA"]);
    expect(index.reading).toBe(true);
    open();
    await settled(index);
  });

  it("stops reading, and forgets, when stopped", async () => {
    const { gate, open } = gated();
    const first = { name: "a", bytes: await said("TA"), gate };
    const second = { name: "b", bytes: await said("KA") };
    const { index, counts } = indexOf([first, second]);
    index.start();
    while (counts.reads === 0) {
      await wait(1);
    }
    index.stop();
    open();
    await settled(index);
    expect(counts.reads).toBe(1);
    expect(counts.caughtUp).toBe(0);
    expect(index.textOf(first)).toBeUndefined();
    index.changed(second);
    expect(index.reading).toBe(false);
  });

  it("reports nothing to read in an empty vault", () => {
    const { index, counts } = indexOf([]);
    index.start();
    expect(index.reading).toBe(false);
    expect(counts.caughtUp).toBe(0);
  });
});
