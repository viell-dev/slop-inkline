import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { type Stroke, unitsPerPixel } from "../../../src/format/record.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { loadModules } from "../support/browser.ts";
import { pressed, save } from "../support/editing.ts";
import {
  draw,
  drawHoldingShift,
  drawShifted,
  editorGrid,
  openAtMarker,
  recordOf,
  settledSurface,
  shiftClick,
  startOver,
  surface,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import { framesDrawn } from "../support/waits.ts";

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
      strokes.map((stroke) =>
        stroke.kind === undefined
          ? { tool: stroke.tool, size: stroke.size, points: stroke.points }
          : stroke,
      ),
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
      const reach = (stroke.size ?? 0) / 16;
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

/** How far a new symbol's surface reaches across, in document pixels. */
const across = 576;

/** A place on the drawing area, in document pixels. */
interface Place {
  readonly x: number;
  readonly y: number;
}

/** A place as fractions of a new symbol's surface. */
function fractions({ x, y }: Place): readonly [number, number] {
  return [x / across, y / lineBox.height];
}

/**
 * The grid point nearest a place given as fractions of a new symbol's
 * surface, in document pixels, as Shift puts a point there.
 */
async function gridPoint([fx, fy]: readonly [number, number]): Promise<Place> {
  const { spacing, rows } = await editorGrid();
  const y = fy * lineBox.height;
  const row = rows.reduce(
    (best, at) => (Math.abs(at - y) < Math.abs(best - y) ? at : best),
    Number.POSITIVE_INFINITY,
  );
  return { x: Math.round((fx * across) / spacing) * spacing, y: row };
}

/** What {@link watchFrames} keeps on the window while it watches. */
interface StillProbe {
  /** The last two frames read, the older first. */
  recent: Uint8Array[];
  /** The frame before each key named, from when it was first pressed. */
  before: Record<string, Uint8Array>;
  /** The frame before the release. */
  held: Uint8Array | undefined;
  /** Stops reading and takes the probe and its listeners away. */
  stop: () => void;
}

/**
 * Starts reading the surface's alpha in every animation frame, keeping the
 * last two, and the one before each Shift or G key pressed and before the
 * release; {@link stopWatching} ends it.
 */
async function watchFrames(): Promise<void> {
  await browser.execute(() => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no context");
    let running = true;
    const probe: StillProbe = {
      recent: [],
      before: {},
      held: undefined,
      stop: () => undefined,
    };
    const read = (): void => {
      if (!running) return;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const alpha = new Uint8Array(canvas.width * canvas.height);
      for (let index = 0; index < alpha.length; index++) {
        alpha[index] = data[index * 4 + 3] ?? 0;
      }
      probe.recent.push(alpha);
      if (probe.recent.length > 2) probe.recent.shift();
      window.requestAnimationFrame(read);
    };
    window.requestAnimationFrame(read);
    // A frame just before an event can be read before the editor has drawn
    // what came before it, so the older of the last two is taken.
    const key = (event: KeyboardEvent): void => {
      const name = event.key.toLowerCase();
      if (name !== "shift" && name !== "g") return;
      const [older] = probe.recent;
      if (older !== undefined && !(name in probe.before)) {
        probe.before[name] = older;
      }
    };
    const up = (): void => {
      probe.held = probe.recent[0];
    };
    // Before the editor's shortcuts, which can stop a key's event.
    window.addEventListener("keydown", key, true);
    canvas.addEventListener("pointerup", up);
    probe.stop = () => {
      running = false;
      window.removeEventListener("keydown", key, true);
      canvas.removeEventListener("pointerup", up);
      Reflect.deleteProperty(window, "stillProbe");
    };
    Reflect.set(window, "stillProbe", probe);
  });
}

/** Ends {@link watchFrames}, if it is watching. */
async function stopWatching(): Promise<void> {
  await browser.execute(() => {
    (Reflect.get(window, "stillProbe") as StillProbe | undefined)?.stop();
  });
}

/**
 * From the frames {@link watchFrames} kept: how many pixels the key named
 * `key` changed, between the frame before it and the frame before the
 * release, and how many the release changed, between that frame and the last
 * one read, each by more than 2 of 255. It stops watching.
 */
