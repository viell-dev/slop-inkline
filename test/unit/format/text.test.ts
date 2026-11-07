import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  preservableChunks,
  readInkFile,
  recordChunkType,
  writeInkFile,
} from "../../../src/format/ink-file.ts";
import {
  PngError,
  inflate,
  maxChunks,
  readChunks,
  spliceChunks,
  writeChunks,
  type Chunk,
} from "../../../src/format/png.ts";
import {
  TextError,
  maxTextBytes,
  readText,
  textKeywords,
  textProblem,
  writeText,
  type TextField,
} from "../../../src/format/text.ts";
import { goldenFiles, iTxtData } from "../../fixtures/format/records.ts";
import {
  passedOver,
  textCases,
  usedAfter,
} from "../../fixtures/format/text-cases.ts";

// The real thing, watched: a stream far past the limit is void with or without
// it, so that only what `inflate` was asked to do tells the two apart.
vi.mock(import("../../../src/format/png.ts"), async (importOriginal) => {
  const png = await importOriginal();
  return { ...png, inflate: vi.fn(png.inflate) };
});

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/format");

async function golden(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(fixtures, `${name}.ink.png`)));
}

/** A golden file with no text, to which a test adds its own. */
const plain = await golden("v1-strokes");

/** A file with chunks added either side of its image data. */
function withChunks(
  file: Uint8Array,
  beforeData: readonly Chunk[],
  afterData: readonly Chunk[] = [],
): Uint8Array {
  const chunks = readChunks(file);
  const first = chunks.findIndex(({ type }) => type === "IDAT");
  const last = chunks.findLastIndex(({ type }) => type === "IDAT");
  return writeChunks([
    ...chunks.slice(0, first),
    ...beforeData,
    ...chunks.slice(first, last + 1),
    ...afterData,
    ...chunks.slice(last + 1),
  ]);
}

const readings = (values: string): Chunk => ({
  type: "iTXt",
  data: iTxtData(textKeywords.reading, values),
});
const translations = (values: string): Chunk => ({
  type: "iTXt",
  data: iTxtData(textKeywords.translation, values),
});

/**
 * A file's chunks as raw bytes, each with its length and CRC, found by walking
 * the file rather than with the code under test, and what follows `IEND`.
 */
function rawChunks(file: Uint8Array): string[] {
  const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const found: string[] = [];
  let offset = 8;
  for (;;) {
    const end = offset + 12 + view.getUint32(offset);
    found.push(hex(file.subarray(offset, end)));
    const type = String.fromCharCode(...file.subarray(offset + 4, offset + 8));
    offset = end;
    if (type !== "IEND") continue;
    if (offset < file.length) found.push(hex(file.subarray(offset)));
    return found;
  }
}

/** A chunk as {@link rawChunks} gives it, as a file would hold it. */
const raw = (chunk: Chunk): string => {
  const file = writeChunks([chunk]);
  return Buffer.from(file.subarray(8)).toString("hex");
};

/** Which chunks of a file hold a field's keyword, in order, as raw bytes. */
function keywordChunks(file: Uint8Array, field: TextField): Chunk[] {
  const keyword = new TextEncoder().encode(`${textKeywords[field]}\0`);
  return readChunks(file).filter(({ data }) =>
    keyword.every((byte, index) => data[index] === byte),
  );
}

/** A file with one bit of a chunk's data flipped, which leaves its CRC wrong. */
function flipped(file: Uint8Array, type: string, index: number): Uint8Array {
  const copy = file.slice();
  const chunk = readChunks(copy).find((each) => each.type === type);
  if (chunk === undefined) throw new Error(`no ${type}`);
  chunk.data.set([(chunk.data[index] ?? 0) ^ 1], index);
  return copy;
}

/** A file's readings. */
async function readingsOf(file: Uint8Array): Promise<readonly string[]> {
  return (await readText(readChunks(file))).reading;
}

