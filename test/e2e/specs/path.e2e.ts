import { browser, expect } from "@wdio/globals";
import type { Stroke } from "../../../src/format/record.ts";
import { loadModules } from "../support/browser.ts";
import { editFile, pressed, save } from "../support/editing.ts";
import {
  draw,
  openAtMarker,
  recordOf,
  settledSurface,
  shiftClick,
  startOver,
  surface,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** A place on the surface, as fractions of its width and height. */
type At = readonly [number, number];

/**
 * The colour the spec gives a path's controls, which nothing else on the
 * surface has, so that they can be told apart from the ink and the guides.
 */
const marksColour = "rgb(255, 0, 255)";

/**
 * Opens the editor for a new symbol with the XL brush and Path on, and with
 * the grid if `grid` says so.
 */
async function openPath(grid = false): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
  await browser.keys("4");
  if (grid) {
    await browser.keys(["Shift", "g"]);
    await browser.waitUntil(async () => (await pressed("grid")) === "true");
  }
  await browser.keys(["Shift", "p"]);
  await browser.waitUntil(async () => (await pressed("path")) === "true");
  expect(await pressed("pen")).toBe("true");
}

/** Clicks the surface at each point: a press and a release, without a drag. */
async function click(...points: readonly At[]): Promise<void> {
  const canvas = surface();
  const { width, height } = await settledSurface();
  for (const [x, y] of points) {
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({
        origin: canvas,
        x: Math.round((x - 0.5) * width),
        y: Math.round((y - 0.5) * height),
        duration: 20,
      })
      .down()
      .up()
      .perform();
  }
}

/** Presses at `from`, drags to `to` by way of the middle, and lets go. */
async function drag(from: At, to: At): Promise<void> {
  await draw([from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], to]);
}

/**
 * The strokes of the editor's draft, whole, with their sizes and cuts, or
 * none while it keeps no draft.
 */
async function drafted(): Promise<Stroke[]> {
  return browser.executeObsidian(({ app }) => {
    const { drafts } = window.inklineTest;
    const [draft] = new drafts.DraftStore(app).list();
    return draft === undefined ? [] : [...draft.strokes];
  });
}

/** The strokes of the editor's draft, once it holds `count` of them. */
async function draftStrokes(count: number): Promise<Stroke[]> {
  await browser.waitUntil(async () => (await drafted()).length === count, {
    timeoutMsg: `the draft never held ${String(count)} strokes`,
  });
  return drafted();
}

/** How many strokes the draft holds now, which may be none. */
async function draftNow(): Promise<number> {
  return (await drafted()).length;
}

async function savedStrokes(): Promise<Stroke[]> {
  const record = JSON.parse(await recordOf("001.ink.png")) as {
    strokes: Stroke[];
  };
  return record.strokes;
}

/** A stroke's points, in pixels. */
function pixels(stroke: Stroke | undefined): { x: number; y: number }[] {
  const points = stroke?.points ?? [];
  const out: { x: number; y: number }[] = [];
  for (let at = 0; at + 1 < points.length; at += 2) {
    out.push({ x: (points[at] ?? 0) / 16, y: (points[at + 1] ?? 0) / 16 });
  }
  return out;
}

/**
 * The point halfway along a stroke's points, and the middle of the straight
 * line between its ends, in pixels.
 */
function middles(stroke: Stroke | undefined): {
  curve: { x: number; y: number };
  chord: { x: number; y: number };
} {
  const points = pixels(stroke);
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points.at(-1) ?? first;
  return {
    curve: points[Math.floor(points.length / 2)] ?? first,
    chord: { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 },
  };
}

