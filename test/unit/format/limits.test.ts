// The format's limits, each at the limit and just past it. Every number is
// written out as docs/file-format.md gives it, never taken from `limits`: a
// test that names a constant moves with it, and these must not move. From the
// first stable release a reader and a writer that differ on one refuse each
// other's files, so that changing a number here changes the format.

import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  RecordError,
  readInkFile,
  recordChunkType,
  writeInkFile,
} from "../../../src/format/ink-file.ts";
import {
  maxChunks,
  readChunks,
  writeChunks,
  type Chunk,
} from "../../../src/format/png.ts";
import {
  basePngProblem,
  imageHeight,
  limits,
  parseRecord,
  serializeRecord,
  unitsPerPixel,
  type InkRecord,
  type ParseResult,
} from "../../../src/format/record.ts";
import {
  maxTextBytes,
  readText,
  textKeywords,
  textProblem,
} from "../../../src/format/text.ts";
import { iTxtData } from "../../fixtures/format/records.ts";
import { blank, encodePng, header, pixelChunks } from "../../support/png.ts";

const base64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64");

const onePixel = base64(encodePng(blank(1, 1)));

/** A record of one stroke, with these fields over an ordinary stroke's. */
const withStroke = (fields: object): string =>
  JSON.stringify({
    strokes: [{ tool: "pen", size: 16, points: [0, 0], ...fields }],
  });

/** A record with a base layer, with these fields over an ordinary one's. */
const withBase = (fields: object): string =>
  JSON.stringify({
    strokes: [],
    base: { x: 0, y: 0, width: 16, height: 16, png: onePixel, ...fields },
  });

/** An empty record with an unknown field nested to `depth` in all. */
const nested = (depth: number): string =>
  `{"strokes":[],"a":${"[".repeat(depth - 1)}${"]".repeat(depth - 1)}}`;

function invalid(result: ParseResult): string {
  if (result.ok) throw new Error(`not refused: ${JSON.stringify(result)}`);
  return result.detail;
}

/** A symbol's file of the given size, holding `payload` as its record. */
function symbolFile(
  width: number,
  height: number,
  payload: Uint8Array,
): Uint8Array {
  const [first, ...rest] = pixelChunks(blank(width, height));
  if (first === undefined) throw new Error("no header");
  const data = new Uint8Array(4 + payload.length);
  data[3] = 1;
  data.set(payload, 4);
  return writeChunks([first, { type: recordChunkType, data }, ...rest]);
}

/** Why reading a file that must be damaged says it is. */
async function damagedBecause(file: Uint8Array): Promise<string> {
  const source = await readInkFile(file);
  if (source.kind !== "pixels" || source.reason !== "damaged") {
    throw new Error(`not damaged: ${JSON.stringify(source)}`);
  }
  return source.detail;
}

describe("the format's numbers", () => {
  it("are the ones its document gives", () => {
    expect(limits).toEqual({
      width: 4096,
      strokes: 10_000,
      points: 250_000,
      coordinate: 16_777_216,
      strokeSize: 65_536,
      baseBytes: 8_388_608,
      baseSize: 4096,
      text: 16_777_216,
      depth: 16,
    });
    expect(unitsPerPixel).toBe(16);
    expect(imageHeight).toBe(192);
    expect(maxTextBytes).toBe(4096);
    expect(maxChunks).toBe(65_536);
  });
});

