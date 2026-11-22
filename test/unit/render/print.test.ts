import { describe, expect, it } from "vitest";
import {
  imageHeader,
  inflate,
  readChunks,
  writeChunks,
} from "../../../src/format/png.ts";
import {
  oriented,
  printMediaText,
  storedPng,
  tinted,
} from "../../../src/render/print.ts";
import { encodePng } from "../../support/png.ts";

describe("tinted", () => {
  it("gives every pixel the colour, and its own alpha", () => {
    const data = Uint8ClampedArray.of(
      ...[126, 126, 126, 255],
      ...[0, 0, 0, 0],
      ...[255, 0, 0, 128],
      ...[10, 200, 30, 1],
    );
    const out = tinted({ width: 2, height: 2, data }, [138, 92, 245, 255]);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(Array.from(out.data)).toEqual([
      ...[138, 92, 245, 255],
      ...[138, 92, 245, 0],
      ...[138, 92, 245, 128],
      ...[138, 92, 245, 1],
    ]);
    // The pixels it was given stay as they were.
    expect(Array.from(data.subarray(0, 4))).toEqual([126, 126, 126, 255]);
  });

  it("multiplies the alpha by a translucent colour's, as a mask does", () => {
    const data = Uint8ClampedArray.of(0, 0, 0, 255, 0, 0, 0, 100);
    const out = tinted({ width: 2, height: 1, data }, [0, 0, 0, 128]);
    expect([out.data[3], out.data[7]]).toEqual([128, 50]);
  });
});

describe("printMediaText", () => {
  it("makes what matches in print match on the screen", () => {
    expect(printMediaText("print")).toBe("all");
    expect(printMediaText("PRINT")).toBe("all");
    expect(printMediaText("only print and (orientation: portrait)")).toBe(
      "only all and (orientation: portrait)",
    );
    expect(printMediaText("not screen")).toBe("not inkline-screen");
  });

  it("makes what matches only on the screen match nothing", () => {
    expect(printMediaText("screen")).toBe("inkline-screen");
    expect(printMediaText("screen and (forced-colors: active)")).toBe(
      "inkline-screen and (forced-colors: active)",
    );
    expect(printMediaText("not print")).toBe("not all");
    expect(printMediaText("screen, print")).toBe("inkline-screen, all");
  });

  it("leaves other lists, and media features, as they are", () => {
    expect(printMediaText("")).toBe("");
    expect(printMediaText("all")).toBe("all");
    expect(printMediaText("(max-width: 300px)")).toBe("(max-width: 300px)");
    expect(printMediaText("(display-mode: fullscreen)")).toBe(
      "(display-mode: fullscreen)",
    );
  });
});

describe("storedPng", () => {
  it("writes a PNG whose every CRC checks, holding the pixels as they are", async () => {
    // Wider than one stored block's 65,535 bytes holds, so that it takes two.
    const width = 20_000;
    const height = 2;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let at = 0; at < data.length; at++) data[at] = (at * 7) % 256;
    const bytes = storedPng({ width, height, data });
    const chunks = readChunks(bytes);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(chunks.some((chunk) => chunk.damaged === true)).toBe(false);
    expect(imageHeader(chunks)).toEqual({
      width,
      height,
      bitDepth: 8,
      colorType: 6,
      interlaced: false,
    });
    const [, idat] = chunks;
    if (idat === undefined) throw new Error("no IDAT");
    // DecompressionStream checks the Adler-32 at the end.
    const rows = await inflate(idat.data);
    const stride = width * 4;
    expect(rows.length).toBe((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      expect(rows[y * (stride + 1)]).toBe(0);
      expect(
        Array.from(rows.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))),
      ).toEqual(Array.from(data.subarray(y * stride, (y + 1) * stride)));
    }
  });

  it("writes an image of a single pixel", async () => {
    const bytes = storedPng({
      width: 1,
      height: 1,
      data: Uint8ClampedArray.of(1, 2, 3, 4),
    });
    const [, idat] = readChunks(bytes);
    if (idat === undefined) throw new Error("no IDAT");
    expect(Array.from(await inflate(idat.data))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("oriented", () => {
  const png = encodePng({
    width: 1,
    height: 1,
    data: Uint8Array.of(0, 0, 0, 255),
  });

  it("knows a PNG that says which way up it shows", () => {
    const [header, ...rest] = readChunks(png);
    if (header === undefined) throw new Error("no IHDR");
    const exif = { type: "eXIf", data: Uint8Array.of(0x4d, 0x4d, 0, 0x2a) };
    expect(oriented(png)).toBe(false);
    expect(oriented(writeChunks([header, exif, ...rest]))).toBe(true);
  });

  it("counts a file that is not a PNG as one, so that it makes no copy", () => {
    expect(oriented(new TextEncoder().encode("not a picture"))).toBe(true);
  });
});