async function stillChanges(
  key: string,
): Promise<{ byKey: number; byRelease: number }> {
  return browser.execute((wanted) => {
    const probe = Reflect.get(window, "stillProbe") as StillProbe | undefined;
    if (probe === undefined) throw new Error("not watching");
    probe.stop();
    const before = probe.before[wanted];
    const { held } = probe;
    const after = probe.recent.at(-1);
    if (before === undefined || held === undefined || after === undefined) {
      throw new Error(
        `no frame before the ${wanted} key, or the release, or after`,
      );
    }
    const differ = (a: Uint8Array, b: Uint8Array): number => {
      let count = 0;
      for (let index = 0; index < a.length; index++) {
        if (Math.abs((a[index] ?? 0) - (b[index] ?? 0)) > 2) count++;
      }
      return count;
    };
    return { byKey: differ(before, held), byRelease: differ(held, after) };
  }, key);
}

/**
 * Draws a filled ellipse of the pen's XL ink under where the eraser goes,
 * and chooses the XL eraser, drawing freehand, with the grid on and Flat
 * ends off, so that it erases the area its brush sweeps. Gives grid points
 * for its drag: down, across, and up to a row above where it started.
 */
async function eraserOverInk(): Promise<[Place, Place, Place, Place]> {
  await openOnGrid();
  await browser.keys("o");
  await browser.keys("b");
  await draw([
    [0.08, 0.1],
    [0.62, 0.97],
  ]);
  await browser.keys("b");
  await browser.keys("o");
  await browser.keys("e");
  await browser.keys("4");
  await browser.keys("t");
  await browser.waitUntil(async () => (await pressed("flat-ends")) === "false");
  return [
    await gridPoint([0.2, 0.6]),
    await gridPoint([0.2, 0.9]),
    await gridPoint([0.5, 0.9]),
    await gridPoint([0.5, 0.4]),
  ];
}

/**
 * Whether a saved eraser area's end, its last point, is round where it came
 * up to it: some corner within the brush's radius across from it lies above
 * its row, as a cut end's would not.
 */
function roundUp(stroke: Stroke | undefined, size: number): boolean {
  const points = stroke?.points ?? [];
  const ex = points.at(-2) ?? 0;
  const ey = points.at(-1) ?? 0;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index] ?? 0;
    const y = points[index + 1] ?? 0;
    if (Math.abs(x - ex) <= size / 2 && y < ey - size / 4) return true;
  }
  return false;
}

/** How to reach a place on a new symbol's surface in an action. */
async function offsets(): Promise<
  (place: Place) => { origin: WebdriverIO.Element; x: number; y: number }
> {
  const { width, height } = await settledSurface();
  const canvas = await surface().getElement();
  return (place) => {
    const [fx, fy] = fractions(place);
    // Offsets are from the element's centre.
    return {
      origin: canvas,
      x: Math.round((fx - 0.5) * width),
      y: Math.round((fy - 0.5) * height),
    };
  };
}

/**
 * For the saved symbol's last stroke, an eraser's area along a straight line
 * from one row down to another, `size` units wide, cut flat at both: the
 * inked pixels beyond the end's row, within the brush's reach of the end, and
 * those just before it, within the line's width, in the saved image, in a
 * redraw of the pen strokes alone, and in a redraw with a round-ended eraser
 * along the same line instead; and the pixels whose alpha differs between the
 * saved image and a redraw. The line runs straight down from the row
 * `rows.start` to the row `rows.end`, in document pixels, where Shift put the
 * drag's ends, below the area's last point; `marker` is that point's row.
 */
