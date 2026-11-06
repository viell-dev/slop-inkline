import { readFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  RecordError,
  isInkPath,
  preservableChunks,
  readInkFile,
  recordChunkType,
  writeInkFile,
} from "../../../src/format/ink-file.ts";
import {
  PngError,
  readChunks,
  writeChunks,
  type Chunk,
} from "../../../src/format/png.ts";
import {
  formatVersion,
  imageHeight,
  limits,
  serializeRecord,
  type InkRecord,
} from "../../../src/format/record.ts";
import { inkGrey } from "../../../src/ink/render.ts";
import {
  blank,
  decodeRgba,
  encodePng,
  pixelChunks,
} from "../../support/png.ts";
import { goldenFiles, goldenImages } from "../../fixtures/format/records.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/format");

const record: InkRecord = {
  strokes: [{ tool: "pen", size: 16, points: [16, 32] }],
};

const width = 8;
const image = encodePng(blank(width, imageHeight));
const asRead = { kind: "record", record, width };

/** A record chunk of a version, holding `payload` after it. */
function recordChunk(
  version: number,
  payload: Uint8Array = deflateSync(serializeRecord(record)),
): Chunk {
  const data = new Uint8Array(4 + payload.length);
  new DataView(data.buffer).setUint32(0, version);
  data.set(payload, 4);
  return { type: recordChunkType, data };
}

/** A PNG with the given chunks between its header and its pixels. */
function withChunks(
  extra: readonly Chunk[],
  imageWidth = width,
  height = imageHeight,
): Uint8Array {
  const [header, ...rest] = pixelChunks(blank(imageWidth, height));
  if (header === undefined) throw new Error("no header");
  return writeChunks([header, ...extra, ...rest]);
}

/** A chunk of a text record, compressed as a record's is. */
const textChunk = (text: string): Chunk => recordChunk(1, deflateSync(text));

