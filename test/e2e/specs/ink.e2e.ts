import { readFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { decodeRgba } from "../../support/png.ts";
import { loadModules, toBase64 } from "../support/browser.ts";

const pictures = path.resolve(import.meta.dirname, "../../fixtures/pictures");

/** WCAG contrast between two sRGB colours. */
function contrast(a: readonly number[], b: readonly number[]): number {
  const luminance = (rgb: readonly number[]): number => {
    const [r = 0, g = 0, bl = 0] = rgb.map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe("The drawing core in Obsidian's renderer", function () {
  before(async function () {
    await loadModules();
  });

  it("saves a drawing cropped to its ink, in grey with the ink as alpha", async function () {
    const result = await browser.execute(async () => {
      const { canvas, geometry, render } = window.inklineTest;
      // A 10 px wide horizontal line from x = 20 to x = 60 on y = 100.
      const saved = await canvas.saveInk(
        {
          strokes: [
            {
              tool: "pen",
              size: 160,
              points: [320, 1600, 960, 1600],
            },
          ],
        },
        undefined,
      );
      const opened = await canvas.openInk(saved.bytes);
      const bitmap = await canvas.decodePng(saved.bytes);
      const pixels = canvas.readPixels(bitmap);
      const at = (x: number, y: number): number[] => [
        ...pixels.data.subarray(
          (y * pixels.width + x) * 4,
          (y * pixels.width + x) * 4 + 4,
        ),
      ];
      // The line's middle, where the saved record puts it in the image.
      const [x0 = 0, , x1 = 0] = saved.record.strokes[0]?.points ?? [];
      const middleX = Math.round((x0 + x1) / 2 / 16);
      return {
        width: saved.width,
        points: saved.record.strokes[0]?.points,
        startX: x0 / 16,
        size: [pixels.width, pixels.height],
        middle: at(middleX, 100),
        above: at(middleX, 80),
        grey: render.inkGrey,
        opened:
          opened.kind === "editable"
            ? { strokes: opened.document.strokes }
            : opened,
        sideBearing: geometry.sideBearing,
      };
    });
    expect(result.size).toEqual([result.width, 192]);
    // The ink runs from 15 to 65 px, the line plus its round caps, and the
    // crop adds a side bearing on each side: the line starts 5 px plus the
    // bearing from the left, rounded to whole pixels.
    expect(result.width).toBeGreaterThanOrEqual(50 + 2 * result.sideBearing);
    expect(result.width).toBeLessThanOrEqual(52 + 2 * result.sideBearing);
    expect(result.startX).toBeCloseTo(5 + result.sideBearing, 0);
    expect(result.middle).toEqual([result.grey, result.grey, result.grey, 255]);
    expect(result.above[3]).toBe(0);
    expect(result.opened).toEqual({
      strokes: [{ tool: "pen", size: 160, points: result.points }],
    });
  });

  it("cuts ink with an eraser", async function () {
    const alpha = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      const saved = await canvas.saveInk(
        {
          strokes: [
            {
              tool: "pen",
              size: 160,
              points: [320, 1600, 1600, 1600],
            },
            {
              tool: "eraser",
              size: 160,
              points: [960, 1200, 960, 2000],
            },
          ],
        },
        undefined,
      );
      const pixels = canvas.readPixels(await canvas.decodePng(saved.bytes));
      // Where the saved record puts the eraser in the image.
      const x = (saved.record.strokes[1]?.points[0] ?? 0) / 16;
      const at = (column: number): number =>
        pixels.data[(100 * pixels.width + Math.round(column)) * 4 + 3] ?? -1;
      return { crossing: at(x), beside: at(x - 25) };
    });
    expect(alpha.crossing).toBe(0);
    expect(alpha.beside).toBe(255);
  });

  it("saves the same file again after reopening, losing nothing", async function () {
    const result = await browser.execute(async () => {
      const { canvas, record } = window.inklineTest;
      const first = await canvas.saveInk(
        {
          strokes: [
            {
              tool: "pen",
              size: 192,
              points: [400, 2000, 800, 1200, 1400, 600, 2000, 400],
            },
            { tool: "eraser", size: 64, points: [800, 1100] },
          ],
        },
        undefined,
      );
      const opened = await canvas.openInk(first.bytes);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const second = await canvas.saveInk(opened.document, opened.base);
      const pixels = async (bytes: Uint8Array): Promise<string> =>
        canvas.readPixels(await canvas.decodePng(bytes)).data.join(",");
      return {
        sameRecord:
          record.serializeRecord(first.record) ===
          record.serializeRecord(second.record),
        samePixels:
          (await pixels(first.bytes)) === (await pixels(second.bytes)),
      };
    });
    expect(result).toEqual({ sameRecord: true, samePixels: true });
  });

  for (const [name, height] of [
    ["opaque-192.ink.png", 192],
    ["opaque-288.ink.png", 288],
  ] as const) {
    it(`opens ${name}, an opaque picture, as a base layer of its own pixels`, async function () {
      const bytes = await readFile(path.join(pictures, name));
      const result = await browser.execute(async (base64: string) => {
        const { canvas } = window.inklineTest;
        const data = Uint8Array.from(atob(base64), (char) =>
          char.charCodeAt(0),
        );
        const opened = await canvas.openInk(data);
        if (opened.kind !== "editable" || opened.document.base === undefined) {
          throw new Error("no base layer");
        }
        const original = canvas.readPixels(await canvas.decodePng(data));
        const base = canvas.readPixels(
          await canvas.decodePng(opened.document.base.png),
        );
        let mismatches = 0;
        for (let index = 0; index < original.width * original.height; index++) {
          const ink = 255 - (original.data[index * 4] ?? 0);
          if ((base.data[index * 4 + 3] ?? -1) !== ink) mismatches++;
        }
        const saved = await canvas.saveInk(opened.document, opened.base);
        return {
          drawn: [opened.document.base.width, opened.document.base.height],
          x: opened.document.base.x,
          size: [base.width, base.height],
          originalSize: [original.width, original.height],
          mismatches,
          savedWidth: saved.width,
          savedBase: saved.record.base !== undefined,
        };
      }, toBase64(bytes));
      // As tall as the line box, in proportion, in units.
      const [wide = 0] = result.originalSize;
      expect(result.drawn).toEqual([
        Math.round(((wide * 192) / height) * 16),
        192 * 16,
      ]);
      expect(result.x).toBe(0);
      expect(result.size).toEqual(result.originalSize);
      expect(result.mismatches).toBe(0);
      expect(result.savedBase).toBe(true);
      // The line spans 55 of the drawing's 192 px across, plus its caps.
      expect(result.savedWidth).toBeGreaterThan(60);
      expect(result.savedWidth).toBeLessThan(90);
    });
  }

  it("keeps the alpha of a transparent picture", async function () {
    const result = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      const data = new Uint8ClampedArray(4 * 4 * 4);
      for (let index = 0; index < 16; index++) {
        data.set([200, 30, 30, index * 16], index * 4);
      }
      const bytes = await canvas.encodePixels({ width: 4, height: 4, data });
      const opened = await canvas.openInk(bytes);
      if (opened.kind !== "editable" || opened.document.base === undefined) {
        throw new Error("no base layer");
      }
      const base = canvas.readPixels(
        await canvas.decodePng(opened.document.base.png),
      );
      return [...base.data].filter((_, index) => index % 4 === 3);
    });
    expect(result).toEqual(
      Array.from({ length: 16 }, (_, index) => index * 16),
    );
  });

  it("does not open a record from a later version", async function () {
    const result = await browser.execute(async () => {
      const { canvas, inkFile, png } = window.inklineTest;
      const image = await canvas.encodePixels({
        width: 48,
        height: 192,
        data: new Uint8ClampedArray(48 * 192 * 4),
      });
      const chunk = {
        type: inkFile.recordChunkType,
        data: Uint8Array.of(0, 0, 0, 2),
      };
      const [header, ...rest] = png.readChunks(image);
      if (header === undefined) throw new Error("no header");
      const file = png.writeChunks([header, chunk, ...rest]);
      const opened = await canvas.openInk(file);
      const refused = await inkFile.writeInkFile(file, { strokes: [] }).then(
        () => "written",
        (error: unknown) => String(error),
      );
      return { kind: opened.kind, refused };
    });
    expect(result.kind).toBe("newer-version");
    expect(result.refused).toContain("version 2 is newer than 1");
  });

  it("does not open a record whose base layer does not decode", async function () {
    const kind = await browser.execute(async () => {
      const { canvas, inkFile, png } = window.inklineTest;
      const image = await canvas.encodePixels({
        width: 48,
        height: 192,
        data: new Uint8ClampedArray(48 * 192 * 4),
      });
      // Well-formed chunks whose image data is not zlib data.
      const chunks = png.readChunks(
        await canvas.encodePixels({
          width: 1,
          height: 1,
          data: new Uint8ClampedArray(4),
        }),
      );
      const header = chunks.find((chunk) => chunk.type === "IHDR");
      const end = chunks.find((chunk) => chunk.type === "IEND");
      if (header === undefined || end === undefined) {
        throw new Error("no chunks");
      }
      const broken = png.writeChunks([
        header,
        { type: "IDAT", data: new Uint8Array([1, 2, 3, 4]) },
        end,
      ]);
      const file = await inkFile.writeInkFile(image, {
        strokes: [],
        base: { x: 0, y: 0, width: 16, height: 16, png: broken },
      });
      return (await canvas.openInk(file)).kind;
    });
    expect(kind).toBe("damaged");
  });

  it("saves the same file again however far the drawing sits from the origin", async function () {
    const results = await browser.execute(async () => {
      const { canvas, record } = window.inklineTest;
      const outcomes: boolean[] = [];
      for (const shift of [0, 7680, 64000, 400000]) {
        const first = await canvas.saveInk(
          {
            strokes: [
              {
                tool: "pen",
                size: 187,
                points: [8937 + shift, 1245, 9675 + shift, 2250],
              },
            ],
          },
          undefined,
        );
        const opened = await canvas.openInk(first.bytes);
        if (opened.kind !== "editable") throw new Error(opened.kind);
        const second = await canvas.saveInk(opened.document, opened.base);
        const pixels = async (bytes: Uint8Array): Promise<string> =>
          canvas.readPixels(await canvas.decodePng(bytes)).data.join(",");
        outcomes.push(
          record.serializeRecord(first.record) ===
            record.serializeRecord(second.record) &&
            (await pixels(first.bytes)) === (await pixels(second.bytes)),
        );
      }
      return outcomes;
    });
    expect(results).toEqual([true, true, true, true]);
  });

  it("draws a base layer in grey whatever its own colours", async function () {
    const result = await browser.execute(async () => {
      const { canvas, inkFile, record } = window.inklineTest;
      const red = await canvas.encodePixels({
        width: 1,
        height: 1,
        data: Uint8ClampedArray.of(255, 0, 0, 255),
      });
      const image = await canvas.encodePixels({
        width: 48,
        height: 192,
        data: new Uint8ClampedArray(48 * 192 * 4),
      });
      // A 10 px red square at (10, 10), an eraser through its middle row, and
      // a pen dot after the eraser on its left edge.
      const file = await inkFile.writeInkFile(image, {
        strokes: [
          {
            tool: "eraser",
            size: 32,
            points: [160, 240, 320, 240],
          },
          { tool: "pen", size: 32, points: [176, 240] },
        ],
        base: { x: 160, y: 160, width: 160, height: 160, png: red },
      });
      const opened = await canvas.openInk(file);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const saved = await canvas.saveInk(opened.document, opened.base);
      return {
        file: record.toBase64(saved.bytes),
        baseX: (saved.record.base?.x ?? 0) / 16,
      };
    });
    // The bytes stored, as a canvas's premultiplied alpha would round a
    // partly covered pixel's grey by a level.
    const pixels = decodeRgba(
      new Uint8Array(Buffer.from(result.file, "base64")),
    );
    const at = (x: number, y: number): number[] => [
      ...pixels.data.subarray(
        (y * pixels.width + x) * 4,
        (y * pixels.width + x) * 4 + 4,
      ),
    ];
    expect(at(result.baseX + 5, 12)).toEqual([126, 126, 126, 255]);
    expect(at(result.baseX + 7, 15)[3]).toBe(0);
    // A dot 2 px wide on the corner of this pixel covers a quarter of its
    // circle, π / 4 of the pixel, where the eraser left nothing.
    const dot = at(result.baseX + 1, 15);
    expect(dot.slice(0, 3)).toEqual([126, 126, 126]);
    expect(dot[3]).toBeGreaterThan(180);
  });

  it("opens and saves pictures only one or two pixels high", async function () {
    const results = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      const outcomes: { drawn: number[]; size: number[]; width: number }[] = [];
      for (const height of [1, 2]) {
        const picture = await canvas.encodePixels({
          width: 1,
          height,
          data: new Uint8ClampedArray(4 * height)
            .fill(0)
            .map((_, index) => (index % 4 === 3 ? 255 : 0)),
        });
        const opened = await canvas.openInk(picture);
        if (opened.kind !== "editable" || opened.document.base === undefined) {
          throw new Error("no base layer");
        }
        const saved = await canvas.saveInk(opened.document, opened.base);
        const base = await canvas.decodePng(opened.document.base.png);
        outcomes.push({
          drawn: [opened.document.base.width, opened.document.base.height],
          size: [base.width, base.height],
          width: saved.width,
        });
      }
      return outcomes;
    });
    expect(results).toEqual([
      // 1 × 1, stretched to fill 192 px, plus the side bearings.
      { drawn: [3072, 3072], size: [1, 1], width: 208 },
      { drawn: [1536, 3072], size: [1, 2], width: 112 },
    ]);
  });

  it("crops to the visible ink, ignoring geometry outside the line box or erased", async function () {
    const result = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      const offBox = await canvas.saveInk(
        {
          strokes: [
            {
              tool: "pen",
              size: 160,
              // 80 px long, with ink from -5 to 85 px.
              points: [0, 1600, 1280, 1600],
            },
            {
              tool: "pen",
              size: 160,
              points: [160000, 16000],
            },
          ],
        },
        undefined,
      );
      const erased = await canvas.saveInk(
        {
          strokes: [
            {
              tool: "pen",
              size: 160,
              points: [0, 1600, 160000, 1600],
            },
            {
              tool: "eraser",
              size: 640,
              points: [-800, 1600, 161000, 1600],
            },
          ],
        },
        undefined,
      );
      return {
        offBox: offBox.width,
        kept: offBox.record.strokes.length,
        erased: erased.width,
      };
    });
    // The visible line and its bearings, not the dot 10,000 px away below
    // the line box.
    expect(result.offBox).toBeGreaterThanOrEqual(104);
    expect(result.offBox).toBeLessThanOrEqual(108);
    expect(result.kept).toBe(2);
    expect(result.erased).toBe(48);
  });

  it("keeps a file's text chunks when it is saved again", async function () {
    const kept = await browser.execute(async () => {
      const { canvas, png } = window.inklineTest;
      const first = await canvas.saveInk(
        {
          strokes: [{ tool: "pen", size: 160, points: [320, 1600] }],
        },
        undefined,
      );
      const [header, ...rest] = png.readChunks(first.bytes);
      if (header === undefined) throw new Error("no header");
      const comment = {
        type: "tEXt",
        data: Uint8Array.from("Comment\0keep me", (char) => char.charCodeAt(0)),
      };
      const tagged = png.writeChunks([header, comment, ...rest]);
      const opened = await canvas.openInk(tagged);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const second = await canvas.saveInk(
        opened.document,
        opened.base,
        opened.carried,
      );
      return png
        .readChunks(second.bytes)
        .filter((chunk) => chunk.type === "tEXt")
        .map((chunk) => String.fromCharCode(...chunk.data));
    });
    expect(kept).toEqual(["Comment\0keep me"]);
  });

  it("reopens what it saved with its strokes, even far from the ink", async function () {
    const result = await browser.execute(async () => {
      const { canvas, record } = window.inklineTest;
      const first = await canvas.saveInk(
        {
          strokes: [
            { tool: "pen", size: 160, points: [1600, 1600] },
            {
              tool: "eraser",
              size: 16,
              points: [-4194304, 1600],
            },
          ],
        },
        undefined,
      );
      const opened = await canvas.openInk(first.bytes);
      if (opened.kind !== "editable") throw new Error(opened.kind);
      const second = await canvas.saveInk(opened.document, opened.base);
      const pixels = async (bytes: Uint8Array): Promise<string> =>
        canvas.readPixels(await canvas.decodePng(bytes)).data.join(",");
      return {
        strokes: opened.document.strokes.length,
        sameRecord:
          record.serializeRecord(first.record) ===
          record.serializeRecord(second.record),
        samePixels:
          (await pixels(first.bytes)) === (await pixels(second.bytes)),
      };
    });
    expect(result).toEqual({
      strokes: 2,
      sameRecord: true,
      samePixels: true,
    });
  });

  it("refuses to save a stroke that cropping would move past the coordinate limit", async function () {
    const message = await browser.execute(async () => {
      const { canvas, record } = window.inklineTest;
      return canvas
        .saveInk(
          {
            strokes: [
              { tool: "pen", size: 160, points: [1600, 1600] },
              {
                tool: "eraser",
                size: 16,
                points: [-record.limits.coordinate + 100, 1600],
              },
            ],
          },
          undefined,
        )
        .then(
          () => "saved",
          (error: unknown) => String(error),
        );
    });
    expect(message).toContain("past the format's coordinate limit");
  });

  it("keeps a cut stroke's ink where only the rest of it reaches", async function () {
    // Up and a short way back, with its end cut: what the rest of it draws in
    // the cut box lies outside the whole stroke's outline, and is all the ink
    // there is in the line box.
    const result = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      const stroke = {
        tool: "pen",
        size: 320,
        points: [16000, 5728, 16800, 2528, 16640, 3328],
        cut: { end: "up" },
      } as const;
      const saved = await canvas.saveInk({ strokes: [stroke] }, undefined);
      const pixels = canvas.readPixels(await canvas.decodePng(saved.bytes));
      const surface = new OffscreenCanvas(1200, 192);
      const context = surface.getContext("2d");
      if (context === null) throw new Error("no context");
      window.inklineTest.render.drawInk(context, [stroke], undefined);
      const count = (data: Uint8ClampedArray): number =>
        data.filter((value, index) => index % 4 === 3 && value > 0).length;
      return {
        drawn: count(context.getImageData(0, 0, 1200, 192).data),
        saved: count(pixels.data),
      };
    });
    expect(result.drawn).toBeGreaterThan(0);
    expect(result.saved).toBe(result.drawn);
  });

  it("saves a base layer where the document puts it, reusing its decoded pixels", async function () {
    const results = await browser.execute(async () => {
      const { canvas, document } = window.inklineTest;
      const picture = await canvas.encodePixels({
        width: 1,
        height: 1,
        data: Uint8ClampedArray.of(0, 0, 0, 255),
      });
      const opened = await canvas.openInk(picture);
      if (opened.kind !== "editable" || opened.document.base === undefined) {
        throw new Error("no base layer");
      }
      const { base } = opened.document;
      const variants = [
        document.moveDocument(opened.document, 300),
        document.moveDocument(opened.document, -300),
        {
          strokes: [],
          base: { ...base, width: base.width / 2, height: base.height / 2 },
        },
      ];
      const outcomes: { width: number; middle: number }[] = [];
      for (const variant of variants) {
        const saved = await canvas.saveInk(variant, opened.base);
        const pixels = canvas.readPixels(await canvas.decodePng(saved.bytes));
        const middle =
          (60 * pixels.width + Math.floor(pixels.width / 2)) * 4 + 3;
        outcomes.push({
          width: saved.width,
          middle: pixels.data[middle] ?? -1,
        });
      }
      return outcomes;
    });
    expect(results).toEqual([
      { width: 208, middle: 255 },
      { width: 208, middle: 255 },
      // Half the scale: 96 px of ink plus the bearings.
      { width: 112, middle: 255 },
    ]);
  });
  it("stores a grey legible on Obsidian's light and dark backgrounds", async function () {
    const backgrounds = await browser.execute(() => {
      const read = (dark: boolean): number[] => {
        document.body.classList.toggle("theme-dark", dark);
        document.body.classList.toggle("theme-light", !dark);
        const probe = new OffscreenCanvas(1, 1).getContext("2d");
        if (probe === null) throw new Error("no 2D context");
        probe.fillStyle = getComputedStyle(document.body)
          .getPropertyValue("--background-primary")
          .trim();
        probe.fillRect(0, 0, 1, 1);
        return [...probe.getImageData(0, 0, 1, 1).data.subarray(0, 3)];
      };
      const wasDark = document.body.classList.contains("theme-dark");
      const colours = { light: read(false), dark: read(true) };
      read(wasDark);
      return { ...colours, grey: window.inklineTest.render.inkGrey };
    });
    const grey = [backgrounds.grey, backgrounds.grey, backgrounds.grey];
    expect(contrast(grey, backgrounds.light)).toBeGreaterThanOrEqual(4);
    expect(contrast(grey, backgrounds.dark)).toBeGreaterThanOrEqual(4);
  });

  it("encodes pixels that the browser decodes back exactly", async function () {
    const result = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      const width = 31;
      const height = 9;
      const data = new Uint8ClampedArray(width * height * 4);
      let seed = 11;
      for (let index = 0; index < data.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[index] = seed >>> 24;
      }
      // Fully opaque, so that the browser's decoder gives the colours back
      // exactly, without premultiplied alpha rounding them.
      for (let index = 3; index < data.length; index += 4) data[index] = 255;
      const bytes = await canvas.encodePixels({ width, height, data });
      const image = await canvas.decodePng(bytes);
      const pixels = canvas.readPixels(image);
      image.close();
      return pixels.data.every((value, index) => value === data[index]);
    });
    expect(result).toBe(true);
  });

  it("previews the ink of a 4K screenshot quickly", async function () {
    const ms = await browser.execute(() => {
      const { canvas, pixels } = window.inklineTest;
      // A 3840 × 2160 luminance with a dark band, as a screenshot might be.
      const width = 3840;
      const height = 2160;
      const values = new Uint8ClampedArray(width * height).fill(230);
      values.fill(20, width * 900, width * 1200);
      const picture = pixels.shrinkLuminance(
        { width, height, values },
        pixels.previewFactor(width, height),
      );
      const place = {
        x: 0,
        y: 0,
        scale: 0.05 * pixels.previewFactor(width, height),
      };
      const part = pixels.regionValues(picture, place, {
        left: -1e6,
        top: -1e6,
        right: 1e6,
        bottom: 1e6,
      });
      if (part === undefined) throw new Error("no part");
      const started = performance.now();
      for (let threshold = 100; threshold < 110; threshold++) {
        const ink = pixels.traceRegion(part, place, threshold, false);
        if (ink === undefined) throw new Error("no ink");
        canvas.previewInk(ink, place.scale);
      }
      return (performance.now() - started) / 10;
    });
    // Per step: a few frames at most, where tracing the whole picture took
    // a second, with room for a slow machine.
    expect(ms).toBeLessThan(300);
  });

  it("makes a base layer and a preview of a traced picture's ink", async function () {
    const result = await browser.execute(async () => {
      const { canvas, geometry, pixels, render } = window.inklineTest;
      // A 20 px square in the middle of a 40 px picture, dark on light or
      // light on dark.
      const picture = async (ink: string, ground: string) => {
        const surface = new OffscreenCanvas(40, 40);
        const context = surface.getContext("2d");
        if (context === null) throw new Error("no 2D context");
        context.fillStyle = ground;
        context.fillRect(0, 0, 40, 40);
        context.fillStyle = ink;
        context.fillRect(10, 10, 20, 20);
        const bitmap = await createImageBitmap(surface);
        const read = canvas.readPixels(bitmap);
        bitmap.close();
        return read;
      };
      const lineBox = {
        left: -1e6,
        top: 0,
        right: 1e6,
        bottom: geometry.lineBox.height,
      };
      const traced = async (
        read: Awaited<ReturnType<typeof picture>>,
        place: { x: number; y: number; scale: number },
        light: boolean,
      ) => {
        const ink = pixels.traceInk(
          {
            width: read.width,
            height: read.height,
            values: pixels.luminance(read),
          },
          place,
          128,
          light,
          lineBox,
        );
        if (ink === undefined) return undefined;
        const preview = canvas.previewInk(ink, place.scale);
        const { layer } = await canvas.baseFromInk(ink, place.scale);
        const bitmap = await canvas.decodePng(layer.png);
        const { width, height, data } = canvas.readPixels(bitmap);
        bitmap.close();
        let full = 0;
        let grey = true;
        for (let at = 0; at < data.length; at += 4) {
          if (data[at + 3] === 255) full++;
          if (data[at] !== render.inkGrey) grey = false;
        }
        return {
          layer: {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
          },
          preview: {
            x: preview.x,
            y: preview.y,
            width: preview.width,
            height: preview.height,
          },
          width,
          height,
          full,
          grey,
        };
      };
      return {
        dark: await traced(
          await picture("black", "white"),
          { x: 100, y: 50, scale: 2 },
          false,
        ),
        light: await traced(
          await picture("white", "black"),
          { x: 100, y: 50, scale: 2 },
          true,
        ),
        // Its top 15 picture rows lie above the line box.
        cut: await traced(
          await picture("black", "white"),
          { x: 0, y: -30, scale: 2 },
          false,
        ),
      };
    });
    // At (100 + 10 × 2, 50 + 10 × 2) pixels, in units of 1/16 pixel.
    const square = {
      layer: { x: 1920, y: 1120, width: 640, height: 640 },
      preview: { x: 1920, y: 1120, width: 640, height: 640 },
      width: 20,
      height: 20,
      full: 400,
      grey: true,
    };
    expect(result.dark).toEqual(square);
    expect(result.light).toEqual(square);
    expect(result.cut).toEqual({
      layer: { x: 320, y: 0, width: 640, height: 480 },
      preview: { x: 320, y: 0, width: 640, height: 480 },
      width: 20,
      height: 15,
      full: 300,
      grey: true,
    });
  });
});
