// A drawing that keeps growing: the editor adds a stroke to what it has drawn
// and measured rather than doing it all again, which must never show anything
// but what doing it all again would.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";

/**
 * Each run's seed, how far across it draws, its screen's device pixels to a CSS
 * pixel, and how many strokes it starts with across the edge between two
 * tiles: a symbol, a long drawing, and one wider than the preview shows at
 * once, than the widest tile measured, and than a symbol can be, and then a
 * dot and a tile's width away from it, strokes across that edge.
 */
const runs = [
  { seed: 115, reach: 500, ratio: 1, straddles: 0 },
  { seed: 116, reach: 500, ratio: 2, straddles: 0 },
  { seed: 117, reach: 3000, ratio: 1, straddles: 0 },
  { seed: 118, reach: 3000, ratio: 1.5, straddles: 0 },
  { seed: 119, reach: 5000, ratio: 1, straddles: 0 },
  { seed: 120, reach: 5000, ratio: 2, straddles: 0 },
  { seed: 121, reach: 500, ratio: 1, straddles: 60 },
  { seed: 122, reach: 500, ratio: 2, straddles: 60 },
] as const;

const steps = 80;

/** How many dots, and how far across, for the budget. */
const count = 3000;
const span = 3000;

/**
 * The most the fastest of nine may take, for each kind of change, in ms. In
 * Docker on Windows 11, beside other jobs, it was at most 9 ms in Obsidian
 * 1.15.0 and 1.13.4. Doing it all again took about 300 ms for a stroke and
 * about 100 ms for a frame: the budget guards against work that grows with the
 * drawing, not a constant slowdown of two or three times.
 */
const budget = 30;

describe("A long drawing", function () {
  this.timeout(300_000);

  before(async function () {
    await loadModules();
    // A run compares a hundred frames in one script, longer on a slow machine
    // than WebDriver's usual limit for one.
    await browser.setTimeout({ script: 120_000 });
  });

  it("always has the ends and pixels of a full measurement, through every way of changing it", async function () {
    const totals = new Map<string, number>();
    let frames = 0;
    let addedPen = 0;
    let addedEraser = 0;
    let saves = 0;
    let savesAPixelOff = 0;
    let refused = 0;
    for (const { seed, reach, ratio, straddles } of runs) {
      const report = await browser.execute(
        (seed, steps, reach, ratio, straddles) =>
          window.inklineTest.longDrawing.runSequence(
            seed,
            steps,
            reach,
            ratio,
            straddles,
          ),
        seed,
        steps,
        reach,
        ratio,
        straddles,
      );
      expect(report.mismatch).toBeUndefined();
      for (const [name, times] of Object.entries(report.operations)) {
        totals.set(name, (totals.get(name) ?? 0) + times);
      }
      frames += report.frames;
      addedPen += report.addedPen;
      addedEraser += report.addedEraser;
      saves += report.saves;
      savesAPixelOff += report.savesAPixelOff;
      refused += report.refused;
    }
    console.log(
      `${String(frames)} frames compared, ${String(addedPen)} adding a pen stroke and ${String(addedEraser)} an eraser's, ${String(saves)} saves, ${String(savesAPixelOff)} a pixel off, ${String(refused)} refused as too wide: ${JSON.stringify(Object.fromEntries(totals))}`,
    );
    // The runs do what they are for: every operation, and both kinds of
    // stroke added to the frame before, which is what the view shortens.
    expect([...totals.keys()].sort()).toEqual([
      "across",
      "add a base layer",
      "clear",
      "drop the base layer",
      "ellipse",
      "far dot",
      "fit",
      "freehand",
      "move",
      "pan",
      "polygon",
      "redo",
      "restore",
      "save",
      "straddle",
      "undo",
      "zoom",
    ]);
    expect(addedPen).toBeGreaterThan(50);
    expect(addedEraser).toBeGreaterThan(20);
    // A save a pixel from a full measurement is the rare exception (#159).
    expect(savesAPixelOff).toBeLessThan(saves / 20);
  });

  it("measures an added stroke as a full measurement does, across a tile's edge", async function () {
    const result = await browser.execute(() =>
      window.inklineTest.longDrawing.measureStraddling(),
    );
    console.log(
      `${String(result.cases)} strokes across a tile's edge, ${String(result.wrongAlone)} a pixel off if measured on a tile of their own`,
    );
    expect(result.differences).toEqual([]);
  });

  it("measures everything again for a stroke that would move the tiles, and nothing for one outside the line box", async function () {
    const result = await browser.execute(() => {
      const { canvas, record } = window.inklineTest;
      const dot = (x: number, y: number) => ({
        tool: "pen" as const,
        size: 12 * record.unitsPerPixel,
        points: [x * record.unitsPerPixel, y * record.unitsPerPixel],
      });
      const measure = canvas.measureInk({ strokes: [dot(100, 96)] }, undefined);
      if (measure === undefined) throw new Error("no ink");
      return {
        left: canvas.measureAdded(measure, dot(50, 96)) === undefined,
        outside: canvas.measureAdded(measure, dot(50, -100)) === measure,
        right: canvas.measureAdded(measure, dot(200, 96))?.ink?.right,
        full: canvas.findInk(
          { strokes: [dot(100, 96), dot(200, 96)] },
          undefined,
        )?.right,
      };
    });
    expect(result.left).toBe(true);
    expect(result.outside).toBe(true);
    expect(result.right).toBe(result.full);
  });

  it("adds to a long drawing in about the same time however long it is", async function () {
    const result = await browser.execute(
      (count, span) => window.inklineTest.longDrawing.timeChanges(count, span),
      count,
      span,
    );
    const fastest = (times: readonly number[]) => Math.min(...times);
    console.log(
      `${String(count)} dots over ${String(span)} px, fastest of nine: a pen stroke inside ${fastest(result.inside).toFixed(1)} ms, past the end ${fastest(result.past).toFixed(1)} ms, a frame past the end ${fastest(result.frames).toFixed(1)} ms`,
    );
    expect(result.strokes).toBe(count + 18);
    expect(result.ends.shown).toEqual(result.ends.full);
    expect(fastest(result.inside)).toBeLessThan(budget);
    expect(fastest(result.past)).toBeLessThan(budget);
    expect(fastest(result.frames)).toBeLessThan(budget);
  });
});