describe("a record's fields", () => {
  const coordinate = "is not an integer from -16777216 to 16777216";
  const size = "is not an integer from 1 to 65536";
  const extent = "is not an integer from 1 to 16777216";

  /** What is limited, a record at the limit, one past it, and why it fails. */
  const edges: readonly (readonly [string, string, string, string])[] = [
    [
      "a point's x, upwards",
      withStroke({ points: [16_777_216, 0] }),
      withStroke({ points: [16_777_217, 0] }),
      `strokes[0].points ${coordinate}`,
    ],
    [
      "a point's x, downwards",
      withStroke({ points: [-16_777_216, 0] }),
      withStroke({ points: [-16_777_217, 0] }),
      `strokes[0].points ${coordinate}`,
    ],
    [
      "a point's y, upwards",
      withStroke({ points: [0, 16_777_216] }),
      withStroke({ points: [0, 16_777_217] }),
      `strokes[0].points ${coordinate}`,
    ],
    [
      "a point's y, downwards",
      withStroke({ points: [0, -16_777_216] }),
      withStroke({ points: [0, -16_777_217] }),
      `strokes[0].points ${coordinate}`,
    ],
    [
      "a stroke's size, upwards",
      withStroke({ size: 65_536 }),
      withStroke({ size: 65_537 }),
      `strokes[0].size ${size}`,
    ],
    [
      "a stroke's size, downwards",
      withStroke({ size: 1 }),
      withStroke({ size: 0 }),
      `strokes[0].size ${size}`,
    ],
    [
      "a polygon's size, upwards",
      withStroke({ size: 65_536, kind: "polygon" }),
      withStroke({ size: 65_537, kind: "polygon" }),
      `strokes[0].size ${size}`,
    ],
    [
      "a polygon's size, downwards",
      withStroke({ size: 1, kind: "polygon" }),
      withStroke({ size: 0, kind: "polygon" }),
      `strokes[0].size ${size}`,
    ],
    [
      "base.x, upwards",
      withBase({ x: 16_777_216 }),
      withBase({ x: 16_777_217 }),
      `base.x ${coordinate}`,
    ],
    [
      "base.x, downwards",
      withBase({ x: -16_777_216 }),
      withBase({ x: -16_777_217 }),
      `base.x ${coordinate}`,
    ],
    [
      "base.y, upwards",
      withBase({ y: 16_777_216 }),
      withBase({ y: 16_777_217 }),
      `base.y ${coordinate}`,
    ],
    [
      "base.y, downwards",
      withBase({ y: -16_777_216 }),
      withBase({ y: -16_777_217 }),
      `base.y ${coordinate}`,
    ],
    [
      "base.width, upwards",
      withBase({ width: 16_777_216 }),
      withBase({ width: 16_777_217 }),
      `base.width ${extent}`,
    ],
    [
      "base.width, downwards",
      withBase({ width: 1 }),
      withBase({ width: 0 }),
      `base.width ${extent}`,
    ],
    [
      "base.height, upwards",
      withBase({ height: 16_777_216 }),
      withBase({ height: 16_777_217 }),
      `base.height ${extent}`,
    ],
    [
      "base.height, downwards",
      withBase({ height: 1 }),
      withBase({ height: 0 }),
      `base.height ${extent}`,
    ],
    [
      "any number, upwards",
      '{"strokes":[],"note":9007199254740991}',
      '{"strokes":[],"note":9007199254740992}',
      "a number is too large",
    ],
    [
      "any number, downwards",
      '{"strokes":[],"note":-9007199254740991}',
      '{"strokes":[],"note":-9007199254740992}',
      "a number is too large",
    ],
    ["nesting", nested(16), nested(17), "nested more than 16 deep"],
  ];

  for (const [name, within, past, detail] of edges) {
    it(`hold ${name} to the limit`, () => {
      expect(parseRecord(within).ok).toBe(true);
      expect(invalid(parseRecord(past))).toBe(detail);
    });
  }
});

describe("a record's strokes", () => {
  const strokes = (...points: readonly number[]): string =>
    JSON.stringify({
      strokes: points.map((count) => ({
        tool: "pen",
        size: 1,
        points: new Array<number>(count * 2).fill(0),
      })),
    });

  it("number at most 10,000", () => {
    const many = (count: number): string =>
      strokes(...new Array<number>(count).fill(1));
    expect(parseRecord(many(10_000)).ok).toBe(true);
    expect(invalid(parseRecord(many(10_001)))).toBe("more than 10000 strokes");
  });

  it("hold at most 250,000 points, in one stroke", () => {
    expect(parseRecord(strokes(250_000)).ok).toBe(true);
    expect(invalid(parseRecord(strokes(250_001)))).toBe(
      "more than 250000 points",
    );
  });

  it("hold at most 250,000 points, across strokes", () => {
    expect(parseRecord(strokes(125_000, 125_000)).ok).toBe(true);
    expect(invalid(parseRecord(strokes(125_000, 125_001)))).toBe(
      "more than 250000 points",
    );
  });
});

