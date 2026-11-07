import { readFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { browser, expect } from "@wdio/globals";
import { recordChunkType } from "../../../src/format/ink-file.ts";
import { readChunks, writeChunks } from "../../../src/format/png.ts";
import { serializeRecord, type InkRecord } from "../../../src/format/record.ts";
import { goldenFiles } from "../../fixtures/format/records.ts";
import {
  passedOver,
  textCases,
  usedAfter,
} from "../../fixtures/format/text-cases.ts";
import { encodePng, blank, header } from "../../support/png.ts";
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
 * in about a fifth of its pixels with ink. A reduced one needs no room at all,
 * as a save works out its pixels without the renderer's help.
 */
const baseTolerance = { ...tolerance, share: 0.3 };

/**
 * The most a save may change a pixel of a stroke it did not touch, when an edit
 * moves the strokes across a save's canvas. Chromium works in 32-bit numbers,
 * so its rendering depends a little on where a shape falls: over 600 seeded
 * saves of each kind on each of Chromium 120 and 150, at least 95% changed no
 * pixel and the worst changed one by 8 levels. A stroke that takes another
 * shape changes pixels by all 255. An edit that leaves the strokes where they
 * are on the canvas must change no pixel at all.
 */
const movedLevels = 16;

/** The chunks of a plain image, for a symbol built by hand. */
function encodeImage(): ReturnType<typeof readChunks> {
  return readChunks(encodePng(blank(48, 192)));
}

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
              : await canvas.reducedBase(opened.base),
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
      if (name === "v1-base-reduced") expect(result.worst).toBe(0);
      const { share, worst } = name === "v1-base" ? baseTolerance : tolerance;
      expect(result.ink).toBeGreaterThan(100);
      expect(result.differing).toBeLessThanOrEqual(result.ink * share);
      expect(result.worst).toBeLessThanOrEqual(worst);
      expect(result.savedWidth).toBe(result.width);
      expect(result.sameRecord).toBe(true);
      expect(result.moved).toBeLessThanOrEqual(result.ink * share);
    });
  }

  it("reads each crafted text chunk as the format says", async function () {
    const bytes = await readFile(path.join(fixtures, "v1-strokes.ink.png"));
    const cases = textCases.map(({ name, chunk, values }) => ({
      name,
      type: chunk.type,
      data: toBase64(chunk.data),
      values,
    }));
    const read = await browser.execute(
      async (
        base64: string,
        crafted: readonly {
          name: string;
          type: string;
          data: string;
        }[],
      ) => {
        const { png, text } = window.inklineTest;
        const decoded = (encoded: string): Uint8Array<ArrayBuffer> =>
          Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        const chunks = png.readChunks(decoded(base64));
        const data = chunks.findIndex(({ type }) => type === "IDAT");
        const results: Record<string, readonly string[]> = {};
        for (const { name, type, data: encoded } of crafted) {
          const file = png.writeChunks([
            ...chunks.slice(0, data),
            { type, data: decoded(encoded) },
            ...chunks.slice(data),
          ]);
          const { reading } = await text.readText(png.readChunks(file));
          results[name] = reading;
        }
        return results;
      },
      toBase64(bytes),
      cases,
    );
    expect(read).toEqual(
      Object.fromEntries(cases.map(({ name, values }) => [name, values])),
    );
  });

  it("changes text and nothing else, whatever else the file holds", async function () {
    const bytes = await readFile(path.join(fixtures, "v1-text.ink.png"));
    const skipped = [...passedOver, usedAfter].map(({ type, data }) => ({
      type,
      data: toBase64(data),
    }));
    const result = await browser.execute(
      async (
        base64: string,
        crafted: readonly { type: string; data: string }[],
      ) => {
        const { inkFile, png, record, text } = window.inklineTest;
        const decoded = (encoded: string): Uint8Array<ArrayBuffer> =>
          Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        const pinned = decoded(base64);
        const chunks = png.readChunks(pinned);
        const data = chunks.findIndex(({ type }) => type === "IDAT");
        // Chunks of the reading that this reader cannot use, then one it can.
        const file = png.writeChunks([
          ...chunks.slice(0, data),
          ...crafted.map(({ type, data: encoded }) => ({
            type,
            data: decoded(encoded),
          })),
          ...chunks.slice(data),
        ]);
        // One bit of damage to the record's version, which no change may mend.
        const opened = png.readChunks(file);
        const inRecord = opened.find(({ type }) => type === "inKL");
        if (inRecord === undefined) throw new Error("no record");
        inRecord.data.set([(inRecord.data[0] ?? 0) ^ 1], 0);

        const changed = await text.writeText(file, "reading", ["KA"]);
        const encoded = (bytes: Uint8Array): string[] =>
          png.readChunks(bytes).map((chunk) => record.toBase64(chunk.data));
        const cleared = await text.writeText(changed, "reading", []);
        const source = await inkFile.readInkFile(changed);
        return {
          read: await text.readText(png.readChunks(changed)),
          afterClearing: await text.readText(png.readChunks(cleared)),
          source: source.kind === "pixels" ? source.reason : source.kind,
          detail: "detail" in source ? source.detail : "",
          before: encoded(file),
          after: encoded(changed),
        };
      },
      toBase64(bytes),
      skipped,
    );
    expect(result.read.reading).toEqual(["KA"]);
    expect(result.read.translation).toEqual(["rice field", "田"]);
    // In file order: the header, the record, the two pinned chunks, the crafted
    // chunks, and the image data. The pinned reading and the crafted one that
    // can be used give way to the new one, and every other chunk stays.
    const usable = [2, 3 + skipped.length];
    expect(result.after.toSpliced(2, 1)).toEqual(
      result.before.filter((_, index) => !usable.includes(index)),
    );
    expect(result.afterClearing.reading).toEqual([]);
    expect(result.source).toBe("damaged");
    expect(result.detail).toBe("bad CRC in the record chunk");
  });

  it("keeps a file's text, byte for byte, through edits that move the crop", async function () {
    const bytes = await readFile(path.join(fixtures, "v1-text.ink.png"));
    const result = await browser.execute(async (base64: string) => {
      const { canvas, png, record } = window.inklineTest;
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const text = (file: Uint8Array): string[] =>
        png
          .readChunks(file)
          .filter((chunk) => chunk.type === "iTXt")
          .map((chunk) => record.toBase64(chunk.data));
      /** Adds a mark to the left of the ink, which moves the crop. */
      const edited = async (file: Uint8Array): Promise<Uint8Array> => {
        const opened = await canvas.openInk(file);
        if (opened.kind !== "editable") throw new Error(opened.kind);
        const mark = { tool: "pen" as const, size: 160, points: [-1600, 1600] };
        const saved = await canvas.saveInk(
          {
            ...opened.document,
            strokes: [...opened.document.strokes, mark],
          },
          opened.base,
          opened.carried,
        );
        return saved.bytes;
      };
      const once = await edited(data);
      const twice = await edited(once);
      // What a program that drops the record leaves, a picture with its text.
      const picture = png.writeChunks(
        png.readChunks(data).filter((chunk) => chunk.type !== "inKL"),
      );
      const drawn = await edited(picture);
      return {
        before: text(data),
        once: text(once),
        twice: text(twice),
        drawn: text(drawn),
        recorded: png.readChunks(drawn).some((chunk) => chunk.type === "inKL"),
      };
    }, toBase64(bytes));
    expect(result.before).toHaveLength(2);
    expect(result.once).toEqual(result.before);
    expect(result.twice).toEqual(result.before);
    expect(result.drawn).toEqual(result.before);
    expect(result.recorded).toBe(true);
  });

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

  it("opens a record over image data with a wrong CRC, as damage leaves it", async function () {
    const result = await browser.execute(async () => {
      const { canvas, inkFile, png } = window.inklineTest;
      const written = {
        strokes: [{ tool: "pen", size: 160, points: [800, 800, 1200, 800] }],
      } as const;
      const whole = await canvas.saveInk(written, undefined);
      const flipped = whole.bytes.slice();
      // One bit of the last byte of `IDAT`'s data, its CRC left as it was.
      const end = flipped.length - 12 - 4 - 1;
      flipped[end] = (flipped[end] ?? 0) ^ 1;
      const opened = await canvas.openInk(flipped);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const saved = await canvas.saveInk(
        opened.document,
        opened.base,
        opened.carried,
      );
      const source = await inkFile.readInkFile(saved.bytes);
      return {
        wrong: png
          .readChunks(flipped)
          .flatMap((chunk) => (chunk.damaged === true ? [chunk.type] : [])),
        strokes: opened.document.strokes.length,
        kind: source.kind,
        same: saved.bytes.length === whole.bytes.length,
      };
    });
    expect(result.wrong).toEqual(["IDAT"]);
    expect(result.strokes).toBe(1);
    expect(result.kind).toBe("record");
    expect(result.same).toBe(true);
  });

  it("takes in a source pixel in the saved pixel that covers it", async function () {
    const result = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      const alpha = [0, 0, 0, 0, 0, 255, 0, 0, 0];
      const png = await canvas.encodePixels({
        width: alpha.length,
        height: 1,
        data: Uint8ClampedArray.from(
          alpha.flatMap((value) => [126, 126, 126, value]),
        ),
      });
      // Nine pixels drawn three wide, so that the middle one covers the fourth
      // to the sixth, and the sixth holds all the ink.
      const layer = { x: 160, y: 800, width: 48, height: 16, png };
      const saved = await canvas.saveInk(
        { strokes: [], base: layer },
        await canvas.drawableBase(layer),
      );
      const { width, data } = canvas.readPixels(
        await canvas.decodePng(saved.bytes),
      );
      const left = (saved.record.base?.x ?? 0) / 16;
      const pixel = (x: number): number =>
        data[(50 * width + left + x) * 4 + 3] ?? 0;
      return [pixel(0), pixel(1), pixel(2)];
    });
    expect(result).toEqual([0, 85, 0]);
  });

  for (const [wide, column] of [
    [511, 255],
    [512, 256],
  ] as const) {
    it(`keeps a line's ink through a ${String(wide)}-pixel-wide picture`, async function () {
      const total = await browser.execute(
        async (width: number, line: number) => {
          const { canvas } = window.inklineTest;
          const height = 768;
          const data = new Uint8ClampedArray(width * height * 4);
          for (let y = 0; y < height; y++) {
            data[(y * width + line) * 4 + 3] = 255;
          }
          const opened = await canvas.openPicture(
            await canvas.encodePixels({ width, height, data }),
          );
          const saved = await canvas.saveInk(
            opened.document,
            opened.base,
            opened.carried,
          );
          const image = canvas.readPixels(await canvas.decodePng(saved.bytes));
          let sum = 0;
          for (let x = 0; x < image.width; x++) {
            sum += image.data[(96 * image.width + x) * 4 + 3] ?? 0;
          }
          return sum;
        },
        wide,
        column,
      );
      // The line is a quarter of a pixel wide once drawn, so a row holds 63.75
      // levels of ink, with a rounding on each pixel it meets.
      expect(Math.abs(total - 63.75)).toBeLessThanOrEqual(1);
    });
  }

  it("reduces each way on its own, and saves the result again unchanged", async function () {
    const result = await browser.execute(async () => {
      const { canvas, record } = window.inklineTest;
      // Stripes reduced across and enlarged down, placed off the pixel grid.
      const width = 257;
      const height = 3;
      const data = new Uint8ClampedArray(width * height * 4);
      let source = 0;
      for (let at = 0; at < width * height; at++) {
        const alpha = (at % width) % 5 === 0 ? 255 : 0;
        data[at * 4 + 3] = alpha;
        source += alpha;
      }
      const png = await canvas.encodePixels({ width, height, data });
      const layer = { x: 165, y: 803, width: 1021, height: 1501, png };
      const saved = await canvas.saveInk(
        { strokes: [], base: layer },
        await canvas.drawableBase(layer),
      );
      const image = canvas.readPixels(await canvas.decodePng(saved.bytes));
      let drawn = 0;
      for (let at = 3; at < image.data.length; at += 4) {
        drawn += image.data[at] ?? 0;
      }
      const opened = await canvas.openInk(saved.bytes);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const again = await canvas.saveInk(
        opened.document,
        opened.base,
        opened.carried,
      );
      const resaved = canvas.readPixels(await canvas.decodePng(again.bytes));
      return {
        // The same ink, spread over the rectangle's area.
        expected: (source * 1021 * 1501) / (width * height * 256),
        drawn,
        sameRecord:
          record.serializeRecord(again.record) ===
          record.serializeRecord(saved.record),
        samePixels: resaved.data.every((value, at) => value === image.data[at]),
      };
    });
    // All the ink across, and what an enlarging filter leaves down.
    expect(Math.abs(result.drawn / result.expected - 1)).toBeLessThan(0.02);
    expect(result.sameRecord).toBe(true);
    expect(result.samePixels).toBe(true);
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

  it("keeps a stroke's shape through the crop of its first save", async function () {
    const result = await browser.execute(async () => {
      const { canvas, render } = window.inklineTest;
      // A turn on a tie, which rounding in its place in the file could settle
      // either way: this stroke took another shape when cropped by 16 pixels.
      const strokes: InkRecord["strokes"] = [
        { tool: "pen", size: 192, points: [1014, 2044, 214, 2364, 490, 2068] },
      ];
      const saved = await canvas.saveInk({ strokes }, undefined);
      const bitmap = await canvas.decodePng(saved.bytes);
      const stored = canvas.readPixels(bitmap);
      bitmap.close();
      const surface = new OffscreenCanvas(saved.width, 192);
      const context = surface.getContext("2d");
      if (context === null) throw new Error("no context");
      render.drawInk(context, strokes, undefined, -saved.left);
      const { data } = context.getImageData(0, 0, saved.width, 192);
      let worst = 0;
      for (let at = 3; at < data.length; at += 4) {
        worst = Math.max(
          worst,
          Math.abs((data[at] ?? 0) - (stored.data[at] ?? 0)),
        );
      }
      return { left: saved.left, worst };
    });
    expect(result.left).toBe(16);
    expect(result.worst).toBeLessThanOrEqual(movedLevels);
  });

  // A dot away from the ink moves the crop, and every stroke in the record with
  // it, which must leave those strokes as they were. A mark on the left moves
  // the strokes across the canvas, unless a stroke past the image's left edge
  // holds them; one on the right moves only the image's right edge, and with it
  // where a canvas of the crop would end. The number is how far a pixel may
  // change, in levels.
  const editCases: [string, number, string, number, "left" | "right"][] = [
    ["a stroke on a tie", 0, "tie", movedLevels, "left"],
    ["pens, polygons, fills, and cuts", 12, "strokes", movedLevels, "left"],
    ["pens, polygons, fills, and cuts", 12, "strokes", 0, "right"],
    ["strokes as the editor records them", 12, "recorded", movedLevels, "left"],
    ["an eraser stroke the image's edge cuts", 12, "eraser", 0, "left"],
    [
      "an eraser stroke nearly as far as a canvas goes",
      3,
      "far eraser",
      0,
      "left",
    ],
    ["a pen with its left end erased", 12, "left", 0, "left"],
    ["a pen with its right end erased", 12, "right", movedLevels, "left"],
    ["a pen with its right end erased", 12, "right", 0, "right"],
    ["a pen with both ends erased", 12, "both", 0, "left"],
    ["a pen of few points with both ends erased", 12, "sparse", 0, "left"],
    ["a pen of few points with both ends erased", 12, "sparse", 0, "right"],
  ];
  for (const [name, drawings, kind, levels, side] of editCases) {
    it(`leaves ${name} alone when a separate mark on the ${side} moves the crop`, async function () {
      const result = await browser.execute(
        async (drawings, kind, side) => {
          const { canvas } = window.inklineTest;
          let seed = 0x2468ace;
          const next = (range: number): number => {
            seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
            return (seed >>> 8) % range;
          };
          const pointerPath = (): number[] => {
            let [x, y] = [800 + next(2400), 500 + next(1800)];
            const points = [x, y];
            for (let left = 2 + next(24); left > 0; left--) {
              x = Math.max(320, Math.min(4000, x + next(401) - 200));
              y = Math.max(320, Math.min(2700, y + next(401) - 200));
              points.push(x, y);
            }
            return points;
          };
          const stroke = (): InkRecord["strokes"][number] => {
            const tool = "pen";
            const size = 32 + next(300);
            const points = pointerPath();
            switch (next(4)) {
              case 0:
                return { tool, size, points, kind: "polygon" };
              case 1:
                return { tool, points, kind: "fill" };
              case 2:
                return {
                  tool,
                  size,
                  points,
                  cut: { start: "up", end: "down" },
                };
              default:
                return { tool, size, points };
            }
          };
          /** An eraser stroke as a pointer draws it, from past the left edge. */
          const eraser = (start = -1600): InkRecord["strokes"][number] => {
            let [x, y] = [start, 600 + next(1600)];
            const points: number[] = [];
            while (x < 1600) {
              points.push(x, y);
              x += 48 + next(80);
              y += next(33) - 16;
            }
            return { tool: "eraser", size: 64 + next(200), points };
          };
          /**
           * A pen line from `from` to `to`, in pixels, as the editor records
           * one: pointer samples `gap` pixels apart on a path that wanders,
           * with the gaps between filled to at most 2 pixels.
           */
          const recordedPen = (
            from: number,
            to: number,
            gap: number,
          ): InkRecord["strokes"][number] => {
            const points: number[] = [];
            const record = (x: number, y: number): void => {
              const [unitX, unitY] = [Math.round(x * 16), Math.round(y * 16)];
              if (points.at(-2) === unitX && points.at(-1) === unitY) return;
              points.push(unitX, unitY);
            };
            let [x, y, turn] = [from, 70 + next(50), 0];
            while (x < to) {
              turn = Math.max(-1, Math.min(1, turn + (next(100) - 50) / 150));
              const nextX = x + (gap * (70 + next(60))) / 100;
              const nextY = Math.max(24, Math.min(170, y + gap * 0.5 * turn));
              const steps = Math.ceil(Math.hypot(nextX - x, nextY - y) / 2);
              for (let step = 1; step <= steps; step++) {
                record(
                  x + ((nextX - x) * step) / steps,
                  y + ((nextY - y) * step) / steps,
                );
              }
              [x, y] = [nextX, nextY];
            }
            return { tool: "pen", size: 96 * (1 + next(4)), points };
          };
          /** A straight eraser from `from` to `to`, in pixels, the full height. */
          const strip = (
            from: number,
            to: number,
          ): InkRecord["strokes"][number] => ({
            tool: "eraser",
            kind: "fill",
            points: [from, -125, to, -125, to, 312, from, 312].map(
              (value) => value * 16,
            ),
          });
          const gap = (): number => [8, 20, 60][next(3)] ?? 8;
          /**
           * A pen line of points 125 pixels apart, as only another program
           * writes, whose curves are long enough to reach past a canvas's
           * margin into the image.
           */
          const sparsePen = (): InkRecord["strokes"][number] => {
            const points: number[] = [];
            for (let x = -400; x < 900; x += 125) {
              points.push(x * 16, (40 + next(110)) * 16);
            }
            return { tool: "pen", size: 96 * (1 + next(4)), points };
          };
          const drawing = (): InkRecord["strokes"] => {
            switch (kind) {
              case "recorded":
                return Array.from({ length: 2 + next(3) }, () =>
                  recordedPen(10 + next(100), 200 + next(150), gap()),
                );
              case "left":
                return [
                  recordedPen(-400, 200, gap()),
                  strip(-600, 25 + next(100)),
                ];
              case "right":
                return [
                  recordedPen(100 + next(100), 900, gap()),
                  strip(240 + next(200), 1100),
                ];
              case "both":
              case "sparse":
                return [
                  kind === "both" ? recordedPen(-400, 900, gap()) : sparsePen(),
                  strip(-600, 25 + next(100)),
                  strip(240 + next(200), 1100),
                ];
              default:
                return [
                  ...Array.from({ length: 2 + next(4) }, stroke),
                  ...(kind === "eraser" ? [eraser()] : []),
                  ...(kind === "far eraser" ? [eraser(-240_000)] : []),
                ];
            }
          };
          const pixelsOf = async (bytes: Uint8Array) => {
            const bitmap = await canvas.decodePng(bytes);
            const pixels = canvas.readPixels(bitmap);
            bitmap.close();
            return pixels;
          };
          const documents: InkRecord["strokes"][] =
            drawings === 0
              ? [
                  [
                    {
                      tool: "pen",
                      size: 192,
                      points: [1014, 2044, 214, 2364, 490, 2068],
                    },
                  ],
                ]
              : Array.from({ length: drawings }, drawing);
          let saves = 0;
          let worst = 0;
          let moved = 0;
          let unchanged = 0;
          for (const strokes of documents) {
            const first = await canvas.saveInk({ strokes }, undefined);
            const opened = await canvas.openInk(first.bytes);
            if (opened.kind !== "editable") throw new Error(opened.kind);
            const before = await pixelsOf(first.bytes);
            const again = await canvas.saveInk(opened.document, undefined);
            if (
              again.bytes.length === first.bytes.length &&
              again.bytes.every((byte, at) => byte === first.bytes[at])
            ) {
              unchanged++;
            }
            for (const away of [1, 8, 40]) {
              const mark: InkRecord["strokes"][number] = {
                tool: "pen",
                size: 32,
                points: [
                  (side === "left" ? -away : before.width + away) * 16,
                  64,
                ],
              };
              const edited = await canvas.saveInk(
                { strokes: [...opened.document.strokes, mark] },
                undefined,
              );
              const after = await pixelsOf(edited.bytes);
              saves++;
              if (edited.left !== 0 || edited.width !== first.width) moved++;
              // The mark is at the top, beside what the first image shows.
              for (let y = 0; y < 192; y++) {
                for (let x = 0; x < before.width; x++) {
                  const was = before.data[(y * before.width + x) * 4 + 3] ?? 0;
                  // An image can end before this column: nothing is there.
                  const column = x - edited.left;
                  const at = (y * after.width + column) * 4 + 3;
                  const now =
                    column >= 0 && column < after.width
                      ? (after.data[at] ?? 0)
                      : 0;
                  worst = Math.max(worst, Math.abs(was - now));
                }
              }
            }
          }
          return {
            saves,
            moved,
            worst,
            unchanged,
            documents: documents.length,
          };
        },
        drawings,
        kind,
        side,
      );
      expect(result.moved).toBe(result.saves);
      expect(result.unchanged).toBe(result.documents);
      expect(result.worst).toBeLessThanOrEqual(levels);
    });
  }

  it("saves a drawing past the widest canvas it draws on", async function () {
    const result = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      // An eraser half a million pixels away, which no canvas could hold.
      const strokes: InkRecord["strokes"] = [
        { tool: "pen", size: 96, points: [1600, 1600, 3200, 1760] },
        { tool: "eraser", size: 96, points: [-8_388_608, 1600] },
      ];
      const first = await canvas.saveInk({ strokes }, undefined);
      const opened = await canvas.openInk(first.bytes);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const again = await canvas.saveInk(opened.document, undefined);
      return {
        width: first.width,
        same:
          again.bytes.length === first.bytes.length &&
          again.bytes.every((byte, at) => byte === first.bytes[at]),
      };
    });
    expect(result.width).toBeGreaterThan(100);
    expect(result.width).toBeLessThan(130);
    expect(result.same).toBe(true);
  });

  it("refuses a save that its reader would refuse", async function () {
    const message = await browser.execute(async () => {
      const { canvas, inkFile, png } = window.inklineTest;
      const text = {
        type: "tEXt",
        data: new TextEncoder().encode("Comment\0"),
      };
      // A picture at the limit, which adding the record takes over it.
      const chunks = png.readChunks(
        await canvas.encodePixels(new ImageData(48, 192)),
      );
      const [header, ...rest] = chunks;
      if (header === undefined) throw new Error("no header");
      const picture = png.writeChunks([
        header,
        ...new Array<typeof text>(png.maxChunks - chunks.length).fill(text),
        ...rest,
      ]);
      const opened = await canvas.openInk(picture);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      try {
        await canvas.saveInk(opened.document, opened.base, opened.carried);
        return "saved";
      } catch (error) {
        return error instanceof inkFile.RecordError
          ? error.message
          : String(error);
      }
    });
    expect(message).toContain("more than 65536 chunks");
  });

  it("crops a stroke that repeats a point until its steps vanish", async function () {
    const widths = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      const stroke = (repeats: number): InkRecord["strokes"][number] => ({
        tool: "pen",
        size: 96,
        points: [
          128,
          1600,
          16048,
          1760,
          ...new Array<number[]>(repeats).fill([16048, 1600]).flat(),
        ],
      });
      const widthOf = async (repeats: number): Promise<number> =>
        (await canvas.saveInk({ strokes: [stroke(repeats)] }, undefined)).width;
      // Past about 440 repeats a step squares to 0, between points that differ.
      return [await widthOf(300), await widthOf(600)];
    });
    // The whole stroke, not what is left of a crop that found no ink: a vanishing
    // step's direction is a little long, which rounds the end out by a pixel.
    expect(widths[0]).toBeGreaterThan(1000);
    expect(Math.abs((widths[1] ?? 0) - (widths[0] ?? 0))).toBeLessThanOrEqual(
      1,
    );
  });

  describe("a base layer's image data", function () {
    const side = 8;
    const rowBytes = 1 + 4 * side;
    const rows = (count: number): Uint8Array =>
      new Uint8Array(count * rowBytes)
        .fill(255)
        .map((value, at) => (at % rowBytes === 0 ? 0 : value));
    const whole = deflateSync(rows(side));
    const wrongChecksum = Uint8Array.from(whole);
    wrongChecksum[wrongChecksum.length - 1] =
      (wrongChecksum.at(-1) ?? 0) ^ 0xff;
    const undefinedFilter = rows(side);
    undefinedFilter[3 * rowBytes] = 9;

    /** A symbol whose record's base layer has `data` for its image data. */
    function symbolWith(data: Uint8Array): string {
      const png = writeChunks([
        header(side, side),
        { type: "IDAT", data },
        { type: "IEND", data: new Uint8Array(0) },
      ]);
      const text = serializeRecord({
        strokes: [],
        base: { x: 0, y: 0, width: 128, height: 128, png },
      });
      const compressed = deflateSync(text);
      const chunk = new Uint8Array(4 + compressed.length);
      chunk[3] = 1;
      chunk.set(compressed, 4);
      const [start, ...rest] = encodeImage();
      if (start === undefined) throw new Error("no chunks");
      return toBase64(
        writeChunks([start, { type: recordChunkType, data: chunk }, ...rest]),
      );
    }

    const opensIn = async (symbol: string): Promise<string> =>
      browser.execute(async (text) => {
        const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
        return (await window.inklineTest.canvas.openInk(bytes)).kind;
      }, symbol);

    it("opens one stream of exactly the image's rows", async function () {
      expect(await opensIn(symbolWith(whole))).toBe("editable");
    });

    // Each of these the browser's own decoder can pass, or passes on one
    // Chromium and not on another: Chromium 120 draws missing rows as empty.
    const broken: [string, Uint8Array][] = [
      ["half its rows", deflateSync(rows(4))],
      ["its last row missing", deflateSync(rows(7))],
      ["rows left over", deflateSync(rows(12))],
      ["a wrong Adler-32", wrongChecksum],
      ["bytes after the stream", Uint8Array.from([...whole, 0, 0])],
      ["an undefined filter", deflateSync(undefinedFilter)],
      ["data that is not zlib", new Uint8Array(40).fill(7)],
      ["a stream cut off", whole.subarray(0, -6)],
    ];
    for (const [name, data] of broken) {
      it(`refuses a record whose base layer has ${name}`, async function () {
        expect(await opensIn(symbolWith(data))).toBe("damaged");
      });
    }
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
