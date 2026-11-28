import { browser, expect } from "@wdio/globals";
import type { Stroke } from "../../../src/format/record.ts";
import { loadModules } from "../support/browser.ts";
import { editFile, pressed, save } from "../support/editing.ts";
import {
  draw,
  markEditor,
  openAtMarker,
  recordOf,
  settledSurface,
  shiftClick,
  startOver,
  surface,
  waitForEditor,
  waitForNext,
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
  await browser.keys("a");
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

/** Moves the mouse to a point on the surface, with no button down. */
async function hover([x, y]: At): Promise<void> {
  const { width, height } = await settledSurface();
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({
      origin: surface(),
      x: Math.round((x - 0.5) * width),
      y: Math.round((y - 0.5) * height),
      duration: 20,
    })
    .perform();
}

/**
 * How many of the surface's pixels within 4 CSS pixels of each place, as
 * fractions of the surface, show ink: the text's colour, which the drawing
 * area draws its ink in, nearly opaque.
 */
async function inkShown(...near: readonly At[]): Promise<number[]> {
  return browser.execute((near) => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const { width, height } = canvas;
    const data = canvas.getContext("2d")?.getImageData(0, 0, width, height);
    if (data === undefined) throw new Error("no pixels");
    const [r = 0, g = 0, b = 0] = (
      getComputedStyle(canvas).color.match(/[\d.]+/g) ?? []
    ).map(Number);
    const box = canvas.getBoundingClientRect();
    const across = width / canvas.clientWidth;
    const reach = Math.round(4 * across);
    return near.map(([fx, fy]) => {
      const cx = Math.round((fx * box.width - canvas.clientLeft) * across);
      const cy = Math.round((fy * box.height - canvas.clientTop) * across);
      let count = 0;
      for (let y = cy - reach; y <= cy + reach; y++) {
        for (let x = cx - reach; x <= cx + reach; x++) {
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const at = (y * width + x) * 4;
          const [red = 0, green = 0, blue = 0, alpha = 0] = data.data.slice(
            at,
            at + 4,
          );
          if (
            alpha > 200 &&
            Math.abs(red - r) < 24 &&
            Math.abs(green - g) < 24 &&
            Math.abs(blue - b) < 24
          ) {
            count++;
          }
        }
      }
      return count;
    });
  }, near);
}

/** Waits for ink to show near each place, as {@link inkShown} counts it. */
async function waitForInk(problem: string, ...near: readonly At[]) {
  await browser.waitUntil(
    async () => (await inkShown(...near)).every((count) => count > 10),
    { timeoutMsg: problem },
  );
}

/** Presses at `from`, drags to `to` by way of the middle, and lets go. */
async function drag(from: At, to: At): Promise<void> {
  await draw([from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], to]);
}

/** What the status line says once a path has ended or closed. */
function waiting(state: "ended" | "closed"): string {
  return `Path ${state}: adjust its points and handles; Enter or Finish path makes it ink`;
}

/** Whether Finish path is on, or "missing" if the editor has no such button. */
async function finishOn(): Promise<boolean | "missing"> {
  return browser.execute(() => {
    const button = document.querySelector('[data-inkline-button="finish"]');
    return button === null ? "missing" : !button.hasAttribute("disabled");
  });
}

