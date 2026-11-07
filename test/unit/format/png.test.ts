import { loadavg } from "node:os";
import { describe, expect, it } from "vitest";
import {
  PngError,
  crc32,
  deflate,
  encodeRgba,
  imageHeader,
  maxChunks,
  inflate,
  isPng,
  pngSignature,
  readChunks,
  writeChunks,
  type Chunk,
} from "../../../src/format/png.ts";
import { inflateSync } from "node:zlib";
import { blank, encodePng, header, pixelChunks } from "../../support/png.ts";

const ascii = (text: string): Uint8Array =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
  });

  it("spans several parts as one sequence", () => {
    expect(crc32(ascii("1234"), ascii("56789"))).toBe(0xcbf43926);
  });

  it("matches the CRC of a real IEND chunk", () => {
    expect(crc32(ascii("IEND"))).toBe(0xae426082);
  });
});

describe("readChunks and writeChunks", () => {
  const png = encodePng(blank(3, 2));

  it("round-trips a PNG byte for byte", () => {
    const chunks = readChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(writeChunks(chunks)).toEqual(png);
  });

  it("reads the image header", () => {
    expect(imageHeader(readChunks(png))).toEqual({
      width: 3,
      height: 2,
      bitDepth: 8,
      colorType: 6,
      interlaced: false,
    });
  });

  it("recognizes the signature", () => {
    expect(isPng(png)).toBe(true);
    expect(isPng(pngSignature.subarray(0, 7))).toBe(false);
    expect(isPng(ascii("GIF89a\0\0\0\0"))).toBe(false);
  });

  it("ignores bytes after IEND", () => {
    const padded = new Uint8Array(png.length + 3);
    padded.set(png);
    expect(readChunks(padded)).toHaveLength(3);
  });

  it("rejects a file that is not a PNG", () => {
    expect(() => readChunks(ascii("not a png at all"))).toThrow(PngError);
  });

  it("rejects a damaged chunk", () => {
    const damaged = png.slice();
    // A byte inside IHDR's data.
    damaged[20] = (damaged[20] ?? 0) ^ 0xff;
    expect(() => readChunks(damaged)).toThrow("bad CRC in IHDR chunk");
  });

  it("rejects a truncated file", () => {
    expect(() => readChunks(png.subarray(0, png.length - 4))).toThrow(
      "truncated chunk",
    );
    expect(() => readChunks(png.subarray(0, 20))).toThrow("truncated chunk");
  });

  it("rejects a file without IEND", () => {
    const chunks = readChunks(png).filter((chunk) => chunk.type !== "IEND");
    expect(() => readChunks(writeChunks(chunks))).toThrow("truncated chunk");
  });

  it("rejects a file that does not start with IHDR", () => {
    const [first, ...rest] = pixelChunks(blank(1, 1));
    if (first === undefined) throw new Error("no chunks");
    const swapped: Chunk[] = [...rest.slice(0, 1), first, ...rest.slice(1)];
    expect(() => readChunks(writeChunks(swapped))).toThrow(
      "first chunk is not IHDR",
    );
  });

  it("rejects an invalid chunk type when writing", () => {
    expect(() =>
      writeChunks([{ type: "IH!R", data: new Uint8Array() }]),
    ).toThrow(PngError);
  });
});

describe("deflate and inflate", () => {
  it("round-trip bytes", async () => {
    const bytes = ascii("Inkline ".repeat(100));
    const compressed = await deflate(bytes);
    expect(compressed.length).toBeLessThan(bytes.length);
    expect(await inflate(compressed)).toEqual(bytes);
  });

  it("refuses output beyond the limit", async () => {
    const compressed = await deflate(new Uint8Array(100_000));
    await expect(inflate(compressed, { limit: 99_999 })).rejects.toThrow(
      "data expands beyond 99999 bytes",
    );
    expect(await inflate(compressed, { limit: 100_000 })).toHaveLength(100_000);
  });

  it("refuses a highly compressed input that passes the limit", async () => {
    // 16 MiB of zeros compresses to about 16 KiB. How much input Node reads
    // ahead varies, so how early inflation stops is checked in Obsidian's
    // renderer, by test/e2e/specs/format.e2e.ts.
    const compressed = await deflate(new Uint8Array(16 * 1024 * 1024));
    await expect(inflate(compressed, { limit: 1024 * 1024 })).rejects.toThrow(
      "data expands beyond 1048576 bytes",
    );
  }, 30_000);

  it("reads all of the input otherwise", async () => {
    const compressed = await deflate(new Uint8Array(200_000).fill(7));
    let consumed = 0;
    await inflate(compressed, { onInput: (bytes) => (consumed = bytes) });
    expect(consumed).toBe(compressed.length);
  });

  it("rejects corrupt data", async () => {
    await expect(inflate(ascii("not zlib data"))).rejects.toThrow();
  });
});

