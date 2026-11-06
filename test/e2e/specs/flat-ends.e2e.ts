import { browser, expect } from "@wdio/globals";
import type { Stroke } from "../../../src/format/record.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  drawHoldingShift,
  drawShifted,
  openAtMarker,
  recordOf,
  settledSurface,
  shiftClick,
  startOver,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** What the saved symbol's pixels show past the lines its strokes end on. */
interface Spill {
  /** Inked pixels past each cut end's line, in the saved image. */
  readonly saved: number[];
  /** The same, drawn again from the record without its cuts. */
  readonly uncut: number[];
  /** The same, drawn again from the record's pen strokes alone. */
  readonly pens: number[];
  /** Each cut end's tool. */
  readonly tools: string[];
  /** Pixels whose alpha differs between the saved image and a redraw. */
  readonly redrawn: number;
}

/** A button's pressed state. */
async function pressed(id: string): Promise<string | null> {
  return browser
    .$(`[data-inkline-button="${id}"]`)
    .getAttribute("aria-pressed");
}

/**
 * Opens the editor for a new symbol with the XL brush and the grid on, and
 * Flat ends too, unless `flat` is false.
 */
async function openOnGrid(flat = true): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
  await browser.keys("4");
  await browser.keys(["Shift", "g"]);
  await browser.waitUntil(async () => (await pressed("grid")) === "true");
  if (!flat) return;
  await browser.keys("t");
  await browser.waitUntil(async () => (await pressed("flat-ends")) === "true");
}

async function save(): Promise<void> {
  await browser.keys(["Control", "Enter"]);
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

async function savedStrokes(): Promise<Stroke[]> {
  const record = JSON.parse(await recordOf("001.ink.png")) as {
    strokes: Stroke[];
  };
  return record.strokes;
}

/**
 * Counts, for each cut end of the saved symbol's strokes, the inked pixels
 * past the line through that end, within the brush's reach of it: in the
 * saved image, and in a redraw of the record without its cuts.
 */
async function spill(): Promise<Spill> {
  return browser.executeObsidian(async ({ app }) => {
    const file = app.vault.getFileByPath("001.ink.png");
    if (file === null) throw new Error("no saved ink");
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    const { canvas, render } = window.inklineTest;
    const opened = await canvas.openInk(bytes);
    if (opened.kind !== "editable") throw new Error("not editable");
    const bitmap = await canvas.decodePng(bytes);
    const saved = canvas.readPixels(bitmap);
    bitmap.close();
    const { width, height } = saved;
    const redraw = (strokes: readonly Stroke[]): Uint8ClampedArray => {
      const surface = new OffscreenCanvas(width, height);
      const context = surface.getContext("2d");
      if (context === null) throw new Error("no context");
      render.drawInk(context, strokes, undefined);
      return context.getImageData(0, 0, width, height).data;
    };
    const strokes = opened.document.strokes;
    const uncut = redraw(
      strokes.map(({ tool, size, pressure, points }) => ({
        tool,
        size,
        pressure,
        points,
      })),
    );
    const pens = redraw(strokes.filter((stroke) => stroke.tool === "pen"));
    const again = redraw(strokes);
    let redrawn = 0;
    for (let at = 3; at < again.length; at += 4) {
      if (Math.abs((again[at] ?? 0) - (saved.data[at] ?? 0)) > 1) redrawn++;
    }
    /** Inked pixels wholly past the line through a cut end. */
    const past = (
      data: Uint8ClampedArray,
      stroke: Stroke,
      which: "start" | "end",
    ): number => {
      const direction = stroke.cut?.[which];
      if (direction === undefined) return -1;
      const at = which === "start" ? 0 : stroke.points.length - 2;
      const x = (stroke.points[at] ?? 0) / 16;
      const y = (stroke.points[at + 1] ?? 0) / 16;
      const reach = stroke.size / 16;
      let count = 0;
      for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
          const beyond =
            direction === "down"
              ? row >= Math.ceil(y)
              : row + 1 <= Math.floor(y);
          const near =
            Math.abs(column + 0.5 - x) <= reach &&
            Math.abs(row + 0.5 - y) <= reach;
          if (beyond && near && (data[(row * width + column) * 4 + 3] ?? 0) > 0)
            count++;
        }
      }
      return count;
    };
    const ends = strokes.flatMap((stroke) =>
      (["start", "end"] as const)
        .filter((which) => stroke.cut?.[which] !== undefined)
        .map((which) => [stroke, which] as const),
    );
    return {
      saved: ends.map(([stroke, which]) => past(saved.data, stroke, which)),
      uncut: ends.map(([stroke, which]) => past(uncut, stroke, which)),
      pens: ends.map(([stroke, which]) => past(pens, stroke, which)),
      tools: ends.map(([stroke]) => stroke.tool),
      redrawn,
    };
  });
}

/**
 * For each saved stroke that runs level, the inked pixels of the saved image
 * past each of its ends, within the brush's reach, and in its middle those
 * below the line through its points, which a cut along it would take away.
 */
