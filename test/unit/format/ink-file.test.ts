import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RecordError,
  isInkPath,
  preservableChunks,
  readInkFile,
  writeInkFile,
} from "../../../src/format/ink-file.ts";
import {
  PngError,
  deflate,
  encodeInternationalText,
  readChunks,
  writeChunks,
  type Chunk,
} from "../../../src/format/png.ts";
import {
  limits,
  serializeRecord,
  type InkRecord,
} from "../../../src/format/record.ts";
import { blank, encodePng, pixelChunks } from "../../support/png.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/format");

const record: InkRecord = {
  box: { pxPerEm: 128, width: 8, height: 12, baseline: 9 },
  strokes: [{ tool: "pen", size: 16, pressure: false, points: [16, 32] }],
};

const image = encodePng(blank(8, 12));

async function textChunk(keyword: string, text: string): Promise<Chunk> {
  return encodeInternationalText({ keyword, text });
}

/** A PNG with the given chunks between its header and its pixels. */
function withChunks(
  extra: readonly Chunk[],
  width = 8,
  height = 12,
): Uint8Array {
  const [header, ...rest] = pixelChunks(blank(width, height));
  if (header === undefined) throw new Error("no header");
  return writeChunks([header, ...extra, ...rest]);
}

describe("isInkPath", () => {
  it("matches the suffix in any letter case", () => {
    expect(isInkPath("Scripts/𐎠.ink.png")).toBe(true);
    expect(isInkPath("A.INK.PNG")).toBe(true);
    expect(isInkPath("a.png")).toBe(false);
    expect(isInkPath("a.ink.png.bak")).toBe(false);
    expect(isInkPath("ink.png")).toBe(false);
  });
});

describe("version 1 golden files", () => {
  for (const name of ["v1-strokes", "v1-base", "v1-cuts"]) {
    it(`reads ${name}`, async () => {
      const bytes = await readFile(path.join(fixtures, `${name}.ink.png`));
      const expected = await readFile(
        path.join(fixtures, `${name}.json`),
        "utf8",
      );
      const source = await readInkFile(new Uint8Array(bytes));
      if (source.kind !== "record") throw new Error(JSON.stringify(source));
      expect(`${serializeRecord(source.record)}\n`).toBe(expected);
    });
  }
});

describe("writeInkFile", () => {
  it("puts the record right after the header", async () => {
    const file = await writeInkFile(image, record);
    expect(readChunks(file).map((chunk) => chunk.type)).toEqual([
      "IHDR",
      "iTXt",
      "IDAT",
      "IEND",
    ]);
    expect(await readInkFile(file)).toEqual({ kind: "record", record });
  });

  it("replaces an earlier record and keeps every other chunk", async () => {
    const other = await textChunk("Comment", "kept");
    const original = withChunks([
      await textChunk("inkline", serializeRecord({ ...record, strokes: [] })),
      other,
    ]);
    const file = await writeInkFile(original, record);
    const chunks = readChunks(file);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "IHDR",
      "iTXt",
      "iTXt",
      "IDAT",
      "IEND",
    ]);
    expect(chunks[2]).toEqual(other);
    expect(await readInkFile(file)).toEqual({ kind: "record", record });
  });

  it("keeps the pixels byte for byte", async () => {
    const file = await writeInkFile(image, record);
    const pixels = (bytes: Uint8Array): Chunk[] =>
      readChunks(bytes).filter((chunk) => chunk.type === "IDAT");
    expect(pixels(file)).toEqual(pixels(image));
  });

  it("refuses a record whose size differs from the image", async () => {
    await expect(
      writeInkFile(image, { ...record, box: { ...record.box, width: 9 } }),
    ).rejects.toThrow("record is 9×12, image is 8×12");
  });

  it("refuses bytes that are not a PNG", async () => {
    await expect(writeInkFile(Uint8Array.of(1, 2, 3), record)).rejects.toThrow(
      PngError,
    );
  });
});