/** Reads a file that must be damaged, for its reason. */
async function damagedBecause(file: Uint8Array): Promise<string> {
  const source = await readInkFile(file);
  if (source.kind !== "pixels" || source.reason !== "damaged") {
    throw new Error(`not damaged: ${JSON.stringify(source)}`);
  }
  return source.detail;
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

describe("the record chunk's type", () => {
  it("is ancillary, private, and unsafe to copy, by PNG's letter rules", () => {
    expect(recordChunkType).toMatch(/^[a-z][a-z][A-Z][A-Z]$/);
  });
});

describe("version 1 golden files", () => {
  for (const name of Object.keys(goldenFiles)) {
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

    it(`holds ${name}'s ink in one grey, in every pixel`, async () => {
      const bytes = await readFile(path.join(fixtures, `${name}.ink.png`));
      const { data } = decodeRgba(new Uint8Array(bytes));
      let ink = 0;
      for (let at = 0; at < data.length; at += 4) {
        expect([data[at], data[at + 1], data[at + 2]]).toEqual([
          inkGrey,
          inkGrey,
          inkGrey,
        ]);
        if ((data[at + 3] ?? 0) > 0) ink++;
      }
      expect(ink).toBeGreaterThan(100);
    });

    it(`finds what ${name} holds laid out as the format says`, async () => {
      const bytes = await readFile(path.join(fixtures, `${name}.ink.png`));
      const chunks = readChunks(new Uint8Array(bytes));
      const [, chunk] = chunks;
      if (chunk === undefined) throw new Error("no chunks");
      expect(chunk.type).toBe(recordChunkType);
      expect([...chunk.data.subarray(0, 4)]).toEqual([0, 0, 0, 1]);
      const text = inflateSync(chunk.data.subarray(4)).toString("utf8");
      expect(`${text}\n`).toBe(
        await readFile(path.join(fixtures, `${name}.json`), "utf8"),
      );
      const header = chunks[0]?.data ?? new Uint8Array();
      // Height 192, bit depth 8, colour type 6, no interlacing.
      expect([...header.subarray(4, 8)]).toEqual([0, 0, 0, imageHeight]);
      expect([...header.subarray(8, 13)]).toEqual([8, 6, 0, 0, 0]);
    });
  }
});

describe("a base layer drawn smaller than its image", () => {
  it("takes in every source pixel it covers, in the golden file's pixels", async () => {
    const name = "v1-base-reduced";
    const image = goldenImages[name];
    const bytes = await readFile(path.join(fixtures, `${name}.ink.png`));
    const source = await readInkFile(new Uint8Array(bytes));
    if (source.kind !== "record" || source.record.base === undefined) {
      throw new Error("no base layer");
    }
    if (image === undefined) throw new Error("no image");
    const { x, y, width: drawn } = source.record.base;
    const { width, data } = decodeRgba(new Uint8Array(bytes));
    const scale = image.side / (drawn / 16);
    const [left, top] = [x / 16, y / 16];
    let worst = 0;
    // Away from the rectangle's edge, each pixel against the exact mean of the
    // source pixels it covers. A filter that samples four source pixels puts a
    // line it lands on at full strength and misses the others, by 200 levels.
    for (let row = 4; row < 188; row++) {
      for (let column = 4; column < drawn / 16 - 4; column++) {
        let sum = 0;
        for (let v = row * scale; v < (row + 1) * scale; v++) {
          for (let u = column * scale; u < (column + 1) * scale; u++) {
            sum += image.alpha(u, v);
          }
        }
        const mean = sum / (scale * scale);
        const at = ((row + top) * width + column + left) * 4 + 3;
        worst = Math.max(worst, Math.abs((data[at] ?? 0) - mean));
      }
    }
    expect(worst).toBeLessThan(110);
  });
});

describe("writeInkFile", () => {
  it("puts the record right after the header", async () => {
    const file = await writeInkFile(image, record);
    expect(readChunks(file).map((chunk) => chunk.type)).toEqual([
      "IHDR",
      recordChunkType,
      "IDAT",
      "IEND",
    ]);
    expect(await readInkFile(file)).toEqual(asRead);
  });

  it("opens the chunk with the version, then the compressed text", async () => {
    const file = await writeInkFile(image, record);
    const [, chunk] = readChunks(file);
    if (chunk === undefined) throw new Error("no chunk");
    expect([...chunk.data.subarray(0, 4)]).toEqual([0, 0, 0, formatVersion]);
    expect(inflateSync(chunk.data.subarray(4)).toString("utf8")).toBe(
      serializeRecord(record),
    );
  });

  it("replaces an earlier record and keeps every other chunk", async () => {
    const other: Chunk = { type: "tEXt", data: new Uint8Array(4).fill(65) };
    const original = withChunks([
      recordChunk(1, deflateSync(serializeRecord({ strokes: [] }))),
      other,
    ]);
    const file = await writeInkFile(original, record);
    const chunks = readChunks(file);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "IHDR",
      recordChunkType,
      "tEXt",
      "IDAT",
      "IEND",
    ]);
    expect(chunks[2]).toEqual(other);
    expect(await readInkFile(file)).toEqual(asRead);
  });

  it("keeps the pixels byte for byte", async () => {
    const file = await writeInkFile(image, record);
    const pixels = (bytes: Uint8Array): Chunk[] =>
      readChunks(bytes).filter((chunk) => chunk.type === "IDAT");
    expect(pixels(file)).toEqual(pixels(image));
  });

  it("refuses an image that is not a symbol's height", async () => {
    await expect(writeInkFile(encodePng(blank(8, 12)), record)).rejects.toThrow(
      "a symbol's image cannot be 8×12",
    );
  });

  it("refuses an image wider than the limit", async () => {
    await expect(
      writeInkFile(encodePng(blank(limits.width + 1, imageHeight)), record),
    ).rejects.toThrow(RecordError);
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

  it("ignores every other chunk, whatever it says", async () => {
    const ascii = new TextEncoder().encode(
      `inkline\0${serializeRecord(record)}`,
    );
    const file = withChunks([
      { type: "tEXt", data: ascii },
      { type: "inKl", data: recordChunk(1).data },
    ]);
    expect(await readInkFile(file)).toEqual({ kind: "pixels", reason: "none" });
  });

  it("finds the record wherever a chunk may be", async () => {
    const [header, data, end] = pixelChunks(blank(width, imageHeight));
    if (header === undefined || data === undefined || end === undefined) {
      throw new Error("no chunks");
    }
    expect(
      await readInkFile(writeChunks([header, data, recordChunk(1), end])),
    ).toEqual(asRead);
  });

  it("reads a record whatever way another program stored the image", async () => {
    const [header, ...rest] = pixelChunks({
      width,
      height: imageHeight,
      data: new Uint8Array(width * imageHeight),
      grey: true,
    });
    if (header === undefined) throw new Error("no header");
    const file = writeChunks([
      header,
      ...rest.slice(0, -1),
      recordChunk(1),
      ...rest.slice(-1),
    ]);
    expect(await readInkFile(file)).toEqual(asRead);
  });

  it("gives the image's width with the record", async () => {
    const file = withChunks([recordChunk(1)], 300);
    expect(await readInkFile(file)).toEqual({ ...asRead, width: 300 });
  });

  it("ignores fields this version does not know", async () => {
    const file = withChunks([
      textChunk(
        '{"future":{"a":[1,2]},"strokes":[{"note":"x","tool":"pen","size":16,"points":[16,32]}]}',
      ),
    ]);
    expect(await readInkFile(file)).toEqual(asRead);
  });

  it("refuses a stroke cut along a column, which version 1 does not have", async () => {
    const file = withChunks([
      textChunk(
        '{"strokes":[{"tool":"pen","size":32,"points":[0,0,64,0],"cut":{"end":"right"}}]}',
      ),
    ]);
    expect(await damagedBecause(file)).toBe(
      'strokes[0].cut.end is not "up" or "down"',
    );
  });

  it("throws on bytes that are not a PNG", async () => {
    await expect(
      readInkFile(new TextEncoder().encode("hello")),
    ).rejects.toThrow(PngError);
  });

  it("reads a record whatever the image data holds, as reading never decodes it", async () => {
    const [header, ...rest] = pixelChunks(blank(width, imageHeight));
    if (header === undefined) throw new Error("no header");
    const others = rest.filter(({ type }) => type !== "IDAT");
    const payloads = [
      // Empty, not a zlib stream, and a stream that stops rows short.
      new Uint8Array(0),
      Uint8Array.of(1, 2, 3),
      deflateSync(new Uint8Array(10)),
    ];
    for (const data of payloads) {
      const file = writeChunks([
        header,
        recordChunk(1),
        { type: "IDAT", data },
        ...others,
      ]);
      expect(await readInkFile(file)).toEqual(asRead);
    }
  });

  it("passes over an ancillary chunk with PNG's reserved letter in lower case", async () => {
    // PNG says such a file does not conform, and also that an unknown chunk is
    // no error unless it is critical, so a reader goes on.
    const odd = { type: "abcl", data: new Uint8Array(0) };
    expect(await readInkFile(withChunks([recordChunk(1), odd]))).toEqual(
      asRead,
    );
  });

  it("throws on a critical chunk PNG does not define, even with a record", async () => {
    const file = withChunks([
      recordChunk(1),
      { type: "ABCD", data: new Uint8Array(1) },
    ]);
    await expect(readInkFile(file)).rejects.toThrow(
      "unknown critical chunk ABCD",
    );
  });
});

describe("readInkFile tells a later version from anything else", () => {
  const newer = {
    kind: "pixels",
    reason: "newer-version",
    detail: "version 2 is newer than 1",
  };

  it("by the first four bytes of the chunk alone", async () => {
    expect(await readInkFile(withChunks([recordChunk(2)]))).toEqual(newer);
  });

  it("whatever the rest of the chunk holds", async () => {
    for (const payload of [
      new Uint8Array(0),
      new Uint8Array(64).fill(0xff),
      new TextEncoder().encode("not compressed, and not JSON"),
    ]) {
      expect(await readInkFile(withChunks([recordChunk(2, payload)]))).toEqual(
        newer,
      );
    }
  });

  it("however large the rest would inflate to", async () => {
    const oversized = deflateSync(new Uint8Array(limits.text + 1024));
    expect(oversized.length).toBeLessThan(limits.text / 100);
    expect(await readInkFile(withChunks([recordChunk(2, oversized)]))).toEqual(
      newer,
    );
  });

  it("in a file whose image no version 1 record could have", async () => {
    expect(await readInkFile(withChunks([recordChunk(2)], 9000, 300))).toEqual(
      newer,
    );
  });

  it("in any record chunk, not only the first", async () => {
    expect(
      await readInkFile(withChunks([recordChunk(1), recordChunk(2)])),
    ).toEqual(newer);
  });

  it("up to the largest version the field can hold", async () => {
    expect(await readInkFile(withChunks([recordChunk(0xffffffff)]))).toEqual({
      ...newer,
      detail: "version 4294967295 is newer than 1",
    });
  });
});

describe("readInkFile reports a record that cannot be used", () => {
  it("in a chunk too short for a version", async () => {
    const file = withChunks([
      { type: recordChunkType, data: new Uint8Array(3) },
    ]);
    expect(await damagedBecause(file)).toBe("no format version");
  });

  it("of version 0", async () => {
    expect(await damagedBecause(withChunks([recordChunk(0)]))).toBe(
      "no format version",
    );
  });

  it("with more than one record chunk", async () => {
    expect(
      await damagedBecause(withChunks([recordChunk(1), recordChunk(1)])),
    ).toBe("more than one record chunk");
  });

  it("whose chunk has a wrong CRC, without trusting its version", async () => {
    const file = withChunks([recordChunk(1)]);
    // Turns version 1 into version 2 without fixing the CRC.
    file[findChunk(file, recordChunkType) + 8 + 3] = 2;
    expect(await damagedBecause(file)).toBe("bad CRC in the record chunk");
  });

  it("in an image of another height", async () => {
    expect(await damagedBecause(withChunks([recordChunk(1)], 8, 12))).toBe(
      "the image is 8×12",
    );
  });

  it("in an image wider than the limit", async () => {
    expect(
      await damagedBecause(withChunks([recordChunk(1)], limits.width + 1)),
    ).toBe(`the image is ${String(limits.width + 1)}×192`);
  });

  it("that is not compressed", async () => {
    const text = new TextEncoder().encode(serializeRecord(record));
    await damagedBecause(withChunks([recordChunk(1, text)]));
  });

  it("with anything after the stream's end", async () => {
    const payload = deflateSync(serializeRecord(record));
    const longer = new Uint8Array(payload.length + 4);
    longer.set(payload);
    expect(
      await damagedBecause(withChunks([recordChunk(1, longer)])),
    ).toBeTruthy();
    const twice = new Uint8Array(payload.length * 2);
    twice.set(payload);
    twice.set(payload, payload.length);
    expect(
      await damagedBecause(withChunks([recordChunk(1, twice)])),
    ).toBeTruthy();
  });

  it("that stops short", async () => {
    const whole = deflateSync(serializeRecord(record));
    await damagedBecause(withChunks([recordChunk(1, whole.subarray(0, 4))]));
  });

  it("that inflates past the limit, without inflating the rest", async () => {
    const huge = deflateSync(new Uint8Array(limits.text + 1024));
    expect(await damagedBecause(withChunks([recordChunk(1, huge)]))).toContain(
      "expands beyond",
    );
  });

  it("that is not UTF-8", async () => {
    await damagedBecause(
      withChunks([recordChunk(1, deflateSync(Uint8Array.of(0xff, 0xfe)))]),
    );
  });

  it("that is not JSON", async () => {
    expect(await damagedBecause(withChunks([textChunk("{")]))).toBe("not JSON");
  });

  it("that opens with a byte order mark", async () => {
    const text = `\uFEFF${serializeRecord(record)}`;
    expect(await damagedBecause(withChunks([textChunk(text)]))).toBe(
      "not JSON",
    );
  });

  it("that breaks the format", async () => {
    expect(await damagedBecause(withChunks([textChunk("{}")]))).toBe(
      "strokes is not a list",
    );
  });

  it("of a kind of stroke this version does not know", async () => {
    const text = serializeRecord(record).replace(
      '"tool":"pen"',
      '"tool":"pen","kind":"bezier"',
    );
    expect(await damagedBecause(withChunks([textChunk(text)]))).toContain(
      "kind",
    );
  });
});

/** The offset of the first chunk of a type in a PNG. */
function findChunk(file: Uint8Array, type: string): number {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 8;
  while (at < file.length) {
    const found = String.fromCharCode(...file.subarray(at + 4, at + 8));
    if (found === type) return at;
    at += 12 + view.getUint32(at);
  }
  throw new Error(`no ${type} chunk`);
}

describe("writeInkFile writes only what readers accept", () => {
  it("refuses a record whose text is longer than the limit", async () => {
    // Only the largest of everything together reaches it: all the points, in
    // as many strokes as a record can have, on the largest base layer.
    const [header, , end] = pixelChunks(blank(1, 1));
    if (header === undefined || end === undefined) throw new Error("no PNG");
    const data = new Uint8Array(limits.baseBytes - 64);
    const each = (2 * limits.points) / limits.strokes;
    const long: InkRecord = {
      strokes: Array.from({ length: limits.strokes }, () => ({
        tool: "eraser",
        size: limits.strokeSize,
        points: new Array<number>(each).fill(-limits.coordinate),
        cut: { start: "down", end: "down" },
      })),
      base: {
        x: 0,
        y: 0,
        width: 16,
        height: 16,
        png: writeChunks([header, { type: "IDAT", data }, end]),
      },
    };
    expect(serializeRecord(long).length).toBeGreaterThan(limits.text);
    await expect(writeInkFile(image, long)).rejects.toThrow(
      new RecordError("record text is too long"),
    );
  });

  it("refuses a record that breaks the format", async () => {
    const broken: InkRecord = {
      strokes: [{ tool: "pen", size: 0, points: [0, 0] }],
    };
    await expect(writeInkFile(image, broken)).rejects.toThrow(
      "record breaks the format: strokes[0].size is not an integer",
    );
  });

  it("refuses to replace a record from a later version, in any chunk", async () => {
    await expect(
      writeInkFile(withChunks([recordChunk(2)]), record),
    ).rejects.toThrow("version 2 is newer than 1");
    await expect(
      writeInkFile(withChunks([recordChunk(1), recordChunk(2)]), record),
    ).rejects.toThrow("version 2 is newer than 1");
  });

  it("refuses to replace a record later than the limits of this version", async () => {
    const oversized = deflateSync(new Uint8Array(limits.text + 1024));
    await expect(
      writeInkFile(withChunks([recordChunk(2, oversized)]), record),
    ).rejects.toThrow("version 2 is newer than 1");
  });

  it("refuses to replace a record it cannot read", async () => {
    await expect(
      writeInkFile(withChunks([textChunk("{}")]), record),
    ).rejects.toThrow("the file's record is unusable: strokes is not a list");
  });
});

describe("readInkFile accepts", () => {
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
  const exif: Chunk = { type: "eXIf", data: new Uint8Array(4) };
  const unknown: Chunk = { type: "vpAg", data: new Uint8Array(9) };
  const before = (chunk: Chunk) => ({ chunk, afterData: false });
  const after = (chunk: Chunk) => ({ chunk, afterData: true });

  /** A PNG with chunks before and after its image data. */
  function framed(
    beforeData: readonly Chunk[],
    afterData: readonly Chunk[],
  ): Uint8Array {
    const [header, data, end] = pixelChunks(blank(8, imageHeight));
    if (header === undefined || data === undefined || end === undefined) {
      throw new Error("no chunks");
    }
    return writeChunks([header, ...beforeData, data, ...afterData, end]);
  }

  it("keeps ancillary chunks that are safe to copy, but not the record, with their side of the image data", () => {
    const file = framed(
      [recordChunk(1), comment, physical, gamma, time],
      [unknown, comment],
    );
    expect(preservableChunks(readChunks(file))).toEqual([
      before(comment),
      before(physical),
      after(unknown),
      after(comment),
    ]);
  });

  it("drops eXIf, which is safe to copy but can turn the image", () => {
    const file = framed([exif, comment], []);
    expect(preservableChunks(readChunks(file))).toEqual([before(comment)]);
  });

  it("drops a chunk with a wrong CRC, and copies what it keeps", () => {
    const file = framed([comment, physical], []);
    const at = findChunk(file, "tEXt") + 9;
    file[at] = (file[at] ?? 0) ^ 1;
    const carried = preservableChunks(readChunks(file));
    expect(carried).toEqual([before(physical)]);
    expect(carried[0]?.chunk.data.buffer).not.toBe(file.buffer);
  });

  it("puts chunks back on their side of the image data", async () => {
    const file = await writeInkFile(image, record, [
      before(comment),
      before(physical),
      after(unknown),
    ]);
    expect(readChunks(file).map((chunk) => chunk.type)).toEqual([
      "IHDR",
      recordChunkType,
      "tEXt",
      "pHYs",
      "IDAT",
      "vpAg",
      "IEND",
    ]);
  });

  it("keeps chunks PNG requires before the image data there", async () => {
    const file = await writeInkFile(image, record, [after(physical)]);
    expect(readChunks(file).map((chunk) => chunk.type)).toEqual([
      "IHDR",
      recordChunkType,
      "pHYs",
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
    const stale = recordChunk(1, deflateSync(serializeRecord({ strokes: [] })));
    const file = await writeInkFile(image, record, [
      before(gamma),
      before(time),
      after(stale),
    ]);
    expect(readChunks(file).map((chunk) => chunk.type)).toEqual([
      "IHDR",
      recordChunkType,
      "IDAT",
      "IEND",
    ]);
    expect(await readInkFile(file)).toEqual(asRead);
  });
});