describe("readText", () => {
  it("reads v1-text's two lists, in their order", async () => {
    const chunks = readChunks(await golden("v1-text"));
    expect(await readText(chunks)).toEqual({
      reading: ["TA", "た"],
      translation: ["rice field", "田"],
    });
  });

  it("finds nothing in a file with none, as a file needs none", async () => {
    for (const name of Object.keys(goldenFiles)) {
      if (name === "v1-text") continue;
      const chunks = readChunks(await golden(name));
      expect(await readText(chunks)).toEqual({ reading: [], translation: [] });
    }
  });

  for (const { name, chunk, values } of textCases) {
    it(`takes ${JSON.stringify(values).slice(0, 30)} from ${name}`, async () => {
      expect(await readingsOf(withChunks(plain, [chunk]))).toEqual(values);
    });
  }

  it("passes over a chunk with a bad CRC", async () => {
    const file = withChunks(plain, [readings("TA")]);
    const damaged = flipped(file, "iTXt", textKeywords.reading.length + 5);
    expect(await readingsOf(damaged)).toEqual([]);
  });

  it("uses the first usable chunk, each keyword on its own", async () => {
    const file = withChunks(
      plain,
      [...passedOver, translations("first")],
      [usedAfter, readings("later"), translations("later")],
    );
    expect(await readText(readChunks(file))).toEqual({
      reading: ["DA"],
      translation: ["first"],
    });
  });

  it("looks after the image data too", async () => {
    const file = withChunks(plain, [readings("TA")], [translations("field")]);
    expect(await readText(readChunks(file))).toEqual({
      reading: ["TA"],
      translation: ["field"],
    });
  });

  it("decompresses text no further than its limit", async () => {
    const found = textCases.find(({ name }) =>
      name.startsWith("many times the limit"),
    );
    if (found === undefined) throw new Error("no such text case");
    const file = withChunks(plain, [found.chunk]);
    vi.mocked(inflate).mockClear();
    expect(await readingsOf(file)).toEqual([]);
    expect(inflate).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      limit: maxTextBytes,
    });
  });

  it("does not depend on the record", async () => {
    const chunks = readChunks(await golden("v1-text"));
    const without = chunks.filter(({ type }) => type !== recordChunkType);
    const expected = await readText(chunks);
    expect(await readText(without)).toEqual(expected);
    const newer: Chunk = {
      type: recordChunkType,
      data: Uint8Array.of(0, 0, 0, 2, 0xff),
    };
    const [header, ...rest] = without;
    if (header === undefined) throw new Error("no header");
    const file = writeChunks([header, newer, ...rest]);
    expect((await readInkFile(file)).kind).toBe("pixels");
    expect(await readText(readChunks(file))).toEqual(expected);
  });
});

describe("textProblem", () => {
  it("takes no values, as that clears a field", () => {
    expect(textProblem([])).toBeUndefined();
  });

  it("takes what the rules allow, as it is", () => {
    const fits = "x".repeat(maxTextBytes - 3);
    for (const values of [
      ["TA", "DA"],
      [" TA "],
      ["\u00a0"],
      ["𐎠"],
      ["e\u0301", "\u00e9"],
      ["TA", "\ufeffDA"],
      ["ta?"],
      [fits, "xx"],
    ]) {
      expect(textProblem(values)).toBeUndefined();
    }
  });

  it("refuses what the rules do not", () => {
    for (const values of [
      [""],
      ["TA", ""],
      ["TA\n"],
      ["TA\nDA"],
      ["TA\r"],
      ["\tTA"],
      ["TA\u0000"],
      ["TA\u007f"],
      ["TA\u0085"],
      ["TA\u2028"],
      ["TA\u2029"],
      ["\ufeffTA"],
      ["\ud83dTA"],
      ["TA\udc00"],
      ["x".repeat(maxTextBytes + 1)],
      ["x".repeat(maxTextBytes - 2), "xx"],
      ["た".repeat(1366)],
    ]) {
      expect(textProblem(values), JSON.stringify(values)).toBeTypeOf("string");
    }
  });
});