/** The mean of a stroke's points, in pixels: inside a closed one's lens. */
function centre(stroke: Stroke | undefined): { x: number; y: number } {
  const points = pixels(stroke);
  const sum = points.reduce(
    (total, { x, y }) => ({ x: total.x + x, y: total.y + y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Waits for the surface to show the controls near each place given, as
 * {@link marksShown} counts them, and returns what it counted.
 */
async function waitForMarks(
  ...near: readonly At[]
): Promise<{ all: number; near: number[] }> {
  let shown = await marksShown(...near);
  await browser.waitUntil(
    async () => {
      shown = await marksShown(...near);
      return shown.all > 0 && shown.near.every((count) => count > 4);
    },
    { timeoutMsg: "the controls did not show where they are" },
  );
  return shown;
}

/**
 * The saved symbol's alpha at each point, in its pixels, and how many of its
 * pixels differ by more than one level from a redraw of its record.
 */
async function savedAlpha(
  points: readonly { x: number; y: number }[],
): Promise<{ alpha: number[]; redrawn: number }> {
  return browser.executeObsidian(async ({ app }, points) => {
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
    const surface = new OffscreenCanvas(width, height);
    const context = surface.getContext("2d");
    if (context === null) throw new Error("no context");
    render.drawInk(context, opened.document.strokes, undefined);
    const again = context.getImageData(0, 0, width, height).data;
    let redrawn = 0;
    for (let at = 3; at < again.length; at += 4) {
      if (Math.abs((again[at] ?? 0) - (saved.data[at] ?? 0)) > 1) redrawn++;
    }
    return {
      alpha: points.map(
        ({ x, y }) =>
          saved.data[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] ?? 0,
      ),
      redrawn,
    };
  }, points);
}

/**
 * How many of the surface's pixels show the controls' colour: everywhere,
 * and within 8 CSS pixels of each place given, as fractions of the surface.
 */
async function marksShown(
  ...near: readonly At[]
): Promise<{ all: number; near: number[] }> {
  return browser.execute((near) => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const { width, height } = canvas;
    const data = canvas.getContext("2d")?.getImageData(0, 0, width, height);
    if (data === undefined) throw new Error("no pixels");
    const isMark = (x: number, y: number): boolean => {
      const at = (y * width + x) * 4;
      const [red = 0, green = 0, blue = 0, alpha = 0] = data.data.slice(
        at,
        at + 4,
      );
      return alpha > 60 && red > 200 && green < 60 && blue > 200;
    };
    let all = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) if (isMark(x, y)) all++;
    }
    // The canvas's pixels across its content box, which its border frames.
    const box = canvas.getBoundingClientRect();
    const across = width / canvas.clientWidth;
    const reach = Math.round(8 * across);
    return {
      all,
      near: near.map(([fx, fy]) => {
        // The surface's fractions are of its border box, as the pointer's.
        const cx = Math.round((fx * box.width - canvas.clientLeft) * across);
        const cy = Math.round((fy * box.height - canvas.clientTop) * across);
        let count = 0;
        for (let y = cy - reach; y <= cy + reach; y++) {
          for (let x = cx - reach; x <= cx + reach; x++) {
            if (x >= 0 && y >= 0 && x < width && y < height && isMark(x, y)) {
              count++;
            }
          }
        }
        return count;
      }),
    };
  }, near);
}

describe("Path", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    await browser.execute((colour) => {
      if (document.getElementById("inkline-test-path-marks") !== null) return;
      const style = document.createElement("style");
      style.id = "inkline-test-path-marks";
      style.textContent = `body .inkline-surface { --inkline-path: ${colour}; }`;
      document.head.append(style);
    }, marksColour);
  });

  it("places a curve by its points, shows its controls only while placing it, and saves one stroke along it", async function () {
    await openPath();
    // From low on the left, heading up, round to high on the right, arriving
    // from the left: an arc bowed up and to the left of the line between.
    await drag([0.25, 0.7], [0.25, 0.4]);
    await drag([0.65, 0.3], [0.8, 0.3]);
    // Nothing is committed while the path is placed.
    expect(await draftNow()).toBe(0);
    // Each point, and the ends of the second one's handle, show where they
    // are: the one it leaves by, and its mirror, the one it comes in by.
    const placing = await waitForMarks(
      [0.25, 0.7],
      [0.25, 0.4],
      [0.65, 0.3],
      [0.8, 0.3],
      [0.5, 0.3],
    );
    console.log("Marks while placing", JSON.stringify(placing));
    await saveScreenshot("path-placing", browser.$(".inkline-editor"));
    // A click on the last point ends it.
    await click([0.65, 0.3]);
    const [arc] = await draftStrokes(1);
    expect(arc).toMatchObject({ tool: "pen", size: 384 });
    expect(arc).not.toHaveProperty("kind");
    expect(arc).not.toHaveProperty("cut");
    expect(await pressed("path")).toBe("true");
    await browser.waitUntil(async () => (await marksShown()).all === 0, {
      timeoutMsg: "the controls stayed after the path ended",
    });
    // Its points follow the curve no more than a pixel apart.
    const points = pixels(arc);
    expect(points.length).toBeGreaterThan(200);
    for (const [index, point] of points.entries()) {
      const next = points[index + 1];
      if (next === undefined) continue;
      expect(Math.hypot(next.x - point.x, next.y - point.y)).toBeLessThan(1.1);
    }
    await save();
    const [saved] = await savedStrokes();
    expect(saved).not.toHaveProperty("kind");
    expect(saved?.points).toHaveLength(arc?.points.length ?? 0);
    // Ink along the curve, and none on the straight line between its ends.
    const { curve, chord } = middles(saved);
    const ink = await savedAlpha([curve, chord]);
    console.log("Arc", JSON.stringify({ curve, chord, ink }));
    expect(ink.alpha[0]).toBeGreaterThan(250);
    expect(ink.alpha[1]).toBe(0);
    expect(ink.redrawn).toBe(0);
  });

  it("moves points and handles while placing, takes back each step, ends on another tool, and drops on Esc", async function () {
    await openPath();
    const undo = browser.$('[data-inkline-button="undo"]');
    await click([0.2, 0.5], [0.6, 0.5]);
    // The second point dragged up, and that taken back.
    await drag([0.6, 0.5], [0.6, 0.3]);
    await browser.keys(["Control", "z"]);
    // The second point taken back too, and placed again as a smooth point
    // whose handle runs along the line, so that the curve stays straight.
    await undo.click();
    await drag([0.6, 0.5], [0.7, 0.5]);
    // The end of the handle the curve comes in by, dragged down: the curve
    // now comes in from below, bowed down from the line.
    await drag([0.5, 0.5], [0.5, 0.85]);
    await saveScreenshot("path-handle-moved", browser.$(".inkline-editor"));
    await browser.keys("Enter");
    const [bowed] = await draftStrokes(1);
    const points = pixels(bowed);
    const first = points[0] ?? { x: 0, y: 0 };
    const last = points.at(-1) ?? first;
    // Ended where the second point was placed, level with the first.
    expect(last.y).toBeCloseTo(first.y, 0);
    expect(Math.max(...points.map(({ y }) => y))).toBeGreaterThan(first.y + 10);
    // Another tool or shape chosen while placing a path: the eraser takes it
    // over; Polygon ends it with the points it has.
    await click([0.3, 0.2]);
    await browser.keys("e");
    await click([0.5, 0.15]);
    await browser.keys("y");
    await browser.waitUntil(async () => (await pressed("polygon")) === "true");
    const [, ended] = await draftStrokes(2);
    // At the eraser's own size, which it keeps apart from the pen's.
    expect(ended).toMatchObject({ tool: "eraser", size: 192 });
    expect(ended).not.toHaveProperty("kind");
    // Esc drops a path being placed, and the editor stays open.
    await browser.keys(["Shift", "p"]);
    await click([0.3, 0.8], [0.6, 0.8]);
    await browser.keys("Escape");
    await waitForStatus("Path dropped");
    expect(await browser.$(".inkline-editor").isExisting()).toBe(true);
    expect(await draftStrokes(2)).toHaveLength(2);
    await browser.waitUntil(async () => (await marksShown()).all === 0, {
      timeoutMsg: "the dropped path's controls stayed",
    });
    // One Undo takes back a whole path once it has ended.
    await browser.keys(["Control", "z"]);
    expect(await draftStrokes(1)).toHaveLength(1);
  });

  it("closes on its first point, filled with Toggle fill, and one Undo takes it back", async function () {
    await openPath();
    await browser.keys("b");
    await browser.waitUntil(async () => (await pressed("fill")) === "true");
    // A corner, and a smooth point whose handle points up: the curve comes
    // in to it from below, and leaves it upwards, round to the first point.
    await click([0.3, 0.6]);
    await drag([0.6, 0.6], [0.6, 0.3]);
    await click([0.3, 0.6]);
    const [inside, line] = await draftStrokes(2);
    expect(inside?.kind).toBe("fill");
    expect(inside?.points).toEqual(line?.points);
    expect(line).not.toHaveProperty("kind");
    expect(line?.points.slice(-2)).toEqual(line?.points.slice(0, 2));
    await save();
    const [, saved] = await savedStrokes();
    const middle = centre(saved);
    // The middle of the shape is filled; far above it is empty.
    const ink = await savedAlpha([middle, { x: middle.x, y: 4 }]);
    console.log("Closed", JSON.stringify(ink));
    expect(ink.alpha[0]).toBeGreaterThan(250);
    expect(ink.alpha[1]).toBe(0);
    expect(ink.redrawn).toBe(0);
    await browser.keys(["Control", "z"]);
    await browser.waitUntil(async () => (await draftNow()) === 0, {
      timeoutMsg: "one Undo left part of the filled path",
    });
  });

  it("erases along its curve with the eraser, and is plain ink in the symbol opened again", async function () {
    await openPath();
    // A filled ellipse of the pen to erase from.
    await browser.keys("o");
    await browser.keys("b");
    await browser.waitUntil(async () => (await pressed("fill")) === "true");
    await draw([
      [0.15, 0.1],
      [0.5, 0.5],
      [0.85, 0.9],
    ]);
    await draftStrokes(2);
    await browser.keys("e");
    await browser.keys(["Shift", "p"]);
    await browser.waitUntil(async () => (await pressed("path")) === "true");
    /** The surface's pixels in the eraser's red, which shows what it takes. */
    const tinted = async (): Promise<number> =>
      browser.execute(() => {
        const canvas = document.querySelector(".inkline-surface");
        if (!(canvas instanceof HTMLCanvasElement))
          throw new Error("no surface");
        const { width, height } = canvas;
        const data = canvas.getContext("2d")?.getImageData(0, 0, width, height);
        let count = 0;
        for (let at = 0; at < (data?.data.length ?? 0); at += 4) {
          const [red = 0, green = 0, blue = 0, alpha = 0] =
            data?.data.slice(at, at + 4) ?? [];
          if (alpha > 0 && red > green + 40 && red > blue + 40) count++;
        }
        return count;
      });
    const before = await tinted();
    // Up from the left, and down into the right: an arch over the line
    // between its ends.
    await drag([0.35, 0.65], [0.35, 0.35]);
    await drag([0.65, 0.65], [0.65, 0.9]);
    await browser.waitUntil(async () => (await tinted()) > before + 500, {
      timeoutMsg: "no sign of the eraser's path being placed",
    });
    await saveScreenshot("path-eraser-placing", browser.$(".inkline-editor"));
    await click([0.65, 0.65]);
    const [, , erased] = await draftStrokes(3);
    expect(erased).toMatchObject({ tool: "eraser", size: 192 });
    expect(erased).not.toHaveProperty("kind");
    await save();
    const strokes = await savedStrokes();
    const { curve, chord } = middles(strokes[2]);
    const ink = await savedAlpha([curve, chord]);
    console.log("Erased", JSON.stringify({ curve, chord, ink }));
    // Taken away along the arch; the ink under the line between its ends,
    // which the arch passes well above, stays.
    expect(ink.alpha[0]).toBe(0);
    expect(ink.alpha[1]).toBeGreaterThan(250);
    expect(ink.redrawn).toBe(0);
    // Opened again, the symbol has the same strokes and draws freehand; a
    // path's point is not there to take hold of: a press there places a new
    // path.
    await editFile("001.ink.png");
    await settledSurface();
    expect(await pressed("path")).toBe("false");
    expect((await marksShown()).all).toBe(0);
    await browser.keys(["Shift", "p"]);
    await click([0.35, 0.65]);
    await waitForMarks([0.35, 0.65]);
    await browser.keys("Enter");
    const again = await draftStrokes(4);
    expect(again.slice(0, 3)).toEqual(strokes);
    expect(pixels(again[3])).toHaveLength(1);
  });

  it("puts its points on the grid with Shift, and cuts its ends flat there with Flat ends", async function () {
    await openPath(true);
    await browser.keys("t");
    await browser.waitUntil(
      async () => (await pressed("flat-ends")) === "true",
    );
    // From high on the left steeply down to the baseline, three quarters
    // down the line box, and a click on that last point again to end it.
    await shiftClick([0.3, 0.3], [0.38, 0.75], [0.38, 0.75]);
    const [legs] = await draftStrokes(1);
    expect(legs).not.toHaveProperty("kind");
    expect(legs?.cut).toEqual({ start: "up", end: "down" });
    await save();
    const [saved] = await savedStrokes();
    expect(saved?.cut).toEqual({ start: "up", end: "down" });
    const points = pixels(saved);
    const end = points.at(-1) ?? { x: 0, y: 0 };
    // The baseline's row: on the grid, at 144 pixels down.
    expect(end.y).toBe(144);
    const half = (saved?.size ?? 0) / 32;
    // Ink just above the end's row, and none below it, where a round end
    // would reach.
    const ink = await savedAlpha([
      { x: end.x, y: end.y - half / 2 },
      { x: end.x, y: end.y + half / 2 },
    ]);
    console.log("Flat", JSON.stringify(ink));
    expect(ink.alpha[0]).toBeGreaterThan(250);
    expect(ink.alpha[1]).toBe(0);
    expect(ink.redrawn).toBe(0);
  });
});