/** Waits for Finish path to be on or off. */
async function waitForFinish(on: boolean): Promise<void> {
  await browser.waitUntil(async () => (await finishOn()) === on, {
    timeoutMsg: `Finish path was not ${on ? "on" : "off"}`,
  });
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

  it("places a curve by its points, shows its controls until it is ink, and saves one stroke along it", async function () {
    await openPath();
    expect(await finishOn()).toBe(false);
    // From low on the left, heading up, round to high on the right, arriving
    // from the left: an arc bowed up and to the left of the line between.
    await drag([0.25, 0.7], [0.25, 0.4]);
    await waitForFinish(true);
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
    // After the smooth point's drag, the next curve follows the pointer from
    // it, to where a click would place the next point.
    expect((await inkShown([0.45, 0.85]))[0]).toBe(0);
    await hover([0.45, 0.85]);
    await waitForInk(
      "the next curve did not follow the pointer after a drag",
      [0.45, 0.85],
    );
    // A click on the last point ends it: no curve follows the pointer, the
    // controls stay, and it is not ink until Enter.
    await click([0.65, 0.3]);
    await waitForStatus(waiting("ended"));
    await hover([0.45, 0.85]);
    await browser.waitUntil(
      async () => (await inkShown([0.45, 0.85]))[0] === 0,
      { timeoutMsg: "a curve still followed the pointer once it ended" },
    );
    await waitForMarks([0.25, 0.7], [0.65, 0.3], [0.8, 0.3]);
    expect(await finishOn()).toBe(true);
    await saveScreenshot("path-ended", browser.$(".inkline-editor"));
    expect(await draftNow()).toBe(0);
    await browser.keys("Enter");
    const [arc] = await draftStrokes(1);
    expect(arc).toMatchObject({ tool: "pen", size: 384 });
    expect(arc).not.toHaveProperty("kind");
    expect(arc).not.toHaveProperty("cut");
    expect(await pressed("path")).toBe("true");
    await browser.waitUntil(async () => (await marksShown()).all === 0, {
      timeoutMsg: "the controls stayed after the path was ink",
    });
    await waitForFinish(false);
    // Its message goes with it.
    await browser.waitUntil(
      async () => (await browser.$(".inkline-status").getText()) === "",
      { timeoutMsg: "the status line still said how to finish the path" },
    );
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
    // Enter ends it, and Enter again makes it ink.
    await browser.keys("Enter");
    await waitForStatus(waiting("ended"));
    expect(await draftNow()).toBe(0);
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
    // Esc drops a path being placed, and one that has ended, and the editor
    // stays open.
    await browser.keys("a");
    for (const ended of [false, true]) {
      await click([0.3, 0.8], [0.6, 0.8]);
      if (ended) {
        await click([0.6, 0.8]);
        await waitForStatus(waiting("ended"));
      }
      await browser.keys("Escape");
      await waitForStatus("Path dropped");
      expect(await browser.$(".inkline-editor").isExisting()).toBe(true);
      expect(await draftStrokes(2)).toHaveLength(2);
      await browser.waitUntil(async () => (await marksShown()).all === 0, {
        timeoutMsg: "the dropped path's controls stayed",
      });
    }
    // Another shape chosen once a path has ended makes it ink.
    await click([0.3, 0.8], [0.6, 0.8], [0.6, 0.8]);
    await waitForStatus(waiting("ended"));
    await browser.keys("o");
    await browser.waitUntil(async () => (await pressed("ellipse")) === "true");
    const [, , level] = await draftStrokes(3);
    const along = pixels(level);
    expect(along.length).toBeGreaterThan(50);
    expect(along.at(-1)?.y).toBe(along[0]?.y);
    // One Undo takes back a whole path once it is ink.
    await browser.keys(["Control", "z"]);
    expect(await draftStrokes(2)).toHaveLength(2);
  });

  it("waits once ended to be adjusted, does nothing at a press beside it, and Undo takes back the ending", async function () {
    await openPath();
    // Along, and up: two sides of a triangle, open.
    await click([0.2, 0.6], [0.5, 0.6], [0.5, 0.25]);
    await browser.keys("Enter");
    await waitForStatus(waiting("ended"));
    // Something else said in the status line meanwhile.
    await browser.keys("t");
    await waitForStatus("Flat ends is for freehand strokes and paths");
    // A press away from its points and handles places nothing, and says how
    // to finish the path again; a drag there draws nothing.
    await click([0.8, 0.3]);
    await waitForStatus(waiting("ended"));
    await draw([
      [0.85, 0.2],
      [0.9, 0.5],
      [0.85, 0.8],
    ]);
    // A click on its first point closes nothing, and one on its last ends
    // nothing more.
    await click([0.2, 0.6], [0.5, 0.25]);
    // Its middle point dragged down: the sides follow it.
    await drag([0.5, 0.6], [0.5, 0.85]);
    await waitForMarks([0.2, 0.6], [0.5, 0.85], [0.5, 0.25]);
    await waitForInk("the sides did not follow the point moved", [0.35, 0.725]);
    // Where a press beside it was, where the drag went, and the side that
    // closing it would have drawn, nothing shows.
    expect(await inkShown([0.8, 0.3], [0.9, 0.5], [0.35, 0.425])).toEqual([
      0, 0, 0,
    ]);
    expect((await marksShown([0.8, 0.3], [0.9, 0.5])).near).toEqual([0, 0]);
    expect(await draftNow()).toBe(0);
    await saveScreenshot("path-adjusted", browser.$(".inkline-editor"));
    // Undo takes back the drag, then the ending: the next curve follows the
    // pointer again, and a click places a point there.
    await browser.keys(["Control", "z"]);
    await waitForMarks([0.2, 0.6], [0.5, 0.6], [0.5, 0.25]);
    await browser.waitUntil(
      async () => (await inkShown([0.35, 0.725]))[0] === 0,
      { timeoutMsg: "Undo left the point where it was dragged" },
    );
    await waitForStatus(waiting("ended"));
    await browser.keys(["Control", "z"]);
    await hover([0.75, 0.25]);
    await waitForInk(
      "the next curve did not follow the pointer once the ending was undone",
      [0.625, 0.25],
    );
    await click([0.75, 0.25]);
    await waitForMarks([0.2, 0.6], [0.5, 0.6], [0.5, 0.25], [0.75, 0.25]);
    // Mod+S saves it once ended, with all four points.
    await click([0.75, 0.25]);
    await waitForStatus(waiting("ended"));
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.waitUntil(async () => (await marksShown()).all === 0, {
      timeoutMsg: "the controls stayed after the path was saved",
    });
    await waitForFinish(false);
    const [saved] = await savedStrokes();
    const points = pixels(saved);
    const first = points[0] ?? { x: 0, y: 0 };
    const last = points.at(-1) ?? first;
    // From the left, along, up, and on to the right.
    expect(last.y).toBeLessThan(first.y - 20);
    expect(Math.max(...points.map(({ x }) => x))).toBe(last.x);
  });

  it("closes on its first point, filled with Toggle fill, moves its points once closed, and one Undo takes it back", async function () {
    await openPath();
    await browser.keys("b");
    await browser.waitUntil(async () => (await pressed("fill")) === "true");
    // A corner, and a smooth point whose handle points up: the curve comes
    // in to it from below, and leaves it upwards, round to the first point.
    await click([0.3, 0.6]);
    await drag([0.6, 0.6], [0.6, 0.3]);
    // Pointed at the first point after the drag, it shows the filled shape
    // the click makes, whose middle no line passes through.
    expect((await inkShown([0.45, 0.6]))[0]).toBe(0);
    await hover([0.3, 0.6]);
    await waitForInk("the close was not shown before the click", [0.45, 0.6]);
    await saveScreenshot("path-closing", browser.$(".inkline-editor"));
    // Closed, it stays closed and filled wherever the pointer goes, until it
    // is ink.
    await click([0.3, 0.6]);
    await waitForStatus(waiting("closed"));
    await hover([0.9, 0.9]);
    await waitForInk("the closed path did not stay filled", [0.45, 0.6]);
    expect(await draftNow()).toBe(0);
    // Its first point dragged further left, which a closed path keeps the
    // controls of too, and the button makes it ink.
    expect((await marksShown([0.2, 0.6])).near).toEqual([0]);
    expect(await inkShown([0.25, 0.6])).toEqual([0]);
    await drag([0.3, 0.6], [0.2, 0.6]);
    await waitForMarks([0.2, 0.6], [0.6, 0.6]);
    await waitForInk("the filled shape did not follow its point", [0.25, 0.6]);
    await saveScreenshot("path-closed-adjusted", browser.$(".inkline-editor"));
    await browser.$('[data-inkline-button="finish"]').click();
    const [inside, line] = await draftStrokes(2);
    await waitForFinish(false);
    // The drawing area has the focus back, so its keys work at once.
    expect(
      await browser.execute(() =>
        document.activeElement?.classList.contains("inkline-surface"),
      ),
    ).toBe(true);
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

  it("ends with its points on Next, closed once closed, which keeps Path on, and the close button drops one", async function () {
    await openPath();
    await click([0.3, 0.5]);
    await drag([0.6, 0.5], [0.7, 0.3]);
    await markEditor();
    await browser.keys(["Control", "Shift", "Enter"]);
    await waitForNext(1);
    expect(await pressed("path")).toBe("true");
    const [saved] = await savedStrokes();
    expect(saved).not.toHaveProperty("kind");
    expect(pixels(saved).length).toBeGreaterThan(150);
    // In the next symbol's editor, a path closed on its first point and
    // waiting to be made ink is saved closed by Next.
    await click([0.3, 0.5]);
    await drag([0.6, 0.5], [0.7, 0.3]);
    await click([0.3, 0.5]);
    await waitForStatus(waiting("closed"));
    await markEditor();
    await browser.keys(["Control", "Shift", "Enter"]);
    await waitForNext(2);
    const record = JSON.parse(await recordOf("002.ink.png")) as {
      strokes: Stroke[];
    };
    const [loop] = record.strokes;
    expect(record.strokes).toHaveLength(1);
    expect(loop?.points.slice(-2)).toEqual(loop?.points.slice(0, 2));
    // In the one after, the close button drops a path being placed, and one
    // waiting, first, and the editor stays open.
    for (const ended of [false, true]) {
      await click([0.3, 0.5], [0.6, 0.5]);
      if (ended) {
        await click([0.6, 0.5]);
        await waitForStatus(waiting("ended"));
      }
      await waitForMarks([0.3, 0.5], [0.6, 0.5]);
      await browser.$(".inkline-editor .modal-header-button").click();
      await waitForStatus("Path dropped");
      expect(await browser.$(".inkline-editor").isExisting()).toBe(true);
      await browser.waitUntil(async () => (await marksShown()).all === 0, {
        timeoutMsg: "the dropped path's controls stayed",
      });
      expect(await draftNow()).toBe(0);
    }
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
    await browser.keys("a");
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
    await waitForStatus(waiting("ended"));
    await browser.keys("Enter");
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
    await browser.keys("a");
    await click([0.35, 0.65]);
    await waitForMarks([0.35, 0.65]);
    await browser.keys("Enter");
    await waitForStatus(waiting("ended"));
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
    await waitForStatus(waiting("ended"));
    await browser.keys("Enter");
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