describe("readInkFile", () => {
  it("finds no record in a plain PNG", async () => {
    expect(await readInkFile(image)).toEqual({
      kind: "pixels",
      reason: "none",
    });
  });

  it("ignores text chunks with other keywords", async () => {
    const file = withChunks([
      await textChunk("Inkline", serializeRecord(record)),
    ]);
    expect(await readInkFile(file)).toEqual({ kind: "pixels", reason: "none" });
  });

  it("reports a record that no longer matches the image's size", async () => {
    const file = withChunks(
      [await textChunk("inkline", serializeRecord(record))],
      16,
      24,
    );
    expect(await readInkFile(file)).toEqual({
      kind: "pixels",
      reason: "stale",
      detail: "record is 8×12, image is 16×24",
    });
  });

  it("reports a record from a later version", async () => {
    const newer = serializeRecord(record).replace('"version":1', '"version":7');
    const file = withChunks([await textChunk("inkline", newer)]);
    expect(await readInkFile(file)).toMatchObject({
      kind: "pixels",
      reason: "newer-version",
    });
  });

  it("reports a record that breaks the format", async () => {
    const file = withChunks([
      await textChunk("inkline", '{"format":"inkline"}'),
    ]);
    expect(await readInkFile(file)).toMatchObject({
      kind: "pixels",
      reason: "invalid",
      detail: "version is not an integer from 1 to 9007199254740991",
    });
  });

  it("reports a record chunk whose compressed text is corrupt", async () => {
    const data = new Uint8Array([
      ...new TextEncoder().encode("inkline"),
      0,
      1,
      0,
      0,
      0,
      ...(await deflate(new TextEncoder().encode("{}"))).subarray(0, 4),
    ]);
    const file = withChunks([{ type: "iTXt", data }]);
    expect(await readInkFile(file)).toMatchObject({
      kind: "pixels",
      reason: "invalid",
    });
  });

  it("throws on bytes that are not a PNG", async () => {
    await expect(
      readInkFile(new TextEncoder().encode("hello")),
    ).rejects.toThrow(PngError);
  });
});

describe("writeInkFile writes only what readers accept", () => {
  it("refuses a record whose text is longer than the limit", async () => {
    const points = new Array<number>(2 * limits.points).fill(limits.coordinate);
    const long: InkRecord = {
      ...record,
      strokes: [{ tool: "pen", size: 16, pressure: false, points }],
    };
    expect(serializeRecord(long).length).toBeGreaterThan(limits.text);
    await expect(writeInkFile(image, long)).rejects.toThrow(
      new RecordError("record text is too long"),
    );
  });

  it("refuses a record that breaks the format", async () => {
    const broken: InkRecord = {
      ...record,
      strokes: [{ tool: "pen", size: 0, pressure: false, points: [0, 0] }],
    };
    await expect(writeInkFile(image, broken)).rejects.toThrow(
      "record breaks the format: strokes[0].size is not an integer",
    );
  });

  it("refuses to replace a record from a later version", async () => {
    const newer = serializeRecord(record).replace('"version":1', '"version":2');
    const file = withChunks([await textChunk("inkline", newer)]);
    await expect(writeInkFile(file, record)).rejects.toThrow(
      "the file holds a record from a later version: version 2 is newer than 1",
    );
  });

  it("replaces a record that breaks the format", async () => {
    const file = withChunks([await textChunk("inkline", "{}")]);
    expect(await readInkFile(await writeInkFile(file, record))).toEqual({
      kind: "record",
      record,
    });
  });
});

describe("readInkFile accepts", () => {
  it("an uncompressed record", async () => {
    const text = new TextEncoder().encode(serializeRecord(record));
    const data = new Uint8Array([
      ...new TextEncoder().encode("inkline"),
      0,
      0,
      0,
      0,
      0,
      ...text,
    ]);
    const file = withChunks([{ type: "iTXt", data }]);
    expect(await readInkFile(file)).toEqual({ kind: "record", record });
  });

  it("only well-formed PNG files", async () => {
    const [header, , end] = pixelChunks(blank(8, 12));
    if (header === undefined || end === undefined) throw new Error("no chunks");
    await expect(readInkFile(writeChunks([header, end]))).rejects.toThrow(
      "no IDAT chunk",
    );
  });
});