describe("readChunks and ancillary chunks", () => {
  const [ihdr, idat, iend] = pixelChunks(blank(1, 1));
  if (ihdr === undefined || idat === undefined || iend === undefined) {
    throw new Error("no chunks");
  }
  const note: Chunk = { type: "tEXt", data: ascii("Note\0x") };

  it("passes over a damaged ancillary chunk, marking it", () => {
    const png = writeChunks([ihdr, note, idat, iend]);
    // The last byte of the text.
    png[8 + 25 + 8 + note.data.length - 1] = 0x79;
    const chunks = readChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "IHDR",
      "tEXt",
      "IDAT",
      "IEND",
    ]);
    expect(chunks[1]?.damaged).toBe(true);
    expect(chunks[2]?.damaged).toBeUndefined();
  });

  it("marks nothing in a file that is whole", () => {
    const chunks = readChunks(writeChunks([ihdr, note, idat, iend]));
    expect(chunks.every((chunk) => chunk.damaged === undefined)).toBe(true);
  });

  it("marks damaged image data, for decoding to find out what it did", () => {
    const png = writeChunks([ihdr, idat, iend]);
    // The first byte of the image data.
    png[8 + 25 + 8] = (png[8 + 25 + 8] ?? 0) ^ 1;
    expect(readChunks(png).map((chunk) => chunk.damaged)).toEqual([
      undefined,
      true,
      undefined,
    ]);
  });

  it("marks a wrong CRC on IEND", () => {
    const png = writeChunks([ihdr, idat, iend]);
    png[png.length - 1] = (png[png.length - 1] ?? 0) ^ 1;
    expect(readChunks(png).at(-1)?.damaged).toBe(true);
  });

  it("refuses a critical chunk PNG does not define, with a good CRC", () => {
    for (const type of ["ABCD", "AbCD", "Inkl"]) {
      const png = writeChunks([
        ihdr,
        { type, data: new Uint8Array(1) },
        idat,
        iend,
      ]);
      expect(() => readChunks(png)).toThrow(`unknown critical chunk ${type}`);
    }
  });

  it("keeps ancillary chunks it does not know", () => {
    const unknown: Chunk = { type: "abCd", data: new Uint8Array(1) };
    expect(readChunks(writeChunks([ihdr, unknown, idat, iend]))).toHaveLength(
      4,
    );
  });

  it("reads as many chunks as the limit, and refuses one more", () => {
    const empty: Chunk = { type: "abCd", data: new Uint8Array(0) };
    const fill = (count: number): Uint8Array =>
      writeChunks([ihdr, ...new Array<Chunk>(count).fill(empty), idat, iend]);
    expect(readChunks(fill(maxChunks - 3))).toHaveLength(maxChunks);
    expect(() => readChunks(fill(maxChunks - 2))).toThrow(
      `more than ${String(maxChunks)} chunks`,
    );
  });

  it("gives views of the file, not copies", () => {
    const png = writeChunks([ihdr, note, idat, iend]);
    expect(readChunks(png)[1]?.data.buffer).toBe(png.buffer);
  });
});