async function eraserEnd(
  size: number,
  rows: { readonly start: number; readonly end: number },
): Promise<{
  past: { saved: number; pens: number; rounded: number };
  before: { saved: number; pens: number };
  marker: number;
  redrawn: number;
}> {
  return browser.executeObsidian(
    async ({ app }, units, [start, end]) => {
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
      const eraser = strokes.at(-1);
      if (eraser === undefined) throw new Error("no eraser");
      const pens = strokes.filter((stroke) => stroke.tool === "pen");
      // A save moves the drawing across to crop it, but not up or down.
      const ex = eraser.points.at(-2) ?? 0;
      const marker = (eraser.points.at(-1) ?? 0) / 16;
      const x = ex / 16;
      const y = Math.round(end * 16) / 16;
      const reach = units / 16;
      const rounded = redraw([
        ...pens,
        {
          tool: "eraser",
          size: units,
          points: [ex, Math.round(start * 16), ex, Math.round(end * 16)],
        },
      ]);
      const again = redraw(strokes);
      let redrawn = 0;
      for (let at = 3; at < again.length; at += 4) {
        if (Math.abs((again[at] ?? 0) - (saved.data[at] ?? 0)) > 1) redrawn++;
      }
      const count = (
        data: Uint8ClampedArray,
        band: readonly [number, number],
        within: number,
      ): number => {
        let inked = 0;
        for (let row = band[0]; row < band[1]; row++) {
          for (let column = 0; column < width; column++) {
            const near = Math.abs(column + 0.5 - x) <= within;
            if (near && (data[(row * width + column) * 4 + 3] ?? 0) > 0)
              inked++;
          }
        }
        return inked;
      };
      // Beyond the row, as far as the brush reaches; before it, the brush's
      // half width less a pixel and a half for the soft edges, from the row up
      // by that much, to the last pixel row wholly before it.
      const beyond: [number, number] = [
        Math.ceil(y),
        Math.min(height, Math.ceil(y + reach)),
      ];
      const inside = reach / 2 - 1.5;
      const before: [number, number] = [Math.floor(y - inside), Math.floor(y)];
      const pensOnly = redraw(pens);
      return {
        past: {
          saved: count(saved.data, beyond, reach),
          pens: count(pensOnly, beyond, reach),
          rounded: count(rounded, beyond, reach),
        },
        before: {
          saved: count(saved.data, before, inside),
          pens: count(pensOnly, before, inside),
        },
        marker,
        redrawn,
      };
    },
    size,
    [rows.start, rows.end] as const,
  );
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
      const reach = (size ?? 0) / 16;
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
  afterEach(async function () {
    await stopWatching();
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
    // The pen's line and the eraser's end are on one row of the grid, at
    // grid points worked out from it.
    const left = await gridPoint([0.3, 0.5]);
    const right = await gridPoint([0.7, 0.5]);
    await drawHoldingShift([fractions(left), [0.5, 0.52], fractions(right)]);
    // A dot, then the XL eraser, which keeps a size of its own, down into
    // the stroke, ending on its row.
    await shiftClick([0.5, 0.25]);
    await browser.keys("e");
    await browser.keys("4");
    const from = await gridPoint([0.6, 0.3]);
    const to = await gridPoint([0.6, 0.5]);
    await drawHoldingShift([fractions(from), fractions(to)]);
    await save();
    const strokes = await savedStrokes();
    // The pen's strokes keep their round ends. The eraser, started with
    // Flat ends and the grid on, is a smooth stroke cut at both, as in 1.0.1
    // (#341).
    expect(strokes.map((stroke) => stroke.cut)).toEqual([
      undefined,
      undefined,
      { start: "up", end: "down" },
    ]);
    expect(strokes[2]?.tool).toBe("eraser");
    expect(strokes[2]?.kind).toBeUndefined();
    const shown = await eraserEnd(384, { start: from.y, end: to.y });
    console.log("Flat", JSON.stringify({ from, to, shown }));
    // The area ends on the row the drag ended on.
    expect(
      Math.abs(shown.marker - Math.round(to.y * unitsPerPixel) / unitsPerPixel),
    ).toBeLessThanOrEqual(1 / unitsPerPixel);
    // Past the row the eraser ends on, the pen's ink is all still there; a
    // round end would have taken some of it.
    expect(shown.past.pens).toBeGreaterThan(20);
    expect(shown.past.saved).toBe(shown.past.pens);
    expect(shown.past.rounded).toBeLessThan(shown.past.pens - 20);
    // Just before it, the eraser took all the pen's ink, as far as the row.
    expect(shown.before.pens).toBeGreaterThan(20);
    expect(shown.before.saved).toBe(0);
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

  it("shows the eraser's end as letting go saves it, when Shift is pressed with the pointer still", async function () {
    // The third review of #381: the pointer stops beside a grid point, and
    // Shift pressed there puts the end on it. The editor shows that before
    // the release.
    const [a, b, c, d] = await eraserOverInk();
    const off = { x: d.x + 3.3, y: d.y + 2.6 };
    await watchFrames();
    const to = await offsets();
    const keys = browser.action("key");
    const pointer = browser.action("pointer", {
      parameters: { pointerType: "mouse" },
    });
    pointer.move(to(a)).down();
    for (const at of [b, c, off]) pointer.move({ ...to(at), duration: 100 });
    pointer.pause(300);
    for (let tick = 0; tick < 6; tick++) keys.pause(10);
    keys.down(Key.Shift).pause(400).pause(10).up(Key.Shift);
    pointer.pause(10).pause(400).up().pause(300);
    await browser.actions([keys, pointer]);
    await framesDrawn();
    const shown = await stillChanges("shift");
    console.log("Shift with the pointer still", JSON.stringify(shown));
    // The key changed what is shown, and the release nothing more: without
    // the editor drawing again for the key, the release would change it.
    expect(shown.byKey).toBeGreaterThan(0);
    expect(shown.byRelease).toBe(0);
    await save();
    // The area the brush swept, ending on the grid point's row, its end
    // round.
    const eraser = (await savedStrokes()).at(-1);
    expect(eraser?.tool).toBe("eraser");
    expect(eraser?.kind).toBe("fill");
    expect(eraser?.points.at(-1)).toBe(Math.round(d.y * unitsPerPixel));
    expect(roundUp(eraser, 384)).toBe(true);
  });

  it("shows the eraser's end as letting go saves it, when the grid is turned on with the pointer still", async function () {
    // The third review of #381: Shift draws the last move with the grid
    // off, and Shift+G then turns it on, which puts the end on the grid. The
    // editor shows that before the release.
    const [a, b, c, d] = await eraserOverInk();
    await browser.keys(["Shift", "g"]);
    await browser.waitUntil(async () => (await pressed("grid")) === "false");
    const off = { x: d.x + 3.3, y: d.y + 2.6 };
    await watchFrames();
    const to = await offsets();
    const keys = browser.action("key");
    const pointer = browser.action("pointer", {
      parameters: { pointerType: "mouse" },
    });
    pointer.move(to(a)).down();
    for (const at of [b, c]) pointer.move({ ...to(at), duration: 100 });
    pointer
      .pause(10)
      .move({ ...to(off), duration: 100 })
      .pause(300);
    for (let tick = 0; tick < 4; tick++) keys.pause(10);
    keys.down(Key.Shift).pause(10).pause(300).down("g").up("g").pause(400);
    pointer.pause(10).pause(10).pause(400).up().pause(300);
    keys.pause(10).up(Key.Shift);
    await browser.actions([keys, pointer]);
    await framesDrawn();
    expect(await pressed("grid")).toBe("true");
    const shown = await stillChanges("g");
    console.log("Grid on with the pointer still", JSON.stringify(shown));
    // The key changed what is shown, and the release nothing more: without
    // the editor drawing again for the key, the release would change it.
    expect(shown.byKey).toBeGreaterThan(0);
    expect(shown.byRelease).toBe(0);
    await save();
    // The area the brush swept, ending on the grid point's row, its end
    // round.
    const eraser = (await savedStrokes()).at(-1);
    expect(eraser?.tool).toBe("eraser");
    expect(eraser?.kind).toBe("fill");
    expect(eraser?.points.at(-1)).toBe(Math.round(d.y * unitsPerPixel));
    expect(roundUp(eraser, 384)).toBe(true);
  });

  it("offers Flat ends only for freehand strokes and paths on the grid", async function () {
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await settledSurface();
    const button = browser.$('[data-inkline-button="flat-ends"]');
    expect(await button.isEnabled()).toBe(false);
    await browser.keys("t");
    await browser.waitUntil(async () =>
      (await browser.$(".inkline-status").getText()).includes(
        "Flat ends is for freehand strokes and paths on the grid",
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
    // A path keeps it, as it cuts a path's ends as it cuts a freehand one's.
    await browser.keys(["Shift", "p"]);
    await browser.waitUntil(async () => (await pressed("path")) === "true");
    expect(await button.isEnabled()).toBe(true);
    expect(await pressed("flat-ends")).toBe("true");
    await browser.keys(["Shift", "p"]);
    await browser.waitUntil(async () => (await pressed("path")) === "false");
    await saveScreenshot("flat-ends-on", browser.$(".inkline-editor"));
  });
});
