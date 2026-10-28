import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { unitsPerPixel } from "../../../src/format/record.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { defaultSettings, type Settings } from "../../../src/settings.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  settledSurface,
  startOver,
  storedDrafts,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/**
 * The grid the drawing area shows, read from its pixels while the guides are
 * hidden and nothing is drawn, so that only its dots are there: the middles
 * of their rows and columns, and the font's lines from an independent
 * `measureText` of the preview line's font, all in document pixels, with how
 * many device pixels make one.
 */
interface DotsShown {
  readonly rows: number[];
  readonly columns: number[];
  readonly lines: Record<string, number>;
  readonly factor: number;
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
    const factor = canvas.width / 576;
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, width, height);
    if (pixels === undefined) throw new Error("no pixels");
    const inkedRows = new Array<boolean>(height).fill(false);
    const inkedColumns = new Array<boolean>(width).fill(false);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels.data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
        inkedRows[y] = true;
        inkedColumns[x] = true;
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
    };
  });
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
  let shown: DotsShown | undefined;
  await browser.waitUntil(async () => {
    const previous = shown;
    shown = await dotsShown();
    return (
      shown.rows.length > 2 &&
      JSON.stringify(shown.rows) === JSON.stringify(previous?.rows)
    );
  });
  if (shown === undefined) throw new Error("no dots");
  return shown;
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
    const tap = (await storedDrafts())[0]?.strokes[1]?.points;
    expect(tap).toEqual(points.slice(0, 2));
  });
});