describe("writeText", () => {
  it("writes v1-text's chunks, in the file that a save pinned", async () => {
    const pinned = await golden("v1-text");
    const chunks = readChunks(pinned);
    const bare = writeChunks(chunks.filter(({ type }) => type !== "iTXt"));
    const reading = await writeText(bare, "reading", ["TA", "た"]);
    const both = await writeText(reading, "translation", ["rice field", "田"]);
    expect(both).toEqual(pinned);
  });

  it("reads back what it wrote, however odd", async () => {
    for (const values of [
      ["TA"],
      [" た ", "𐎠", "e\u0301", "\u00e9"],
      ["TA", "\ufeffDA"],
      ["x".repeat(maxTextBytes)],
      ["|", "]]", "<b>", "#", "a/b"],
    ]) {
      const file = await writeText(plain, "reading", values);
      expect(await readingsOf(file)).toEqual(values);
    }
  });

  it("changes only the chunk of the field it changes", async () => {
    const comment: Chunk = {
      type: "tEXt",
      data: new TextEncoder().encode("Comment\0from another tool"),
    };
    const later: Chunk = {
      type: "iTXt",
      data: iTxtData("Inkline origin", "a later keyword"),
    };
    const file = withChunks(
      plain,
      [comment, readings("TA"), translations("field"), later],
      [comment],
    );
    const before = rawChunks(file);
    const changed = await writeText(file, "reading", ["KA"]);
    const index = before.indexOf(raw(readings("TA")));
    expect(index).toBeGreaterThan(0);
    expect(rawChunks(changed)).toEqual(before.with(index, raw(readings("KA"))));
    expect(await readText(readChunks(changed))).toEqual({
      reading: ["KA"],
      translation: ["field"],
    });
  });

  it("replaces every usable chunk, compressed or not, and clears them all", async () => {
    const kinds = textCases
      .filter(({ name }) =>
        ["tEXt", "zTXt", "iTXt", "compressed iTXt"].includes(name),
      )
      .map(({ chunk }) => chunk);
    expect(kinds).toHaveLength(4);
    const file = withChunks(plain, kinds.slice(0, 2), kinds.slice(2));
    const other = rawChunks(plain);

    const changed = await writeText(file, "reading", ["KA"]);
    expect(keywordChunks(changed, "reading")).toEqual([readings("KA")]);
    expect(await readingsOf(changed)).toEqual(["KA"]);

    const cleared = await writeText(file, "reading", []);
    expect(keywordChunks(cleared, "reading")).toEqual([]);
    expect(await readingsOf(cleared)).toEqual([]);
    expect(rawChunks(cleared)).toEqual(other);
  });

  it("moves a field's chunk before the image data", async () => {
    const file = withChunks(plain, [], [readings("TA")]);
    const changed = await writeText(file, "reading", ["KA"]);
    const types = readChunks(changed).map(({ type }) => type);
    expect(types.indexOf("iTXt")).toBeLessThan(types.indexOf("IDAT"));
    expect(types.filter((type) => type === "iTXt")).toHaveLength(1);
  });

  describe("with a chunk of the field that it cannot use", () => {
    const tooLong = readings("x".repeat(maxTextBytes + 904));
    const trailing = readings("TA\nDA\n");
    const empty = readings("");

    it("keeps a list a person never saw, and puts the new value first", async () => {
      for (const unusable of [tooLong, trailing, empty]) {
        const file = withChunks(plain, [unusable]);
        const before = rawChunks(file);
        expect(await readingsOf(file)).toEqual([]);

        const changed = await writeText(file, "reading", ["TA"]);
        const index = before.indexOf(raw(unusable));
        expect(rawChunks(changed)).toEqual(
          before.toSpliced(index, 0, raw(readings("TA"))),
        );
        expect(await readingsOf(changed)).toEqual(["TA"]);

        // Later changes go on replacing the program's own chunk alone.
        const again = await writeText(changed, "reading", ["KA"]);
        expect(keywordChunks(again, "reading")).toEqual([
          readings("KA"),
          unusable,
        ]);
        const cleared = await writeText(again, "reading", []);
        expect(rawChunks(cleared)).toEqual(before);
      }
    });

    it("puts the new value first wherever the old ones lay", async () => {
      const file = withChunks(
        plain,
        [tooLong, readings("old")],
        [trailing, readings("older")],
      );
      expect(await readingsOf(file)).toEqual(["old"]);
      const changed = await writeText(file, "reading", ["new"]);
      expect(keywordChunks(changed, "reading")).toEqual([
        readings("new"),
        tooLong,
        trailing,
      ]);
      expect(await readingsOf(changed)).toEqual(["new"]);
    });

    it("leaves a file alone when clearing a field that reads as empty", async () => {
      const file = withChunks(plain, [tooLong]);
      expect(await writeText(file, "reading", [])).toBe(file);
    });
  });

  it("returns the file itself when the field already says this", async () => {
    const file = withChunks(plain, [readings("TA\nDA"), readings("KA")]);
    expect(await writeText(file, "reading", ["TA", "DA"])).toBe(file);
    expect(await writeText(file, "translation", [])).toBe(file);
    expect(await writeText(plain, "reading", [])).toBe(plain);
  });

  it("keeps a record it cannot use, byte for byte", async () => {
    const record = readChunks(plain).find(
      ({ type }) => type === recordChunkType,
    );
    if (record === undefined) throw new Error("no record");
    const newer: Chunk = {
      type: recordChunkType,
      data: Uint8Array.of(0, 0, 0, 2, 1, 2, 3),
    };
    const shortOne: Chunk = { type: recordChunkType, data: Uint8Array.of(1) };
    const twice = [record, record];
    for (const replacement of [[newer], [shortOne], twice]) {
      const chunks = readChunks(plain).flatMap((chunk) =>
        chunk.type === recordChunkType ? replacement : [chunk],
      );
      const file = writeChunks(chunks);
      const before = await readInkFile(file);
      expect(before.kind).toBe("pixels");
      const changed = await writeText(file, "reading", ["TA"]);
      const kept = readChunks(changed).filter(
        ({ type }) => type === recordChunkType,
      );
      expect(kept).toEqual(replacement);
      expect(await readInkFile(changed)).toEqual(before);
      expect(await readingsOf(changed)).toEqual(["TA"]);
    }
  });

  it("works on a picture with no record, and adds none", async () => {
    const picture = writeChunks(
      readChunks(plain).filter(({ type }) => type !== recordChunkType),
    );
    const changed = await writeText(picture, "reading", ["TA"]);
    expect(await readInkFile(changed)).toEqual({
      kind: "pixels",
      reason: "none",
    });
    expect(await readingsOf(changed)).toEqual(["TA"]);
  });

  // Sealing the chunks again would make one bit of damage to the version pass
  // for version 16777217, and hide every other kind.
  for (const [where, index] of [
    ["first version byte", 0],
    ["last version byte", 3],
    ["zlib stream", 12],
  ] as const) {
    it(`does not mend a bad CRC, for a flipped bit in the ${where}`, async () => {
      const file = flipped(plain, recordChunkType, index);
      const before = await readInkFile(file);
      expect(before).toMatchObject({
        kind: "pixels",
        reason: "damaged",
        detail: "bad CRC in the record chunk",
      });
      const changed = await writeText(file, "reading", ["TA"]);
      expect(await readInkFile(changed)).toEqual(before);
      expect(rawChunks(changed)).toEqual(
        rawChunks(file).toSpliced(2, 0, raw(readings("TA"))),
      );
    });
  }

  it("does not mend the image data's CRC or a text chunk's", async () => {
    const file = withChunks(plain, [translations("field"), readings("TA")]);
    const damaged = flipped(
      flipped(file, "IDAT", 0),
      "iTXt",
      textKeywords.translation.length + 6,
    );
    const changed = await writeText(damaged, "reading", ["KA"]);
    const marked = readChunks(changed).filter(
      (chunk) => chunk.damaged === true,
    );
    expect(marked.map(({ type }) => type)).toEqual(["iTXt", "IDAT"]);
    const before = rawChunks(damaged);
    const index = before.indexOf(raw(readings("TA")));
    expect(rawChunks(changed)).toEqual(before.with(index, raw(readings("KA"))));
  });

  it("keeps a chunk with a bad CRC of the field it changes", async () => {
    const file = withChunks(plain, [readings("TA")]);
    const damaged = flipped(file, "iTXt", textKeywords.reading.length + 5);
    expect(await readingsOf(damaged)).toEqual([]);
    const changed = await writeText(damaged, "reading", ["KA"]);
    const found = keywordChunks(changed, "reading");
    expect(found.map((chunk) => chunk.damaged)).toEqual([undefined, true]);
    expect(await readingsOf(changed)).toEqual(["KA"]);
  });

  it("keeps the bytes after IEND", async () => {
    const file = Uint8Array.from([...plain, 1, 2, 3]);
    const changed = await writeText(file, "reading", ["TA"]);
    expect([...changed.subarray(-3)]).toEqual([1, 2, 3]);
    const cleared = await writeText(changed, "reading", []);
    expect(cleared).toEqual(file);
  });

  it("works on a view into a larger buffer", async () => {
    const padded = new Uint8Array(plain.length + 16);
    padded.set(plain, 7);
    const view = padded.subarray(7, 7 + plain.length);
    const changed = await writeText(view, "reading", ["TA"]);
    expect(changed).toEqual(await writeText(plain, "reading", ["TA"]));
  });

  it("refuses a file that fails step 1, and changes nothing", async () => {
    const cut = plain.subarray(0, plain.length - 6);
    const copy = cut.slice();
    await expect(writeText(cut, "reading", ["TA"])).rejects.toThrow(PngError);
    await expect(writeText(cut, "reading", [])).rejects.toThrow(PngError);
    expect(cut).toEqual(copy);
  });

  it("refuses values the rules do not allow", async () => {
    for (const values of [[""], ["TA\nDA"], ["\ufeffTA"], ["TA\u2028"]]) {
      await expect(writeText(plain, "reading", values)).rejects.toThrow(
        TextError,
      );
    }
    const tooLong = ["x".repeat(maxTextBytes + 1)];
    await expect(writeText(plain, "reading", tooLong)).rejects.toThrow(
      TextError,
    );
  });

  it("does not make a file Inkline would refuse to read", async () => {
    const filler: Chunk = { type: "tIME", data: new Uint8Array(7) };
    const room = maxChunks - readChunks(plain).length;
    const full = withChunks(plain, Array<Chunk>(room).fill(filler));
    expect(readChunks(full)).toHaveLength(maxChunks);
    await expect(writeText(full, "reading", ["TA"])).rejects.toThrow(TextError);

    const holding = withChunks(plain, [
      readings("TA"),
      ...Array<Chunk>(room - 1).fill(filler),
    ]);
    const changed = await writeText(holding, "reading", ["KA"]);
    expect(readChunks(changed)).toHaveLength(maxChunks);
  });

  it("goes with a drawing's save: the record changes, the text stays", async () => {
    const file = await golden("v1-text");
    const source = await readInkFile(file);
    if (source.kind !== "record") throw new Error(source.kind);
    const chunks = readChunks(file);
    const image = writeChunks(
      chunks.filter(({ type }) => type !== recordChunkType && type !== "iTXt"),
    );
    const saved = await writeInkFile(
      image,
      source.record,
      preservableChunks(chunks),
    );
    const changed = await writeText(saved, "reading", ["KA"]);
    expect(await readText(readChunks(changed))).toEqual({
      reading: ["KA"],
      translation: ["rice field", "田"],
    });
    expect(await readInkFile(changed)).toEqual(source);
  });
});

describe("spliceChunks", () => {
  it("gives the same bytes when asked for nothing", () => {
    const chunks = readChunks(plain);
    expect(spliceChunks(plain, chunks, new Set())).toEqual(plain);
  });

  it("refuses to leave out a chunk that has nothing to go in front of", () => {
    const chunk: Chunk = { type: "tEXt", data: new Uint8Array(1) };
    expect(() =>
      spliceChunks(plain, readChunks(plain), new Set(), {
        chunk,
        before: chunk,
      }),
    ).toThrow(PngError);
  });
});