describe("carrying chunks through a save", () => {
  const ascii = (text: string): Uint8Array =>
    Uint8Array.from(text, (char) => char.charCodeAt(0));
  const comment: Chunk = { type: "tEXt", data: ascii("Comment\0keep me") };
  const physical: Chunk = { type: "pHYs", data: new Uint8Array(9) };
  const gamma: Chunk = { type: "gAMA", data: new Uint8Array(4) };
  const time: Chunk = { type: "tIME", data: new Uint8Array(7) };
  const unknown: Chunk = { type: "vpAg", data: new Uint8Array(9) };
  const before = (chunk: Chunk) => ({ chunk, afterData: false });
  const after = (chunk: Chunk) => ({ chunk, afterData: true });

  /** A PNG with chunks before and after its image data. */
  function framed(
    beforeData: readonly Chunk[],
    afterData: readonly Chunk[],
  ): Uint8Array {
    const [header, data, end] = pixelChunks(blank(8, 12));
    if (header === undefined || data === undefined || end === undefined) {
      throw new Error("no chunks");
    }
    return writeChunks([header, ...beforeData, data, ...afterData, end]);
  }

  it("keeps ancillary chunks that are safe to copy, but not the record, with their side of the image data", async () => {
    const file = framed(
      [
        await textChunk("inkline", serializeRecord(record)),
        comment,
        physical,
        gamma,
        time,
      ],
      [unknown, comment],
    );
    expect(preservableChunks(file)).toEqual([
      before(comment),
      before(physical),
      after(unknown),
      after(comment),
    ]);
  });

  it("puts chunks back on their side of the image data", async () => {
    const file = await writeInkFile(image, record, [
      before(comment),
      before(physical),
      after(unknown),
    ]);
    expect(readChunks(file).map((chunk) => chunk.type)).toEqual([
      "IHDR",
      "iTXt",
      "tEXt",
      "pHYs",
      "IDAT",
      "vpAg",
      "IEND",
    ]);
  });

  it("keeps chunks PNG requires before the image data there", async () => {
    const exif: Chunk = { type: "eXIf", data: new Uint8Array(4) };
    const file = await writeInkFile(image, record, [
      after(physical),
      after(exif),
    ]);
    expect(readChunks(file).map((chunk) => chunk.type)).toEqual([
      "IHDR",
      "iTXt",
      "pHYs",
      "eXIf",
      "IDAT",
      "IEND",
    ]);
  });

  it("skips a carried type the new image already has, except text", async () => {
    const own: Chunk = { type: "pHYs", data: new Uint8Array(9).fill(1) };
    const second: Chunk = { type: "tEXt", data: ascii("Title\0x") };
    const fresh = withChunks([own, comment]);
    const file = await writeInkFile(fresh, record, [
      before(physical),
      before(second),
    ]);
    const chunks = readChunks(file);
    expect(chunks.filter((chunk) => chunk.type === "pHYs")).toEqual([own]);
    expect(chunks.filter((chunk) => chunk.type === "tEXt")).toEqual([
      second,
      comment,
    ]);
  });

  it("never carries chunks that are not safe to copy, or a record", async () => {
    const stale = await textChunk(
      "inkline",
      serializeRecord({ ...record, strokes: [] }),
    );
    const file = await writeInkFile(image, record, [
      before(gamma),
      before(time),
      after(stale),
    ]);
    expect(readChunks(file).map((chunk) => chunk.type)).toEqual([
      "IHDR",
      "iTXt",
      "IDAT",
      "IEND",
    ]);
    expect(await readInkFile(file)).toEqual({ kind: "record", record });
  });
});