async function levelInk(): Promise<
  { start: number; end: number; below: number }[]
> {
  return browser.executeObsidian(async ({ app }) => {
    const file = app.vault.getFileByPath("001.ink.png");
    if (file === null) throw new Error("no saved ink");
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    const { canvas } = window.inklineTest;
    const opened = await canvas.openInk(bytes);
    if (opened.kind !== "editable") throw new Error("not editable");
    const bitmap = await canvas.decodePng(bytes);
    const { data, width, height } = canvas.readPixels(bitmap);
    bitmap.close();
    return opened.document.strokes.map(({ points, size }) => {
      const left = Math.min(points[0] ?? 0, points.at(-2) ?? 0) / 16;
      const right = Math.max(points[0] ?? 0, points.at(-2) ?? 0) / 16;
      const y = (points[1] ?? 0) / 16;
      const reach = size / 16;
      const count = (inside: (column: number, row: number) => boolean) => {
        let inked = 0;
        for (let row = 0; row < height; row++) {
          for (let column = 0; column < width; column++) {
            if (
              inside(column, row) &&
              (data[(row * width + column) * 4 + 3] ?? 0) > 0
            ) {
              inked++;
            }
          }
        }
        return inked;
      };
      const level = (row: number): boolean => Math.abs(row + 0.5 - y) <= reach;
      const middle = (left + right) / 2;
      return {
        start: count((column, row) => column + 1 <= left && level(row)),
        end: count((column, row) => column >= right && level(row)),
        below: count(
          (column, row) =>
            Math.abs(column - middle) <= 4 && row >= y && level(row),
        ),
      };
    });
  });
}

