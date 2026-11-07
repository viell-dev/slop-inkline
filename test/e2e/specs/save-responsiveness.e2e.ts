// Saving the largest symbols there are, as a person does from the editor. A save
// takes seconds of work, which must go on in slices short enough for the page to
// keep painting and taking input, and must write what it always wrote.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  editFile,
  startOver,
  timedEditorSave,
  writeNoise,
} from "../support/editor.ts";

/**
 * The two ways a symbol is large: nearly the 8 MiB of PNG a base layer can hold,
 * of noise, which PNG cannot compress, and the most pixels one can have, which
 * empty pixels make into a file of a few kilobytes. `budget` is the most the
 * shortest of three saves' longest task and longest frame may take, in ms.
 *
 * In Docker on Windows 11, beside other jobs, the first was 120 to 230 ms in
 * Obsidian 1.13.4 and 1.15.0, and the second 40 to 60 ms. Nearly all of the first
 * is the one write a save cannot divide, the draft's copy of its base layer, a
 * single call to local storage, a moment after the person asked to save. Before
 * saves paused, the first was over 4,000 ms; leaving out just the pauses in the
 * check of its image data, or those in reducing its pixels for the second,
 * still fails.
 */
const symbols = [
  {
    file: "Bytes.ink.png",
    side: 2470,
    spacing: 1,
    least: 8_000_000,
    budget: 400,
  },
  {
    file: "Pixels.ink.png",
    side: 4096,
    spacing: 4099,
    least: 40_000,
    budget: 200,
  },
] as const;

/** How many times to save each. */
const saves = 3;

/** A stroke away from the middle, moved a little each time. */
function stroke(run: number): [number, number][] {
  const y = 0.2 + (run % 6) / 10;
  return [
    [0.3, y],
    [0.7, y + 0.05],
  ];
}

/** A fingerprint of the base layer a picture file opens with. */
async function openedBase(file: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const { canvas, drafts } = window.inklineTest;
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const opened = await canvas.openInk(
      new Uint8Array(await app.vault.readBinary(found)),
    );
    if (opened.kind !== "editable") throw new Error(opened.kind);
    const png = opened.document.base?.png;
    if (png === undefined) throw new Error("no base layer");
    return drafts.fingerprintOf(png);
  }, file);
}

/**
 * What a saved file holds, and whether it is what the plain steps, all at once
 * and without a pause, make of its own record.
 */
async function written(file: string) {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const { drafts, inkFile, png, record } = window.inklineTest;
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    const chunks = png.readChunks(bytes);
    const source = await inkFile.readInk(chunks);
    if (source.kind !== "record") throw new Error(source.kind);
    const text = new TextEncoder().encode(
      record.serializeRecord(source.record),
    );
    const compressed = await png.deflate(text);
    const data = new Uint8Array(4 + compressed.length);
    new DataView(data.buffer).setUint32(0, record.formatVersion);
    data.set(compressed, 4);
    const rebuilt = png.writeChunks(
      chunks.map((chunk) =>
        chunk.type === inkFile.recordChunkType
          ? { type: chunk.type, data }
          : chunk,
      ),
    );
    const { base, strokes } = source.record;
    return {
      bytes: bytes.length,
      same:
        (await drafts.fingerprintOf(rebuilt)) ===
        (await drafts.fingerprintOf(bytes)),
      damaged: chunks.filter((chunk) => chunk.damaged === true).length,
      strokes: strokes.length,
      base: base === undefined ? "" : await drafts.fingerprintOf(base.png),
    };
  }, file);
}

