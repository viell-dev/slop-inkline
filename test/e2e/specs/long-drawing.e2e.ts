// A drawing that keeps growing: the editor adds a stroke to what it has drawn
// and measured rather than doing it all again, which must never show anything
// but what doing it all again would.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";

/**
 * Each run's seed, how far across it draws, and its screen's device pixels to
 * a CSS pixel: a symbol, a long drawing, and one wider than the preview shows
 * at once and than the widest tile measured.
 */
const runs = [
  { seed: 115, reach: 500, ratio: 1 },
  { seed: 116, reach: 500, ratio: 2 },
  { seed: 117, reach: 3000, ratio: 1 },
  { seed: 118, reach: 3000, ratio: 1.5 },
  { seed: 119, reach: 5000, ratio: 1 },
  { seed: 120, reach: 5000, ratio: 2 },
] as const;

const steps = 80;

/** How many dots, and how far across, for the budget. */
const count = 3000;
const span = 3000;

/**
 * The most the fastest of nine may take, for each kind of change, in ms. In
 * Docker on Windows 11, beside other jobs, it was at most 7 ms in Obsidian
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
    for (const { seed, reach, ratio } of runs) {
      const report = await browser.execute(
        (seed, steps, reach, ratio) =>
          window.inklineTest.longDrawing.runSequence(seed, steps, reach, ratio),
        seed,
        steps,
        reach,
        ratio,
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
    }
    console.log(
      `${String(frames)} frames compared, ${String(addedPen)} adding a pen stroke and ${String(addedEraser)} an eraser's, ${String(saves)} saves, ${String(savesAPixelOff)} a pixel off: ${JSON.stringify(Object.fromEntries(totals))}`,
    );
    // The runs do what they are for: every operation, and both kinds of
    // stroke added to the frame before, which is what the view shortens.
    expect([...totals.keys()].sort()).toEqual([
      "across",
      "add a base layer",
      "clear",
      "drop the base layer",
      "ellipse",
      "fit",
      "freehand",
      "move",
      "pan",
      "polygon",
      "redo",
      "restore",
      "save",
      "undo",
      "zoom",
    ]);
    expect(addedPen).toBeGreaterThan(50);
    expect(addedEraser).toBeGreaterThan(20);
    // A save a pixel from a full measurement is the rare exception (#159).
    expect(savesAPixelOff).toBeLessThan(saves / 20);
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