describe("readChunks checks the critical chunks", () => {
  const [ihdr, idat, iend] = pixelChunks(blank(2, 2));
  if (ihdr === undefined || idat === undefined || iend === undefined) {
    throw new Error("no chunks");
  }
  const palette: Chunk = { type: "PLTE", data: new Uint8Array(3) };
  const text: Chunk = { type: "tEXt", data: ascii("k\0v") };
  const headerWith = (bitDepth: number, colorType: number): Chunk => {
    const chunk = header(2, 2);
    const data = chunk.data.slice();
    data[8] = bitDepth;
    data[9] = colorType;
    return { type: "IHDR", data };
  };

  const cases: [string, Chunk[], string][] = [
    ["a second IHDR", [ihdr, ihdr, idat, iend], "more than one IHDR chunk"],
    ["no image data", [ihdr, iend], "no IDAT chunk"],
    [
      "split image data",
      [ihdr, idat, text, idat, iend],
      "IDAT chunks are not consecutive",
    ],
    [
      "a non-empty IEND",
      [ihdr, idat, { type: "IEND", data: ascii("x") }],
      "IEND is not empty",
    ],
    [
      "an empty IHDR",
      [{ type: "IHDR", data: new Uint8Array() }, idat, iend],
      "IHDR is not 13 bytes",
    ],
    ["a zero width", [header(0, 2), idat, iend], "IHDR has an invalid size"],
    [
      "bit depth 3",
      [headerWith(3, 6), idat, iend],
      "IHDR has an invalid bit depth or colour type",
    ],
    [
      "colour type 5",
      [headerWith(8, 5), idat, iend],
      "IHDR has an invalid bit depth or colour type",
    ],
    [
      "a palette image without PLTE",
      [headerWith(8, 3), idat, iend],
      "no PLTE chunk",
    ],
    [
      "PLTE in a greyscale image",
      [headerWith(8, 0), palette, idat, iend],
      "PLTE chunk in a greyscale image",
    ],
    [
      "PLTE after the image data",
      [headerWith(8, 2), idat, palette, iend],
      "PLTE chunk after IDAT",
    ],
    [
      "two PLTE chunks",
      [headerWith(8, 3), palette, palette, idat, iend],
      "more than one PLTE chunk",
    ],
  ];

  for (const [name, chunks, message] of cases) {
    it(`refuses ${name}`, () => {
      expect(() => readChunks(writeChunks(chunks))).toThrow(message);
    });
  }

  it("accepts a palette image with its PLTE and a truecolour one with a suggested palette", () => {
    expect(
      readChunks(writeChunks([headerWith(8, 3), palette, idat, iend])),
    ).toHaveLength(4);
    expect(
      readChunks(writeChunks([headerWith(8, 2), palette, idat, iend])),
    ).toHaveLength(4);
  });

  const paletteOf = (entries: number): Chunk => ({
    type: "PLTE",
    data: new Uint8Array(entries * 3),
  });
  // How long a palette is tells a reader no more than the image data does: it
  // is for whatever decodes the image, and the record is read all the same.
  const paletteCases: [string, Chunk, Chunk][] = [
    [
      "an empty PLTE",
      headerWith(8, 3),
      { type: "PLTE", data: new Uint8Array(0) },
    ],
    [
      "a PLTE of one byte",
      headerWith(8, 3),
      { type: "PLTE", data: new Uint8Array(1) },
    ],
    [
      "a PLTE of four bytes",
      headerWith(8, 3),
      { type: "PLTE", data: new Uint8Array(4) },
    ],
    ["257 palette entries", headerWith(8, 3), paletteOf(257)],
    ["three entries at bit depth 1", headerWith(1, 3), paletteOf(3)],
    ["257 suggested entries", headerWith(8, 2), paletteOf(257)],
  ];
  for (const [name, ihdrChunk, plte] of paletteCases) {
    it(`leaves ${name} to whatever decodes the image`, () => {
      expect(
        readChunks(writeChunks([ihdrChunk, plte, idat, iend])),
      ).toHaveLength(4);
    });
  }

  it("accepts as many entries as the bit depth allows", () => {
    expect(
      readChunks(writeChunks([headerWith(1, 3), paletteOf(2), idat, iend])),
    ).toHaveLength(4);
    expect(
      readChunks(writeChunks([headerWith(8, 3), paletteOf(256), idat, iend])),
    ).toHaveLength(4);
    expect(
      readChunks(writeChunks([headerWith(8, 6), paletteOf(256), idat, iend])),
    ).toHaveLength(4);
  });

  it("refuses an invalid method", () => {
    const chunk = header(2, 2);
    const data = chunk.data.slice();
    data[12] = 2;
    expect(() =>
      readChunks(writeChunks([{ type: "IHDR", data }, idat, iend])),
    ).toThrow("IHDR has an invalid method");
  });
});

/** Undoes PNG's row filters, returning the pixels and each row's filter. */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
): { pixels: Uint8Array; filters: number[] } {
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  const filters: number[] = [];
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)] ?? -1;
    filters.push(type);
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft =
        x >= 4 && y > 0 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;
      const estimate = left + up - upLeft;
      const [toLeft, toUp, toUpLeft] = [left, up, upLeft].map((byte) =>
        Math.abs(estimate - byte),
      );
      const paeth =
        (toLeft ?? 0) <= (toUp ?? 0) && (toLeft ?? 0) <= (toUpLeft ?? 0)
          ? left
          : (toUp ?? 0) <= (toUpLeft ?? 0)
            ? up
            : upLeft;
      const predicted = [0, left, up, Math.floor((left + up) / 2), paeth][type];
      if (predicted === undefined) throw new Error(`filter ${String(type)}`);
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { pixels, filters };
}