describe("Saving a large symbol", function () {
  this.timeout(600_000);

  before(async function () {
    await loadModules();
    // Making the largest picture takes seconds in one script.
    await browser.setTimeout({ script: 120_000 });
  });

  beforeEach(async function () {
    await startOver();
  });

  after(async function () {
    await startOver();
  });

  for (const { file, side, spacing, least, budget } of symbols) {
    it(`keeps the page answering, and writes what it always wrote: ${file}`, async function () {
      await writeNoise(file, side, spacing);
      const base = await openedBase(file);
      const runs: Awaited<ReturnType<typeof timedEditorSave>>[] = [];
      for (let run = 0; run < saves; run++) {
        await editFile(file);
        await draw(stroke(run));
        const saved = await timedEditorSave();
        const holds = await written(file);
        runs.push(saved);
        console.log(
          `Save ${String(run + 1)} of ${file}`,
          JSON.stringify({ ...saved.thread, totalMs: saved.totalMs, ...holds }),
        );
        expect(holds.bytes).toBeGreaterThan(least);
        expect(holds.same).toBe(true);
        expect(holds.damaged).toBe(0);
        expect(holds.strokes).toBe(run + 1);
        expect(holds.base).toBe(base);
        // Timing alone would not show this: it costs a large file a third of a
        // second, a little under the budget.
        expect(saved.bases.writes).toBeGreaterThan(0);
        expect(saved.bases.readInSameTask).toBe(0);
      }
      const shortest = (each: (run: (typeof runs)[number]) => number): number =>
        Math.min(...runs.map(each));
      // Work done all in one go would have one task as long as the whole save.
      // Not a figure of its own: a fast machine must pass this too.
      for (const run of runs) {
        expect(run.totalMs).toBeGreaterThan(run.thread.longestTaskMs);
      }
      // No frames would look like no long ones.
      expect(shortest((run) => run.thread.frames)).toBeGreaterThan(10);
      expect(shortest((run) => run.thread.longestTaskMs)).toBeLessThan(budget);
      expect(shortest((run) => run.thread.longestFrameMs)).toBeLessThan(budget);
    });
  }

  it("reads and writes a reduced base layer a little at a time, to the same pixels", async function () {
    const result = await browser.execute(async () => {
      const { canvas, pixels } = window.inklineTest;
      const width = 1001;
      const height = 777;
      const data = new Uint8ClampedArray(width * height * 4);
      let seed = 11;
      for (let index = 0; index < width * height; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[index * 4 + 3] = seed >>> 24;
      }
      const opened = await canvas.openInk(
        await canvas.encodePixels({ width, height, data }),
      );
      if (opened.kind !== "editable" || opened.base === undefined) {
        throw new Error("no base layer");
      }
      const { image } = opened.base;
      const place = { x: 37, y: -21, width: 3333, height: 2222 };
      const whole = canvas.readPixels(image);
      const reduced = await pixels.reduceBaseAlpha(
        (row) => whole.data.subarray(row * width * 4, (row + 1) * width * 4),
        { size: width, start: place.x, length: place.width },
        { size: height, start: place.y, length: place.height },
      );
      const base = await canvas.reducedBase(
        { ...opened.base, ...place },
        { pause: canvas.nextTask },
      );
      const context = base.image.getContext("2d");
      if (context === null) throw new Error("no context");
      const drawn = context.getImageData(
        0,
        0,
        base.image.width,
        base.image.height,
      );
      let differing = 0;
      for (let index = 0; index < reduced.alpha.length; index++) {
        if (drawn.data[index * 4 + 3] !== reduced.alpha[index]) differing++;
      }
      return {
        size: [base.image.width, base.image.height],
        expected: [reduced.width, reduced.height],
        place: [base.x, base.y, base.width, base.height],
        expectedPlace: [
          reduced.across.start,
          reduced.down.start,
          reduced.across.length,
          reduced.down.length,
        ],
        pixels: reduced.alpha.length,
        differing,
      };
    });
    expect(result.size).toEqual(result.expected);
    expect(result.place).toEqual(result.expectedPlace);
    // More rows than go onto the canvas at a time.
    expect(result.expected[1]).toBeGreaterThan(64);
    expect(result.pixels).toBeGreaterThan(0);
    expect(result.differing).toBe(0);
  });

  it("pauses for a task of its own, without waiting on a hidden window's timers", async function () {
    const result = await browser.executeObsidian(async ({ require }) => {
      const { nextTask } = window.inklineTest.canvas;
      // A promise that is settled already would come back before this ran.
      let timerRan = false;
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => {
        port1.close();
        timerRan = true;
      };
      port2.postMessage(undefined);
      await nextTask();
      const electron = require("electron") as unknown as {
        remote: { getCurrentWindow(): { hide(): void; show(): void } };
      };
      const current = electron.remote.getCurrentWindow();
      current.hide();
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const state = document.visibilityState;
        const start = performance.now();
        for (let count = 0; count < 100; count++) await nextTask();
        return { timerRan, state, ms: performance.now() - start };
      } finally {
        current.show();
      }
    });
    expect(result.timerRan).toBe(true);
    expect(result.state).toBe("hidden");
    // A timer there can take most of a second, each.
    expect(result.ms).toBeLessThan(1000);
  });
});
