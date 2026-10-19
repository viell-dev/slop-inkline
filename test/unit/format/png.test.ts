import { describe, expect, it } from "vitest";
import {
  PngError,
  crc32,
  decodeInternationalText,
  deflate,
  encodeInternationalText,
  encodeRgba,
  imageHeader,
  inflate,
  isPng,
  pngSignature,
  readChunks,
  textKeyword,
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

describe("international text chunks", () => {
  it("round-trip compressed Unicode text", async () => {
    const chunk = await encodeInternationalText({
      keyword: "inkline",
      text: '{"name":"𐎠 ᚠ ä"}',
    });
    expect(chunk.type).toBe("iTXt");
    expect(textKeyword(chunk)).toBe("inkline");
    expect(await decodeInternationalText(chunk)).toEqual({
      keyword: "inkline",
      text: '{"name":"𐎠 ᚠ ä"}',
    });
  });

  it("write the layout PNG specifies", async () => {
    const chunk = await encodeInternationalText({ keyword: "k", text: "t" });
    // Keyword, null, compression flag 1, method 0, empty language tag and
    // translated keyword, then zlib data.
    expect([...chunk.data.subarray(0, 6)]).toEqual([0x6b, 0, 1, 0, 0, 0]);
    expect(await inflate(chunk.data.subarray(6))).toEqual(ascii("t"));
  });

  it("read uncompressed text with a language tag", async () => {
    const data = new Uint8Array([
      ...ascii("Title"),
      0,
      0,
      0,
      ...ascii("en"),
      0,
      ...ascii("Titel"),
      0,
      ...new TextEncoder().encode("Ünïcode"),
    ]);
    expect(await decodeInternationalText({ type: "iTXt", data })).toEqual({
      keyword: "Title",
      text: "Ünïcode",
    });
  });

  it("refuse invalid keywords", async () => {
    for (const keyword of [
      "",
      " lead",
      "trail ",
      "two  spaces",
      "x".repeat(80),
    ]) {
      await expect(
        encodeInternationalText({ keyword, text: "" }),
      ).rejects.toThrow(PngError);
    }
  });

  it("reject malformed chunks", async () => {
    const malformed = [
      ascii("nonull"),
      new Uint8Array([...ascii("k"), 0, 2, 0, 0, 0]),
      new Uint8Array([...ascii("k"), 0, 1, 1, 0, 0]),
      new Uint8Array([...ascii("k"), 0, 0, 0, 0]),
      new Uint8Array([...ascii("k"), 0, 0, 0, 0, 0, 0xff, 0xfe]),
    ];
    for (const data of malformed) {
      await expect(
        decodeInternationalText({ type: "iTXt", data }),
      ).rejects.toThrow();
    }
  });

  it("look for a keyword only where one can be", async () => {
    const long = new Uint8Array(200_000).fill(0x41);
    long[150_000] = 0;
    const chunk = { type: "iTXt", data: long };
    expect(textKeyword(chunk)).toBeUndefined();
    await expect(decodeInternationalText(chunk)).rejects.toThrow(
      "malformed iTXt chunk",
    );
  });

  it("finds no keyword in other chunks", () => {
    expect(textKeyword({ type: "tEXt", data: ascii("k\0v") })).toBeUndefined();
    expect(textKeyword({ type: "iTXt", data: ascii("\0") })).toBeUndefined();
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
  const paletteCases: [string, Chunk, Chunk, string][] = [
    [
      "an empty PLTE",
      headerWith(8, 3),
      { type: "PLTE", data: new Uint8Array(0) },
      "PLTE does not hold 1 to 256 RGB entries",
    ],
    [
      "a PLTE of one byte",
      headerWith(8, 3),
      { type: "PLTE", data: new Uint8Array(1) },
      "PLTE does not hold 1 to 256 RGB entries",
    ],
    [
      "a PLTE of four bytes",
      headerWith(8, 3),
      { type: "PLTE", data: new Uint8Array(4) },
      "PLTE does not hold 1 to 256 RGB entries",
    ],
    [
      "257 palette entries",
      headerWith(8, 3),
      paletteOf(257),
      "PLTE does not hold 1 to 256 RGB entries",
    ],
    [
      "three entries at bit depth 1",
      headerWith(1, 3),
      paletteOf(3),
      "PLTE does not hold 1 to 2 RGB entries",
    ],
    [
      "257 suggested entries",
      headerWith(8, 2),
      paletteOf(257),
      "PLTE does not hold 1 to 256 RGB entries",
    ],
  ];
  for (const [name, ihdrChunk, plte, message] of paletteCases) {
    it(`refuses ${name}`, () => {
      expect(() =>
        readChunks(writeChunks([ihdrChunk, plte, idat, iend])),
      ).toThrow(message);
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

describe("uncompressed international text", () => {
  const uncompressed = (method: number, text: string): Chunk => ({
    type: "iTXt",
    data: new Uint8Array([...ascii("k"), 0, 0, method, 0, 0, ...ascii(text)]),
  });

  it("ignores the compression method, as decoders must", async () => {
    expect(await decodeInternationalText(uncompressed(255, "{}"))).toEqual({
      keyword: "k",
      text: "{}",
    });
  });

  it("refuses text longer than the limit", async () => {
    await expect(
      decodeInternationalText(uncompressed(0, "12345"), 4),
    ).rejects.toThrow("text is longer than 4 bytes");
    expect(await decodeInternationalText(uncompressed(0, "1234"), 4)).toEqual({
      keyword: "k",
      text: "1234",
    });
  });

  it("applies the limit to compressed text too", async () => {
    const chunk = await encodeInternationalText({
      keyword: "k",
      text: "12345",
    });
    await expect(decodeInternationalText(chunk, 4)).rejects.toThrow(
      "data expands beyond 4 bytes",
    );
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

async function decoded(width: number, height: number, data: Uint8Array) {
  const chunks = readChunks(await encodeRgba(width, height, data));
  expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  expect(imageHeader(chunks)).toEqual({
    width,
    height,
    bitDepth: 8,
    colorType: 6,
    interlaced: false,
  });
  const raw = new Uint8Array(inflateSync(chunks[1]?.data ?? new Uint8Array()));
  return unfilter(raw, width, height);
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

  it("refuses pixels that do not match the size", async () => {
    await expect(encodeRgba(2, 2, new Uint8Array(15))).rejects.toThrow(
      "pixel data does not match the size",
    );
    await expect(encodeRgba(0, 2, new Uint8Array(0))).rejects.toThrow(
      "invalid image size",
    );
  });
});
