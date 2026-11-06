import { readFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import type { InkRecord } from "../../../src/format/record.ts";
import { goldenFiles } from "../../fixtures/format/records.ts";
import { loadModules, toBase64 } from "../support/browser.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/format");

/**
 * How far a redraw may differ from a golden file's stored alpha, from one
 * Chromium to another: strokes, cuts, polygons, and fills differ by a level or
 * so between the versions tested. They are a check on this code, not a promise
 * about other renderers, which can differ by more at an edge, as the format's
 * Antialiasing section says: an exact renderer differs by up to 128 levels
 * along a cut.
 */
const tolerance = {
  /** How many alpha levels mark a pixel as different. */
  levels: 16,
  /** The share of the pixels with ink that may differ by that much. */
  share: 0.02,
  /** The most any pixel may differ, in alpha levels. */
  worst: 64,
};

/**
 * The same for an enlarged base layer, whose resampling is up to the renderer:
 * Chromium 120 and 150 differ by up to 45 levels on `v1-base`'s harsh pattern,
 * in about a fifth of its pixels with ink. A reduced one needs no such room, as
 * a save halves its image first: they differ there by 11 levels at most.
 */
const baseTolerance = { ...tolerance, share: 0.3 };

describe("The file format in Obsidian's renderer", function () {
  before(async function () {
    await loadModules();
  });

  it("stops inflating within a few slices of the limit", async function () {
    const result = await browser.execute(async () => {
      const { png } = window.inklineTest;
      // 64 MiB of zeros, about 64 KiB compressed.
      const compressed = await png.deflate(new Uint8Array(64 * 1024 * 1024));
      let consumed = 0;
      try {
        await png.inflate(compressed, {
          limit: 1024 * 1024,
          onInput: (bytes) => (consumed = bytes),
        });
        return { refused: false, consumed, length: compressed.length };
      } catch (error) {
        return {
          refused: true,
          consumed,
          length: compressed.length,
          message: String(error),
        };
      }
    });
    expect(result.refused).toBe(true);
    expect(result.message).toContain("data expands beyond 1048576 bytes");
    // A 1 KiB slice of zeros inflates to about 1 MiB, so the limit is passed
    // within a few slices.
    expect(result.consumed).toBeLessThanOrEqual(4 * 1024);
    expect(result.length).toBeGreaterThan(32 * 1024);
  });

  for (const name of Object.keys(goldenFiles)) {
    it(`reads the golden file ${name}`, async function () {
      const bytes = await readFile(path.join(fixtures, `${name}.ink.png`));
      const expected = await readFile(
        path.join(fixtures, `${name}.json`),
        "utf8",
      );
      const text = await browser.execute(async (base64: string) => {
        const { inkFile, record } = window.inklineTest;
        const data = Uint8Array.from(atob(base64), (char) =>
          char.charCodeAt(0),
        );
        const source = await inkFile.readInkFile(data);
        return source.kind === "record"
          ? `${record.serializeRecord(source.record)}\n`
          : JSON.stringify(source);
      }, toBase64(bytes));
      expect(text).toBe(expected);
    });

    it(`draws ${name} as the file's pixels show it, and saves it again unchanged`, async function () {
      const bytes = await readFile(path.join(fixtures, `${name}.ink.png`));
      const result = await browser.execute(
        async (base64: string, levels: number) => {
          const { canvas, record, render } = window.inklineTest;
          const data = Uint8Array.from(atob(base64), (char) =>
            char.charCodeAt(0),
          );
          const opened = await canvas.openInk(data);
          if (opened.kind !== "editable") throw new Error(opened.kind);
          const stored = canvas.readPixels(await canvas.decodePng(data));
          const surface = new OffscreenCanvas(stored.width, stored.height);
          const context = surface.getContext("2d");
          if (context === null) throw new Error("no context");
          render.drawInk(
            context,
            opened.document.strokes,
            opened.base === undefined
              ? undefined
              : canvas.reducedBase(opened.base),
          );
          const { data: drawn } = context.getImageData(
            0,
            0,
            stored.width,
            stored.height,
          );
          let ink = 0;
          let differing = 0;
          let worst = 0;
          for (let at = 3; at < drawn.length; at += 4) {
            const was = stored.data[at] ?? 0;
            const now = drawn[at] ?? 0;
            if (was > 0) ink++;
            const difference = Math.abs(was - now);
            if (difference > levels) differing++;
            worst = Math.max(worst, difference);
          }
          const saved = await canvas.saveInk(
            opened.document,
            opened.base,
            opened.carried,
          );
          const resaved = canvas.readPixels(
            await canvas.decodePng(saved.bytes),
          );
          let moved = 0;
          for (let at = 3; at < stored.data.length; at += 4) {
            const difference = Math.abs(
              (stored.data[at] ?? 0) - (resaved.data[at] ?? 0),
            );
            if (difference > levels) moved++;
          }
          return {
            ink,
            differing,
            worst,
            moved,
            width: stored.width,
            savedWidth: saved.width,
            sameRecord:
              record.serializeRecord(saved.record) ===
              record.serializeRecord(opened.document),
          };
        },
        toBase64(bytes),
        tolerance.levels,
      );
      console.log(`${name} against its pixels`, JSON.stringify(result));
      const { share, worst } = name === "v1-base" ? baseTolerance : tolerance;
      expect(result.ink).toBeGreaterThan(100);
      expect(result.differing).toBeLessThanOrEqual(result.ink * share);
      expect(result.worst).toBeLessThanOrEqual(worst);
      expect(result.savedWidth).toBe(result.width);
      expect(result.sameRecord).toBe(true);
      expect(result.moved).toBeLessThanOrEqual(result.ink * share);
    });
  }

  it("refuses a record with anything after its zlib stream", async function () {
    const result = await browser.execute(async () => {
      const { inkFile, png } = window.inklineTest;
      const image = new Uint8ClampedArray(48 * 192 * 4);
      const whole = await inkFile.writeInkFile(
        await window.inklineTest.canvas.encodePixels({
          width: 48,
          height: 192,
          data: image,
        }),
        { strokes: [{ tool: "pen", size: 16, points: [16, 32] }] },
      );
      const [header, chunk, ...rest] = png.readChunks(whole);
      if (header === undefined || chunk === undefined) {
        throw new Error("no chunks");
      }
      const data = new Uint8Array(chunk.data.length + 4);
      data.set(chunk.data);
      const longer = png.writeChunks([
        header,
        { type: chunk.type, data },
        ...rest,
      ]);
      const source = await inkFile.readInkFile(longer);
      return source.kind === "pixels" ? source.reason : source.kind;
    });
    expect(result).toBe("damaged");
  });

  it("opens a record over damaged image data, and draws the image again", async function () {
    const result = await browser.execute(async () => {
      const { canvas, inkFile, png } = window.inklineTest;
      const written = {
        strokes: [{ tool: "pen", size: 160, points: [800, 800, 1200, 800] }],
      } as const;
      const whole = await canvas.saveInk(written, undefined);
      const chunks = png.readChunks(whole.bytes);
      const damaged = png.writeChunks(
        chunks.map((chunk) =>
          chunk.type === "IDAT"
            ? { type: "IDAT", data: Uint8Array.of(1, 2, 3) }
            : chunk,
        ),
      );
      const decodes = await canvas.decodePng(damaged).then(
        () => true,
        () => false,
      );
      const opened = await canvas.openInk(damaged);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const saved = await canvas.saveInk(
        opened.document,
        opened.base,
        opened.carried,
      );
      const source = await inkFile.readInkFile(saved.bytes);
      return {
        decodes,
        kind: source.kind,
        ink: canvas
          .readPixels(await canvas.decodePng(saved.bytes))
          .data.filter((_, at) => at % 4 === 3 && _ > 0).length,
      };
    });
    expect(result.decodes).toBe(false);
    expect(result.kind).toBe("record");
    expect(result.ink).toBeGreaterThan(100);
  });

  it("widens a file another writer clipped, on saving, to the ink its record has", async function () {
    const result = await browser.execute(async () => {
      const { canvas, inkFile, render } = window.inklineTest;
      // Two dots, the second past the right edge of a 48-pixel image.
      const record = {
        strokes: [
          { tool: "pen", size: 96, points: [384, 1280] },
          { tool: "pen", size: 96, points: [1280, 1280] },
        ],
      } as const;
      const surface = new OffscreenCanvas(48, 192);
      const context = surface.getContext("2d");
      if (context === null) throw new Error("no context");
      render.drawInk(context, record.strokes, undefined);
      const file = await inkFile.writeInkFile(
        await canvas.encodePixels(context.getImageData(0, 0, 48, 192)),
        record,
      );
      const opened = await canvas.openInk(file);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const saved = await canvas.saveInk(opened.document, opened.base);
      const again = await canvas.openInk(saved.bytes);
      if (again.kind !== "editable") throw new Error(again.kind);
      const resaved = await canvas.saveInk(again.document, again.base);
      return {
        opened: opened.width,
        saved: saved.width,
        resaved: resaved.width,
      };
    });
    expect(result.opened).toBe(48);
    expect(result.saved).toBeGreaterThan(48);
    // From there, saving changes nothing.
    expect(result.resaved).toBe(result.saved);
  });

  it("ignores a picture's orientation metadata, and drops it on saving", async function () {
    const result = await browser.execute(async () => {
      const { canvas, png } = window.inklineTest;
      const plain = await canvas.encodePixels({
        width: 4,
        height: 8,
        data: new Uint8ClampedArray(4 * 8 * 4).fill(255),
      });
      // A little-endian TIFF header with one tag: Orientation, 6, which turns
      // the image a quarter turn.
      const exif = Uint8Array.of(
        ...[0x49, 0x49, 0x2a, 0, 8, 0, 0, 0],
        ...[1, 0],
        ...[0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0],
        ...[0, 0, 0, 0],
      );
      const [header, ...rest] = png.readChunks(plain);
      if (header === undefined) throw new Error("no header");
      const turned = png.writeChunks([
        header,
        { type: "eXIf", data: exif },
        ...rest,
      ]);
      const bitmap = await canvas.decodePng(turned);
      const opened = await canvas.openInk(turned);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const saved = await canvas.saveInk(
        opened.document,
        opened.base,
        opened.carried,
      );
      return {
        decoded: [bitmap.width, bitmap.height],
        carried: png.readChunks(saved.bytes).map((chunk) => chunk.type),
      };
    });
    // Newer Chromium would turn the image, older Chromium would not.
    expect(result.decoded).toEqual([4, 8]);
    expect(result.carried).not.toContain("eXIf");
  });

  it("leaves a damaged record alone, and opens its pixels only when asked", async function () {
    const result = await browser.execute(async () => {
      const { canvas, inkFile, png } = window.inklineTest;
      const data = new Uint8ClampedArray(48 * 192 * 4);
      for (let at = 3; at < data.length; at += 4) data[at] = 200;
      const image = await canvas.encodePixels({ width: 48, height: 192, data });
      const whole = await inkFile.writeInkFile(image, {
        strokes: [{ tool: "pen", size: 16, points: [16, 32] }],
      });
      const [header, chunk, ...rest] = png.readChunks(whole);
      if (header === undefined || chunk === undefined) {
        throw new Error("no chunks");
      }
      // Cut short, as a bad copy might, with its CRC made right again.
      const short = { type: chunk.type, data: chunk.data.subarray(0, 8) };
      const damaged = png.writeChunks([header, short, ...rest]);
      const opened = await canvas.openInk(damaged);
      const picture = await canvas.openPicture(damaged);
      return {
        kind: opened.kind,
        strokes: picture.document.strokes.length,
        hasBase: picture.document.base !== undefined,
      };
    });
    expect(result.kind).toBe("damaged");
    expect(result.strokes).toBe(0);
    expect(result.hasBase).toBe(true);
  });

  it("adds a record to a PNG the canvas encodes and reads it back", async function () {
    const result = await browser.execute(async () => {
      const { inkFile, png, record } = window.inklineTest;
      const canvas = new OffscreenCanvas(8, record.imageHeight);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2D context");
      context.fillStyle = "#7c7c7c";
      context.fillRect(2, 3, 4, 5);
      const encoded = new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      );
      const written: InkRecord = {
        strokes: [{ tool: "pen", size: 16, points: [32, 48] }],
      };
      const file = await inkFile.writeInkFile(encoded, written);
      const source = await inkFile.readInkFile(file);
      const pixels = (bytes: Uint8Array): string =>
        png
          .readChunks(bytes)
          .filter((chunk) => chunk.type === "IDAT")
          .map((chunk) => chunk.data.join(","))
          .join(";");
      return {
        types: png.readChunks(file).map((chunk) => chunk.type),
        read:
          source.kind === "record"
            ? record.serializeRecord(source.record)
            : JSON.stringify(source),
        expected: record.serializeRecord(written),
        samePixels: pixels(file) === pixels(encoded),
      };
    });
    expect(result.types.slice(0, 2)).toEqual(["IHDR", "inKL"]);
    expect(result.types).toContain("IDAT");
    expect(result.read).toBe(result.expected);
    expect(result.samePixels).toBe(true);
  });
});
