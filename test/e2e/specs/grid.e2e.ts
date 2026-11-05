import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { unitsPerPixel, type Stroke } from "../../../src/format/record.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { defaultSettings, type Settings } from "../../../src/settings.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  editorGrid,
  openAtMarker,
  recordOf,
  settledSurface,
  startOver,
  storedDrafts,
  symbolFiles,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/**
 * The grid the drawing area shows, read from its pixels while the guides are
 * hidden, so that only its dots are there, in the right fifth for its rows and
 * the bottom fifth for its columns, which the ink in these tests keeps clear
 * of: the middles of their rows and columns, from the surface's edges, and the
 * font's lines from an independent `measureText` of the preview line's font,
 * all in document pixels, with how many device pixels make one and how many
 * document pixels the surface shows across.
 */
interface DotsShown {
  readonly rows: number[];
  readonly columns: number[];
  readonly lines: Record<string, number>;
  readonly factor: number;
  readonly across: number;
}

async function dotsShown(): Promise<DotsShown> {
  return browser.execute(() => {
    const doc = activeDocument;
    const view = doc.defaultView;
    if (view === null) throw new Error("no window");
    const canvas = doc.querySelector(".inkline-editor .inkline-surface");
    const line = doc.querySelector(".inkline-editor .inkline-preview");
    if (
      canvas?.instanceOf(HTMLCanvasElement) !== true ||
      line?.instanceOf(HTMLElement) !== true
    ) {
      throw new Error("no surface");
    }
    const font = view.getComputedStyle(line);
    const probe = new view.OffscreenCanvas(1, 1).getContext("2d");
    if (probe === null) throw new Error("no context");
    probe.font = `${font.fontStyle} ${font.fontWeight} 128px ${font.fontFamily}`;
    const capital = probe.measureText("H");
    const lowercase = probe.measureText("x");
    const lines = Object.fromEntries(
      (
        [
          ["ascender", 144 - capital.fontBoundingBoxAscent],
          ["cap height", 144 - capital.actualBoundingBoxAscent],
          ["x-height", 144 - lowercase.actualBoundingBoxAscent],
          ["baseline", 144],
          ["descender", 144 + capital.fontBoundingBoxDescent],
        ] as const
      ).filter(([, y]) => y >= 0 && y <= 192),
    );
    // The line box is as tall as the surface, in either view.
    const across =
      (canvas.clientWidth * 192) /
      Number.parseFloat(
        canvas.style.getPropertyValue("--inkline-surface-height"),
      );
    const factor = canvas.width / across;
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, width, height);
    if (pixels === undefined) throw new Error("no pixels");
    const inkedRows = new Array<boolean>(height).fill(false);
    const inkedColumns = new Array<boolean>(width).fill(false);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels.data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
        if (x >= width * 0.8) inkedRows[y] = true;
        if (y >= height * 0.8) inkedColumns[x] = true;
      }
    }
    /** The middle of each run of inked pixels, in document pixels. */
    const middles = (inked: readonly boolean[]): number[] => {
      const found: number[] = [];
      let start = -1;
      for (let index = 0; index <= inked.length; index++) {
        if (inked[index] === true) {
          if (start < 0) start = index;
        } else if (start >= 0) {
          found.push((start + index) / 2 / factor);
          start = -1;
        }
      }
      return found;
    };
    return {
      rows: middles(inkedRows),
      columns: middles(inkedColumns),
      lines,
      factor,
      across,
    };
  });
}

/** The grid shown, once it stops changing. */
async function settledDots(): Promise<DotsShown> {
  await settledSurface();
  let shown: DotsShown | undefined;
  await browser.waitUntil(async () => {
    const previous = shown;
    shown = await dotsShown();
    return (
      shown.rows.length > 2 &&
      JSON.stringify([shown.rows, shown.columns]) ===
        JSON.stringify([previous?.rows, previous?.columns])
    );
  });
  if (shown === undefined) throw new Error("no dots");
  return shown;
}

/** The distance from `value` to the nearest of `values`. */
function offBy(values: readonly number[], value: number): number {
  return Math.min(...values.map((other) => Math.abs(other - value)));
}