/** The image data of a PNG's `IDAT` chunks, joined and inflated. */
function imageData(chunks: readonly Chunk[]): Uint8Array {
  const parts = chunks.filter((chunk) => chunk.type === "IDAT");
  const joined = new Uint8Array(
    parts.reduce((total, chunk) => total + chunk.data.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    joined.set(part.data, offset);
    offset += part.data.length;
  }
  return new Uint8Array(inflateSync(joined));
}

async function decoded(width: number, height: number, data: Uint8Array) {
  const chunks = readChunks(await encodeRgba(width, height, data));
  expect(chunks.at(0)?.type).toBe("IHDR");
  expect(chunks.at(-1)?.type).toBe("IEND");
  expect(chunks.slice(1, -1).every((chunk) => chunk.type === "IDAT")).toBe(
    true,
  );
  expect(imageHeader(chunks)).toEqual({
    width,
    height,
    bitDepth: 8,
    colorType: 6,
    interlaced: false,
  });
  return unfilter(imageData(chunks), width, height);
}
describe("encodeRgba", () => {
  it("encodes pixels that decode back exactly", async () => {
    let seed = 3;
    for (const [width, height] of [
      [1, 1],
      [3, 2],
      [17, 5],
    ] as const) {
      const data = Uint8Array.from({ length: width * height * 4 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed >>> 24;
      });
      expect((await decoded(width, height, data)).pixels).toEqual(data);
    }
  });

  it("picks the filter that leaves the smallest bytes for each row", async () => {
    // Rows that grow along, then rows that repeat the one above.
    const width = 16;
    const data = new Uint8Array(width * 4 * 3);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < 3; y++)
        data.fill(x * 9, (y * width + x) * 4, (y * width + x) * 4 + 4);
    }
    const { pixels, filters } = await decoded(width, 3, data);
    expect(pixels).toEqual(data);
    expect(filters).toEqual([1, 2, 2]);
  });

  it("pauses every few milliseconds of a long encoding, to its end", async () => {
    const width = 512;
    const height = 512;
    let seed = 5;
    const data = Uint8Array.from({ length: width * height * 4 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    });
    /** The stretches between one encoding's pauses, and what it made. */
    const encoded = async (): Promise<{
      stretches: number[];
      bytes: Uint8Array;
    }> => {
      const stretches: number[] = [];
      let last = performance.now();
      const bytes = await encodeRgba(width, height, data, {
        // A task of its own, as a frame or input would need.
        pause: async () => {
          stretches.push(performance.now() - last);
          await new Promise((resolve) => setImmediate(resolve));
          last = performance.now();
        },
      });
      // From the last pause to the end, too.
      stretches.push(performance.now() - last);
      return { stretches, bytes };
    };
    // A slice is 12 ms and a batch more; a frozen encoder would take all of it.
    // The fastest of three, as other work on the machine lengthens every
    // stretch of a run, by up to ten times (#124), while a piece of work with
    // no pause in it is long in every run. Each run's stretches are in the
    // message, should all three fail.
    const runs: number[][] = [];
    let bytes: Uint8Array = new Uint8Array();
    for (let run = 0; run < 3; run++) {
      const result = await encoded();
      runs.push(result.stretches);
      ({ bytes } = result);
      if (Math.max(...result.stretches) < 100) break;
    }
    const longest = Math.min(...runs.map((run) => Math.max(...run)));
    expect(
      longest,
      `stretches ${runs.map((run) => run.map((ms) => ms.toFixed(1)).join(", ")).join(" | ")} ms, load ${loadavg().join(", ")}`,
    ).toBeLessThan(100);
    expect(runs.every((run) => run.length > 1)).toBe(true);
    // The image data spans chunks of at most 64 KiB, each checksummed.
    const chunks = readChunks(bytes);
    const parts = chunks.filter((chunk) => chunk.type === "IDAT");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((chunk) => chunk.data.length <= 64 * 1024)).toBe(true);
    expect(imageData(chunks).length).toBe((width * 4 + 1) * height);
  });

  it("refuses pixels that do not match the size", async () => {
    await expect(encodeRgba(2, 2, new Uint8Array(15))).rejects.toThrow(
      "pixel data does not match the size",
    );
    await expect(encodeRgba(0, 2, new Uint8Array(0))).rejects.toThrow(
      "invalid image size",
    );
  });
});
