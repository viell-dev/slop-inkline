import { browser, expect } from "@wdio/globals";
import { brushSizes } from "../../../src/editor/session.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  startOver,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** Stems of a font's regular and bold weights, in pixels at 128 px an em. */
interface Stems {
  readonly family: string;
  readonly regular: number;
  readonly bold: number;
}

/**
 * The stems of the editor's text font and of two others the host has, each
 * the median of the vertical stems of l, I, H and n at 128 px, as the coverage
 * across a row through them.
 */
async function fontStems(): Promise<Stems[]> {
  return browser.execute(() => {
    const line = activeDocument.querySelector(".inkline-preview");
    if (!(line instanceof HTMLElement)) throw new Error("no preview line");
    const em = 128;
    const canvas = new OffscreenCanvas(em * 2, em * 2);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no context");
    const stem = (family: string, weight: string) => {
      const widths = [];
      for (const [glyph, along] of [
        ["l", 0.5],
        ["I", 0.5],
        ["H", 0.3],
        ["n", 0.6],
      ] as const) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.font = `${weight} ${String(em)}px ${family}`;
        const metrics = context.measureText(glyph);
        const baseline = em * 1.5;
        context.fillText(glyph, em / 2, baseline);
        const top = baseline - metrics.actualBoundingBoxAscent;
        const y = Math.round(top + metrics.actualBoundingBoxAscent * along);
        const row = context.getImageData(0, y, canvas.width, 1).data;
        let covered = 0;
        let stems = 0;
        let inside = false;
        for (let x = 0; x < canvas.width; x++) {
          const alpha = row[x * 4 + 3] ?? 0;
          covered += alpha / 255;
          if (alpha > 127 && !inside) stems++;
          inside = alpha > 127;
        }
        widths.push(covered / Math.max(1, stems));
      }
      widths.sort((a, b) => a - b);
      return ((widths[1] ?? 0) + (widths[2] ?? 0)) / 2;
    };
    return [getComputedStyle(line).fontFamily, "DejaVu Sans", "Noto Serif"].map(
      (family) => ({
        family,
        regular: stem(family, "400"),
        bold: stem(family, "700"),
      }),
    );
  });
}

/**
 * The runs of ink across row `y`, or down column `x`, of the saved symbol
 * `001.ink.png`: where each starts, and its coverage, in pixels.
 */
async function savedRuns(
  line: { y: number } | { x: number } | "middle row",
): Promise<{ start: number; width: number }[]> {
  return browser.executeObsidian(async ({ app }, at) => {
    const file = app.vault.getFileByPath("001.ink.png");
    if (file === null) throw new Error("no saved ink");
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    const { canvas } = window.inklineTest;
    const bitmap = await canvas.decodePng(bytes);
    const pixels = canvas.readPixels(bitmap);
    bitmap.close();
    const across = at === "middle row" || "y" in at;
    const fixed =
      at === "middle row"
        ? Math.floor(pixels.height / 2)
        : "y" in at
          ? at.y
          : at.x;
    const length = across ? pixels.width : pixels.height;
    const runs = [];
    let run: { start: number; width: number } | undefined;
    for (let along = 0; along < length; along++) {
      const index = across
        ? fixed * pixels.width + along
        : along * pixels.width + fixed;
      const alpha = pixels.data[index * 4 + 3] ?? 0;
      if (alpha === 0) {
        run = undefined;
        continue;
      }
      if (run === undefined) {
        run = { start: along, width: 0 };
        runs.push(run);
      }
      run.width += alpha / 255;
    }
    return runs;
  }, line);
}

/** Saves the symbol being drawn and waits for the editor to close. */
async function save(): Promise<void> {
  await browser.keys(["Control", "Enter"]);
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

describe("Brush sizes beside text", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
  });

  it("draws M as regular text, L as bold, S finer and XL heavier", async function () {
    const fonts = await fontStems();
    // One upright stroke a size, with the mouse, so with no pressure.
    for (const [index] of brushSizes.entries()) {
      await browser.keys(String(index + 1));
      const x = 0.2 + index * 0.15;
      await draw([
        [x, 0.3],
        [x, 0.5],
        [x, 0.7],
      ]);
    }
    await saveScreenshot("pen-weights");
    await save();
    const runs = await savedRuns("middle row");
    const widths = runs.map((run) => run.width);
    console.log("Brush widths", JSON.stringify({ widths, fonts }));
    expect(widths).toHaveLength(brushSizes.length);
    // A stroke without pressure is as wide as its size, in document pixels.
    brushSizes.forEach((size, index) => {
      expect(Math.abs((widths[index] ?? 0) - size.em * 128)).toBeLessThan(0.5);
    });
    const [s = 0, m = 0, l = 0, xl = 0] = widths;
    for (const { regular, bold } of fonts) {
      expect(s).toBeLessThanOrEqual(regular * 0.6);
      expect(Math.abs(m - regular)).toBeLessThanOrEqual(regular * 0.15);
      expect(l).toBeGreaterThanOrEqual(regular * 1.3);
      expect(l).toBeLessThanOrEqual(bold * 1.1);
      expect(xl).toBeGreaterThanOrEqual(bold * 0.95);
    }
  });

  it("keeps strokes of M a grid spacing apart distinct, for dense symbols", async function () {
    await browser.keys("2");
    // Five level strokes, 16 document pixels apart in a line box 192 tall.
    for (let line = 0; line < 5; line++) {
      const y = (48 + line * 16) / 192;
      await draw([
        [0.3, y],
        [0.5, y],
        [0.7, y],
      ]);
    }
    await save();
    const width = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no saved ink");
      const bitmap = await window.inklineTest.canvas.decodePng(
        new Uint8Array(await app.vault.readBinary(file)),
      );
      const { width } = bitmap;
      bitmap.close();
      return width;
    });
    const runs = await savedRuns({ x: Math.floor(width / 2) });
    console.log("Dense strokes", JSON.stringify(runs));
    expect(runs).toHaveLength(5);
  });

  it("draws M with pen pressure about as wide as its size at half pressure", async function () {
    const size = (brushSizes[1]?.em ?? 0) * 128;
    const widths = await browser.execute((units: number) => {
      const { record, render } = window.inklineTest;
      const canvas = new OffscreenCanvas(400, 200);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no context");
      const pressures = [0.25, 0.5, 1];
      // Upright strokes at x 100, 200 and 300, at one pressure each.
      render.drawInk(
        context,
        pressures.map((pressure, index) => {
          const x = (index + 1) * 100 * record.unitsPerPixel;
          const p = Math.round(pressure * record.maxPressure);
          return {
            tool: "pen" as const,
            size: units,
            pressure: true,
            points: [x, 40 * 16, p, x, 100 * 16, p, x, 160 * 16, p],
          };
        }),
        undefined,
      );
      const row = context.getImageData(0, 100, 400, 1).data;
      return pressures.map((_, index) => {
        let covered = 0;
        for (let x = index * 100 + 50; x < index * 100 + 150; x++) {
          covered += (row[x * 4 + 3] ?? 0) / 255;
        }
        return covered;
      });
    }, size * 16);
    console.log("Pressure widths", JSON.stringify({ size, widths }));
    const [light = 0, half = 0, full = 0] = widths;
    expect(Math.abs(half - size)).toBeLessThan(0.75);
    expect(light).toBeLessThan(half);
    expect(full).toBeGreaterThan(half);
    expect(full).toBeLessThanOrEqual(size * 1.5 + 0.75);
  });
});