/** How many of `rows` lie strictly between `from` and `to`, a pixel inside. */
function rowsBetween(rows: readonly number[], from: number, to: number) {
  const [top, bottom] = from < to ? [from, to] : [to, from];
  return rows.filter((row) => row > top + 1 && row < bottom - 1).length;
}

/** Starts Inkline again with its settings stored as `changes` say. */
async function storeSettings(changes: Partial<Settings>): Promise<void> {
  await obsidianPage.disablePlugin("inkline");
  await browser.executeObsidian(
    async ({ app }, settings) => {
      await app.vault.adapter.write(
        `${app.vault.configDir}/plugins/inkline/data.json`,
        JSON.stringify(settings),
      );
    },
    { ...defaultSettings, ...changes },
  );
  await obsidianPage.enablePlugin("inkline");
  await loadModules();
}

/**
 * Opens the editor for a new symbol with the grid shown and the guides
 * hidden, and waits for its dots.
 */
async function openWithGrid(): Promise<DotsShown> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
  await browser.keys(["Shift", "g"]);
  await browser.keys("g");
  return settledDots();
}

/** The gaps between neighbouring `values`. */
function steps(values: readonly number[]): number[] {
  return values.slice(1).map((value, index) => value - (values[index] ?? 0));
}

/** Taps at a fraction of the drawing area, and returns where the dot went. */
async function tap(x: number, y: number): Promise<{ x: number; y: number }> {
  const before = (await storedDrafts())[0]?.strokes.length ?? 0;
  await draw([[x, y]]);
  await browser.waitUntil(
    async () => ((await storedDrafts())[0]?.strokes.length ?? 0) > before,
  );
  const points = (await storedDrafts())[0]?.strokes.at(-1)?.points ?? [];
  return {
    x: (points[0] ?? 0) / unitsPerPixel,
    y: (points[1] ?? 0) / unitsPerPixel,
  };
}

async function zoom(status: "Zoomed in" | "Zoomed out"): Promise<DotsShown> {
  await browser.keys("z");
  await waitForStatus(status);
  return settledDots();
}

/** Where a new symbol's surface starts, zoomed, as it shows `across`. */
function zoomedLeft(across: number, moved = 0): number {
  return Math.round(288 + moved - across / 2);
}

/** A document point as fractions of a surface starting at `left`. */
function fractions(
  shown: DotsShown,
  left: number,
  x: number,
  y: number,
): readonly [number, number] {
  return [(x - left) / shown.across, y / lineBox.height];
}