describe("a base layer's image", () => {
  const withImage = (png: Uint8Array): string => withBase({ png: base64(png) });

  it("holds at most 8 MiB", () => {
    const start = header(1, 1);
    const end: Chunk = { type: "IEND", data: new Uint8Array(0) };
    const used = writeChunks([start, end]).length + 12;
    const data = new Uint8Array(8_388_608 - used);
    const within = writeChunks([start, { type: "IDAT", data }, end]);
    expect(within).toHaveLength(8_388_608);
    expect(parseRecord(withImage(within)).ok).toBe(true);
    // One byte after its end, which the size is checked before.
    const past = new Uint8Array(8_388_609);
    past.set(within);
    expect(invalid(parseRecord(withImage(past)))).toBe("base.png is too large");
    // A draft's image comes here without passing through base64.
    expect(basePngProblem(past)).toBe("base.png is too large");
  }, 30_000);

  it("is at most 4096 pixels wide", () => {
    expect(parseRecord(withImage(encodePng(blank(4096, 1)))).ok).toBe(true);
    expect(invalid(parseRecord(withImage(encodePng(blank(4097, 1)))))).toBe(
      "base.png is larger than 4096 pixels a side",
    );
  });

  it("is at most 4096 pixels high", () => {
    expect(parseRecord(withImage(encodePng(blank(1, 4096)))).ok).toBe(true);
    expect(invalid(parseRecord(withImage(encodePng(blank(1, 4097)))))).toBe(
      "base.png is larger than 4096 pixels a side",
    );
  });
});

describe("a record's text", () => {
  /** An empty record of exactly `bytes` bytes of UTF-8, with `last` in it. */
  const text = (bytes: number, last = ""): string => {
    const empty = '{"strokes":[],"extra":""}';
    const width = new TextEncoder().encode(last).length;
    const filler = "x".repeat(bytes - empty.length - width);
    return `{"strokes":[],"extra":"${filler}${last}"}`;
  };

  it("holds at most 16 MiB of UTF-8, however wide its characters", () => {
    // Past the limit, the first is exactly the limit in code units. The second
    // has a character either side of each change of width, so that counting
    // any of them wrongly moves the total.
    for (const last of ["\u0080", "\u007f\u0080\u07ff\u0800😀"]) {
      expect(parseRecord(text(16_777_216, last)).ok, last).toBe(true);
      expect(invalid(parseRecord(text(16_777_217, last))), last).toBe(
        "record text is too long",
      );
    }
  }, 30_000);

  it("is inflated no further than 16 MiB", async () => {
    const file = (bytes: number): Uint8Array =>
      symbolFile(1, 192, deflateSync(text(bytes)));
    expect(await readInkFile(file(16_777_216))).toEqual({
      kind: "record",
      record: { strokes: [] },
      width: 1,
    });
    // Parsing would refuse it as well, but only after holding all of it.
    expect(await damagedBecause(file(16_777_217))).toContain(
      "data expands beyond 16777216 bytes",
    );
  }, 30_000);
});

describe("a record's text, when written", () => {
  /**
   * A valid record of exactly `bytes` bytes of text. Only the most of nearly
   * everything together reaches the limit: all the points, in as many strokes
   * as a record can have, on a base image close to its own limit.
   */
  function recordOf(bytes: number, png: Uint8Array): InkRecord {
    const base = { x: 0, y: 0, width: 16, height: 16, png };
    const strokes = Array.from({ length: 10_000 }, () => ({
      tool: "eraser" as const,
      size: 65_536,
      points: new Array<number>(50).fill(-16_777_216),
      cut: { start: "down", end: "down" } as const,
    }));
    let excess = serializeRecord({ strokes, base }).length - bytes;
    // A number of nine characters can give up as many as seven of them.
    for (const { points } of strokes) {
      for (let at = 0; at < points.length && excess > 0; at++) {
        const shorter = Math.min(excess, 7);
        points[at] = -(10 ** (7 - shorter));
        excess -= shorter;
      }
    }
    return { strokes, base };
  }

  it("is written up to 16 MiB", async () => {
    const rows = new Uint8Array(2040 * (1 + 4 * 1024));
    const data = new Uint8Array(deflateSync(rows, { level: 0 }));
    const png = writeChunks([
      header(1024, 2040),
      { type: "IDAT", data },
      { type: "IEND", data: new Uint8Array(0) },
    ]);
    const image = encodePng(blank(8, 192));
    const within = recordOf(16_777_216, png);
    expect(serializeRecord(within)).toHaveLength(16_777_216);
    await expect(writeInkFile(image, within)).resolves.toBeInstanceOf(
      Uint8Array,
    );
    const past = recordOf(16_777_217, png);
    expect(serializeRecord(past)).toHaveLength(16_777_217);
    await expect(writeInkFile(image, past)).rejects.toThrow(
      new RecordError("record text is too long"),
    );
  }, 60_000);
});