describe("Flat ends on the grid", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  after(async function () {
    await startOver();
  });

  it("leaves a line along the baseline whole, with round ends", async function () {
    await openOnGrid();
    // The owner's simplest case in #150: left to right along the baseline.
    await draw([
      [0.3, 0.75],
      [0.7, 0.75],
    ]);
    // The same along another row, with its ends placed on the grid by Shift.
    await drawShifted([
      { at: [0.3, 0.45], shift: true },
      { at: [0.7, 0.45], shift: true },
    ]);
    await saveScreenshot("flat-ends-baseline", browser.$(".inkline-editor"));
    await save();
    const strokes = await savedStrokes();
    const shown = await levelInk();
    console.log(
      "Along a row",
      JSON.stringify({ cuts: strokes.map(({ cut }) => cut), shown }),
    );
    for (const stroke of strokes) expect(stroke).not.toHaveProperty("cut");
    // Round ends of the XL brush, 24 pixels wide, reach past both ends, and
    // the half of the line below its middle is all there.
    for (const { start, end, below } of shown) {
      expect(start).toBeGreaterThan(100);
      expect(end).toBeGreaterThan(100);
      expect(below).toBeGreaterThan(50);
    }
  });

  it("stops a steep stroke flush with the rows it starts and ends on", async function () {
    await openOnGrid();
    // Freehand between two ends that Shift places.
    await drawShifted(
      [
        { at: [0.5, 0.25], shift: true },
        { at: [0.52, 0.5], shift: false },
        { at: [0.55, 0.75], shift: false },
      ],
      true,
    );
    await saveScreenshot("flat-ends-steep", browser.$(".inkline-editor"));
    await save();
    const [stroke] = await savedStrokes();
    expect(stroke?.cut).toEqual({ start: "up", end: "down" });
    const shown = await spill();
    console.log("Steep", JSON.stringify(shown));
    expect(shown.saved).toEqual([0, 0]);
    // Without the cuts, the round caps would reach past both rows.
    for (const count of shown.uncut) expect(count).toBeGreaterThan(20);
    expect(shown.redrawn).toBe(0);
  });

  it("keeps a level stroke and a dot round, and stops an eraser on the row it ends on", async function () {
    await openOnGrid();
    await drawHoldingShift([
      [0.3, 0.5],
      [0.5, 0.52],
      [0.7, 0.5],
    ]);
    // A dot, then the eraser down into the stroke, ending on its row.
    await shiftClick([0.5, 0.25]);
    await browser.keys("e");
    await drawHoldingShift([
      [0.6, 0.3],
      [0.6, 0.5],
    ]);
    await save();
    const strokes = await savedStrokes();
    expect(strokes.map((stroke) => stroke.cut)).toEqual([
      undefined,
      undefined,
      { start: "up", end: "down" },
    ]);
    const shown = await spill();
    console.log("Flat", JSON.stringify(shown));
    expect(shown.tools).toEqual(["eraser", "eraser"]);
    // Past the row the eraser ends on, the pen's ink is all still there;
    // a round end would have taken some of it.
    const [, erased = 0] = shown.saved;
    const [, inked = 0] = shown.pens;
    const [, rounded = 0] = shown.uncut;
    expect(inked).toBeGreaterThan(20);
    expect(erased).toBe(inked);
    expect(rounded).toBeLessThan(inked - 20);
    expect(shown.redrawn).toBe(0);
  });

  it("keeps the rest of a stroke that comes back near a cut end", async function () {
    // A spiral of the M brush, 12 pixels wide at the editor's 128 pixels per
    // em, cut below its start; its last stretch passes 8 pixels from it, as in
    // the independent review of #119.
    const shown = await browser.execute(() => {
      const { render } = window.inklineTest;
      // Corners in pixels, with a point every pixel between, as the editor
      // records a stroke.
      const corners = [
        [64, 64],
        [64, 32],
        [96, 32],
        [96, 96],
        [56, 96],
        [56, 48],
        [32, 48],
      ];
      const points: number[] = [];
      corners.forEach(([x = 0, y = 0], index) => {
        const [nextX, nextY] = corners[index + 1] ?? [x, y];
        const steps = Math.max(
          1,
          Math.abs((nextX ?? x) - x),
          Math.abs((nextY ?? y) - y),
        );
        for (let step = 0; step < steps; step++) {
          points.push(
            (x + (((nextX ?? x) - x) * step) / steps) * 16,
            (y + (((nextY ?? y) - y) * step) / steps) * 16,
          );
        }
      });
      const stroke = {
        tool: "pen" as const,
        size: 192,
        pressure: false,
        points,
      };
      const alpha = (cut: boolean): number[][] => {
        const surface = new OffscreenCanvas(128, 128);
        const context = surface.getContext("2d");
        if (context === null) throw new Error("no context");
        render.drawInk(
          context,
          [cut ? { ...stroke, cut: { start: "down" as const } } : stroke],
          undefined,
        );
        const { data } = context.getImageData(0, 0, 128, 128);
        const at = (x: number, y: number): number =>
          data[(y * 128 + x) * 4 + 3] ?? 0;
        return [
          // Down the middle of the stretch that comes back, past the start.
          Array.from({ length: 41 }, (_, step) => at(56, 50 + step)),
          // Below the start, past its row, clear of that stretch.
          [at(64, 66), at(65, 68)],
        ];
      };
      return { cut: alpha(true), uncut: alpha(false) };
    });
    console.log("Spiral", JSON.stringify(shown));
    const [stretch = [], below = []] = shown.cut;
    expect(Math.min(...stretch)).toBeGreaterThanOrEqual(250);
    expect(below).toEqual([0, 0]);
    // Without the cut, the start's round end would be there.
    for (const value of shown.uncut[1] ?? []) expect(value).toBeGreaterThan(0);
  });

  it("keeps round ends on the grid until Flat ends is turned on", async function () {
    await openOnGrid(false);
    expect(await pressed("flat-ends")).toBe("false");
    await drawHoldingShift([
      [0.5, 0.25],
      [0.55, 0.75],
    ]);
    await save();
    const [stroke] = await savedStrokes();
    expect(stroke).not.toHaveProperty("cut");
  });

  it("keeps a freehand end round with Flat ends on: only ends Shift placed are cut", async function () {
    await openOnGrid();
    // Neither end placed with Shift, then only the start, then only the end.
    const stroke: readonly (readonly [number, number])[] = [
      [0.3, 0.25],
      [0.32, 0.75],
    ];
    await draw(stroke);
    await drawShifted([
      { at: [0.5, 0.25], shift: true },
      { at: [0.52, 0.75], shift: false },
    ]);
    await drawShifted(
      [
        { at: [0.7, 0.25], shift: false },
        { at: [0.72, 0.75], shift: false },
      ],
      true,
    );
    await save();
    const strokes = await savedStrokes();
    console.log("Shift's ends", JSON.stringify(strokes.map(({ cut }) => cut)));
    expect(strokes.map(({ cut }) => cut)).toEqual([
      undefined,
      { start: "up" },
      { end: "down" },
    ]);
  });

  it("offers Flat ends only for freehand strokes on the grid", async function () {
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await settledSurface();
    const button = browser.$('[data-inkline-button="flat-ends"]');
    expect(await button.isEnabled()).toBe(false);
    await browser.keys("t");
    await browser.waitUntil(async () =>
      (await browser.$(".inkline-status").getText()).includes(
        "Flat ends is for freehand strokes on the grid",
      ),
    );
    await browser.keys(["Shift", "g"]);
    await browser.waitUntil(async () => await button.isEnabled());
    await browser.keys("t");
    await browser.waitUntil(
      async () => (await pressed("flat-ends")) === "true",
    );
    // A shape turns it off, and it comes back with freehand.
    await browser.keys("y");
    await browser.waitUntil(async () => !(await button.isEnabled()));
    expect(await pressed("flat-ends")).toBe("false");
    await browser.keys("y");
    await browser.waitUntil(
      async () => (await pressed("flat-ends")) === "true",
    );
    await saveScreenshot("flat-ends-on", browser.$(".inkline-editor"));
  });

  it("keeps round ends with the grid off", async function () {
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await settledSurface();
    await browser.keys("4");
    await drawHoldingShift([
      [0.5, 0.25],
      [0.55, 0.75],
    ]);
    await save();
    const [stroke] = await savedStrokes();
    expect(stroke).not.toHaveProperty("cut");
  });
});