describe("Grid", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    await storeSettings({});
  });
  after(async function () {
    await startOver();
    await storeSettings({});
  });

  it("puts a row of dots on each font line, 5 cells across the x-height", async function () {
    const shown = await openWithGrid();
    await saveScreenshot("grid-default");
    console.log("Grid", JSON.stringify(shown));
    const tolerance = 1 / shown.factor;
    // Every line the font has in the line box, by name.
    const off = Object.entries(shown.lines).map(
      ([name, y]) => [name, offBy(shown.rows, y) <= tolerance] as const,
    );
    expect(off.length).toBeGreaterThanOrEqual(4);
    expect(off).toEqual(off.map(([name]) => [name, true]));
    const xHeight = shown.lines["x-height"] ?? 0;
    expect(rowsBetween(shown.rows, lineBox.baseline, xHeight)).toBe(4);
    // Columns are as far apart as the x-height's rows.
    const cell = (lineBox.baseline - xHeight) / 5;
    const columnSteps = shown.columns
      .slice(1)
      .map((x, index) => x - (shown.columns[index] ?? 0));
    for (const step of columnSteps) {
      expect(Math.abs(step - cell)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("takes the cells across the x-height from the settings", async function () {
    await storeSettings({ gridCells: 8 });
    const shown = await openWithGrid();
    const xHeight = shown.lines["x-height"] ?? 0;
    expect(rowsBetween(shown.rows, lineBox.baseline, xHeight)).toBe(7);
    expect(offBy(shown.rows, xHeight)).toBeLessThanOrEqual(1 / shown.factor);
  });

  it("follows only the lines the settings choose: the baseline alone gives even rows", async function () {
    await storeSettings({
      ascenderGuide: false,
      capHeightGuide: false,
      xHeightGuide: false,
      baselineGuide: false,
      descenderGuide: false,
    });
    const shown = await openWithGrid();
    await saveScreenshot("grid-baseline-only");
    const tolerance = 1 / shown.factor;
    expect(offBy(shown.rows, lineBox.baseline)).toBeLessThanOrEqual(tolerance);
    const steps = shown.rows
      .slice(1)
      .map((y, index) => y - (shown.rows[index] ?? 0));
    const cell = (lineBox.baseline - (shown.lines["x-height"] ?? 0)) / 5;
    for (const step of steps) {
      expect(Math.abs(step - cell)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("snaps strokes' ends to the dots it shows, with the guides hidden or shown", async function () {
    const shown = await openWithGrid();
    await draw([
      [0.31, 0.27],
      [0.52, 0.41],
      [0.69, 0.73],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const points = (await storedDrafts())[0]?.strokes[0]?.points ?? [];
    const tolerance = 1 / shown.factor;
    for (const [x, y] of [
      [points[0], points[1]],
      [points.at(-2), points.at(-1)],
    ] as const) {
      expect(offBy(shown.columns, (x ?? 0) / unitsPerPixel)).toBeLessThan(
        tolerance,
      );
      expect(offBy(shown.rows, (y ?? 0) / unitsPerPixel)).toBeLessThan(
        tolerance,
      );
    }
    // Showing the guides leaves the grid where it was.
    await browser.keys("g");
    await draw([[0.31, 0.27]]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    const dot = (await storedDrafts())[0]?.strokes[1]?.points;
    expect(dot).toEqual(points.slice(0, 2));
  });

  it("has twice the cells in Zoom, on the usual grid's points, and leaves that in place", async function () {
    const usual = await openWithGrid();
    const { spacing, rows } = await editorGrid();
    const xHeight = usual.lines["x-height"] ?? 0;
    expect(rowsBetween(usual.rows, lineBox.baseline, xHeight)).toBe(4);

    // A save moves the drawing, and with it the columns, here to 8 pixels or
    // so past one, where this stroke's flat start crops to: at least half a
    // spacing in any text font, where strokes drawn in Zoom could take them
    // back by the finer spacing, half a cell.
    await draw([
      [0.45, 0.5],
      [0.55, 0.5],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const drawn = (await storedDrafts())[0]?.strokes[0]?.points[0] ?? 0;
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: Stroke[];
    };
    const moved = ((record.strokes[0]?.points[0] ?? 0) - drawn) / unitsPerPixel;
    const origin = ((moved % spacing) + spacing) % spacing;
    console.log("Moved by", moved, "columns through", origin, "of", spacing);
    expect(origin).toBeGreaterThanOrEqual(spacing / 2);

    const zoomed = await zoom("Zoomed in");
    await saveScreenshot("grid-zoom");
    console.log("Zoomed grid", JSON.stringify(zoomed));
    const tolerance = 1 / zoomed.factor;
    expect(rowsBetween(zoomed.rows, lineBox.baseline, xHeight)).toBe(9);
    for (const step of steps(zoomed.columns)) {
      expect(Math.abs(step - spacing / 2)).toBeLessThanOrEqual(tolerance);
    }
    // Every point of the usual grid in view is a point shown.
    for (const y of rows) {
      expect(offBy(zoomed.rows, y)).toBeLessThanOrEqual(tolerance);
    }
    const left = zoomedLeft(zoomed.across, moved);
    const first = origin + Math.ceil((left - origin) / spacing) * spacing;
    for (let x = first; x <= left + zoomed.across; x += spacing) {
      expect(offBy(zoomed.columns, x - left)).toBeLessThanOrEqual(tolerance);
    }

    // A stroke ends on a point of the finer grid alone, off the usual grid.
    const row = rows.findIndex((y) => y >= 60);
    const fineX =
      first +
      Math.round((0.35 * zoomed.across) / spacing) * spacing +
      spacing / 2;
    const fineY = ((rows[row] ?? 0) + (rows[row + 1] ?? 0)) / 2;
    await draw([[0.2, 0.3], fractions(zoomed, left, fineX, fineY)]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    const points = (await storedDrafts())[0]?.strokes[1]?.points ?? [];
    expect(points.slice(-2)).toEqual([
      fineX * unitsPerPixel,
      Math.round(fineY * unitsPerPixel),
    ]);
    const start = (points[0] ?? 0) / unitsPerPixel;
    expect(Number.isInteger((start - origin) / (spacing / 2))).toBe(true);

    // A point of the usual grid is still a point.
    const usualX =
      first + Math.round((0.65 * zoomed.across) / spacing) * spacing;
    const usualY = rows[row] ?? 0;
    expect(await tap(...fractions(zoomed, left, usualX, usualY))).toEqual({
      x: usualX,
      y: Math.round(usualY * unitsPerPixel) / unitsPerPixel,
    });

    // Zoomed out, the grid is where it was, and it is after a save, which
    // this stroke further left makes move the drawing, while zoomed.
    let back = await zoom("Zoomed out");
    await saveScreenshot("grid-zoomed-out");
    expect(back.columns).toEqual(usual.columns);
    expect(back.rows).toEqual(usual.rows);
    await zoom("Zoomed in");
    await draw([
      [0.05, 0.3],
      [0.1, 0.3],
    ]);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    back = await zoom("Zoomed out");
    expect(back.columns).toEqual(usual.columns);
    expect(back.rows).toEqual(usual.rows);
  });

  it("keeps a polygon on the grid it started on when Zoom changes, until it ends", async function () {
    const usual = await openWithGrid();
    const { spacing, rows } = await editorGrid();
    const xHeight = usual.lines["x-height"] ?? 0;
    await browser.keys("y");
    await draw([[0.4, 0.3]]);
    const held = await zoom("Zoomed in");
    expect(rowsBetween(held.rows, lineBox.baseline, xHeight)).toBe(4);
    // A click where the finer grid would have a point of its own.
    const left = zoomedLeft(held.across);
    const row = rows.findIndex((y) => y >= 100);
    const x =
      (Math.round((left + 0.6 * held.across) / spacing) + 0.5) * spacing;
    const y = ((rows[row] ?? 0) + (rows[row + 1] ?? 0)) / 2;
    await draw([fractions(held, left, x, y)]);
    await browser.keys("Enter");
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 1,
    );
    const corners = (await storedDrafts())[0]?.strokes[0]?.points ?? [];
    expect(corners).toHaveLength(4);
    const units = rows.map((value) => Math.round(value * unitsPerPixel));
    for (const [index, value] of corners.entries()) {
      if (index % 2 === 0) expect(value % (spacing * unitsPerPixel)).toBe(0);
      else expect(units).toContain(value);
    }
    // Once it has ended, the grid is the finer one.
    await browser.waitUntil(
      async () =>
        rowsBetween((await dotsShown()).rows, lineBox.baseline, xHeight) === 9,
    );
  });

  it("keeps the finer grid for the next symbol", async function () {
    const usual = await openWithGrid();
    const { spacing } = await editorGrid();
    await zoom("Zoomed in");
    await draw([
      [0.4, 0.4],
      [0.6, 0.4],
    ]);
    await browser.execute(() => {
      document
        .querySelector(".inkline-editor")
        ?.setAttribute("data-inkline-first", "");
    });
    await browser.keys(["Control", "Shift", "Enter"]);
    await browser.waitUntil(async () =>
      browser.execute(() => {
        const editors = document.querySelectorAll(".inkline-editor");
        return (
          editors.length === 1 &&
          !(editors[0]?.hasAttribute("data-inkline-first") ?? true)
        );
      }),
    );
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    const next = await settledDots();
    await saveScreenshot("grid-zoom-next");
    const xHeight = usual.lines["x-height"] ?? 0;
    expect(rowsBetween(next.rows, lineBox.baseline, xHeight)).toBe(9);
    for (const step of steps(next.columns)) {
      expect(Math.abs(step - spacing / 2)).toBeLessThanOrEqual(1 / next.factor);
    }
  });
});