describe("a symbol's image", () => {
  const record: InkRecord = {
    strokes: [{ tool: "pen", size: 16, points: [16, 32] }],
  };
  const payload = deflateSync(JSON.stringify(record));

  it("is read up to 4096 pixels wide, from one", async () => {
    for (const width of [1, 4096]) {
      expect(await readInkFile(symbolFile(width, 192, payload))).toEqual({
        kind: "record",
        record,
        width,
      });
    }
    expect(await damagedBecause(symbolFile(4097, 192, payload))).toBe(
      "the image is 4097×192",
    );
  });

  it("is read only 192 pixels high", async () => {
    for (const height of [191, 193]) {
      expect(await damagedBecause(symbolFile(8, height, payload))).toBe(
        `the image is 8×${String(height)}`,
      );
    }
  });

  it("is written up to 4096 pixels wide, from one", async () => {
    for (const width of [1, 4096]) {
      const file = await writeInkFile(encodePng(blank(width, 192)), record);
      expect(await readInkFile(file)).toEqual({
        kind: "record",
        record,
        width,
      });
    }
    await expect(
      writeInkFile(encodePng(blank(4097, 192)), record),
    ).rejects.toThrow(new RecordError("a symbol's image cannot be 4097×192"));
  });

  it("is written only 192 pixels high", async () => {
    for (const height of [191, 193]) {
      await expect(
        writeInkFile(encodePng(blank(8, height)), record),
      ).rejects.toThrow(
        new RecordError(`a symbol's image cannot be 8×${String(height)}`),
      );
    }
  });
});

describe("a PNG's chunks", () => {
  it("number at most 65,536", () => {
    const [first, data, end] = pixelChunks(blank(1, 1));
    if (first === undefined || data === undefined || end === undefined) {
      throw new Error("no PNG");
    }
    const empty: Chunk = { type: "abCd", data: new Uint8Array(0) };
    const file = (count: number): Uint8Array =>
      writeChunks([
        first,
        ...new Array<Chunk>(count - 3).fill(empty),
        data,
        end,
      ]);
    expect(readChunks(file(65_536))).toHaveLength(65_536);
    expect(() => readChunks(file(65_537))).toThrow("more than 65536 chunks");
  });
});

describe("text about a symbol", () => {
  it("is written up to 4,096 bytes of UTF-8", () => {
    expect(textProblem(["x".repeat(4096)])).toBeUndefined();
    expect(textProblem(["é".repeat(2048)])).toBeUndefined();
    expect(textProblem(["x".repeat(4094), "x"])).toBeUndefined();
    for (const values of [
      ["x".repeat(4097)],
      ["é".repeat(2048), "x"],
      ["x".repeat(4095), "x"],
    ]) {
      expect(textProblem(values)).toBe("the text is longer than 4096 bytes");
    }
  });

  it("is read up to 4,096 bytes, stored or compressed", async () => {
    const [first, ...rest] = pixelChunks(blank(8, 192));
    if (first === undefined) throw new Error("no header");
    const reading = async (chunk: Chunk): Promise<readonly string[]> =>
      (await readText(readChunks(writeChunks([first, chunk, ...rest]))))
        .reading;
    const keyword = textKeywords.reading;
    const stored = (text: string): Chunk => ({
      type: "iTXt",
      data: iTxtData(keyword, text),
    });
    const compressed = (text: string): Chunk => {
      const start = new TextEncoder().encode(`${keyword}\0\u0001\0\0\0`);
      const stream = deflateSync(text);
      const data = new Uint8Array(start.length + stream.length);
      data.set(start);
      data.set(stream, start.length);
      return { type: "iTXt", data };
    };
    for (const chunk of [stored, compressed]) {
      const fits = "x".repeat(4096);
      expect(await reading(chunk(fits))).toEqual([fits]);
      expect(await reading(chunk(`${fits}x`))).toEqual([]);
    }
  });
});
