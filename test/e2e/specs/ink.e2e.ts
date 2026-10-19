import { readFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { loadModules, toBase64 } from "../support/browser.ts";

const legacy = path.resolve(import.meta.dirname, "../../fixtures/legacy");

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
              pressure: false,
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
        box: saved.record.box,
        points: saved.record.strokes[0]?.points,
        startX: x0 / 16,
        size: [pixels.width, pixels.height],
        middle: at(middleX, 100),
        above: at(middleX, 80),
        grey: render.inkGrey,
        opened:
          opened.kind === "editable"
            ? { from: opened.from, strokes: opened.document.strokes }
            : opened,
        sideBearing: geometry.sideBearing,
      };
    });
    expect(result.box.height).toBe(192);
    expect(result.box.baseline).toBe(144);
    expect(result.size).toEqual([result.box.width, 192]);
    // The ink runs from 15 to 65 px, the line plus its round caps, and the
    // crop adds a side bearing on each side: the line starts 5 px plus the
    // bearing from the left, rounded to whole pixels.
    expect(result.box.width).toBeGreaterThanOrEqual(
      50 + 2 * result.sideBearing,
    );
    expect(result.box.width).toBeLessThanOrEqual(52 + 2 * result.sideBearing);
    expect(result.startX).toBeCloseTo(5 + result.sideBearing, 0);
    expect(result.middle).toEqual([result.grey, result.grey, result.grey, 255]);
    expect(result.above[3]).toBe(0);
    expect(result.opened).toEqual({
      from: "record",
      strokes: [
        { tool: "pen", size: 160, pressure: false, points: result.points },
      ],
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
              pressure: false,
              points: [320, 1600, 1600, 1600],
            },
            {
              tool: "eraser",
              size: 160,
              pressure: false,
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
              pressure: true,
              points: [
                400, 2000, 40, 800, 1200, 160, 1400, 600, 255, 2000, 400, 90,
              ],
            },
            { tool: "eraser", size: 64, pressure: false, points: [800, 1100] },
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
    ["prototype-192.ink.png", 192],
    ["prototype-288.ink.png", 288],
  ] as const) {
    it(`opens the prototype's ${name} as a base layer of its own pixels`, async function () {
      const bytes = await readFile(path.join(legacy, name));
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
          from: opened.from,
          scale: opened.document.base.scale,
          x: opened.document.base.x,
          size: [base.width, base.height],
          originalSize: [original.width, original.height],
          mismatches,
          savedWidth: saved.record.box.width,
          savedBase: saved.record.base !== undefined,
        };
      }, toBase64(bytes));
      expect(result.from).toBe("none");
      expect(result.scale).toBe(192 / height);
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
      const chunk = await png.encodeInternationalText({
        keyword: "inkline",
        text: '{"format":"inkline","version":2}',
      });
      const [header, ...rest] = png.readChunks(image);
      if (header === undefined) throw new Error("no header");
      const file = png.writeChunks([header, chunk, ...rest]);
      const opened = await canvas.openInk(file);
      const refused = await inkFile
        .writeInkFile(file, {
          box: { pxPerEm: 128, width: 48, height: 192, baseline: 144 },
          strokes: [],
        })
        .then(
          () => "written",
          (error: unknown) => String(error),
        );
      return { kind: opened.kind, refused };
    });
    expect(result.kind).toBe("newer-version");
    expect(result.refused).toContain("a record from a later version");
  });

  it("opens the pixels when a record's base layer does not decode", async function () {
    const from = await browser.execute(async () => {
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
        box: { pxPerEm: 128, width: 48, height: 192, baseline: 144 },
        strokes: [],
        base: { x: 0, y: 0, scale: 1, png: broken },
      });
      const opened = await canvas.openInk(file);
      return opened.kind === "editable" ? opened.from : opened.kind;
    });
    expect(from).toBe("undecodable-base");
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
});
