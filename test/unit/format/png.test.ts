import { describe, expect, it } from "vitest";
import {
  PngError,
  crc32,
  decodeInternationalText,
  deflate,
  encodeInternationalText,
  imageSize,
  inflate,
  isPng,
  pngSignature,
  readChunks,
  textKeyword,
  writeChunks,
  type Chunk,
} from "../../../src/format/png.ts";
import { blank, encodePng, pixelChunks } from "../../support/png.ts";

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

  it("reads the image size", () => {
    expect(imageSize(readChunks(png))).toEqual({ width: 3, height: 2 });
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
    await expect(inflate(compressed, 99_999)).rejects.toThrow(
      "data expands beyond 99999 bytes",
    );
    expect(await inflate(compressed, 100_000)).toHaveLength(100_000);
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
