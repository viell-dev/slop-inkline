import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { openAtMarker, startOver, waitForEditor } from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

describe("Enlarged picture conversion", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
  });

  // An H as tall as the picture, fitted to a capital's height: about 92
  // document pixels, so these enlarge it about 11.5, 5.75, 2.3 and 1.2 times.
  for (const side of [8, 16, 40, 75]) {
    it(`keeps a ${String(side)}-pixel H's enlarged edges narrow through Apply, save and reopen`, async function () {
      await checkClarity(side);
    });
  }

  // A dim H of soft, thin strokes, as in a screenshot of a game: enlarged
  // about 2.4, 5.1 and 7.7 times.
  for (const side of [38, 18, 12]) {
    it(`keeps a dim ${String(side)}-pixel H's edges narrow in the preview, zoomed in, and saved`, async function () {
      await checkDimClarity(side);
    });
  }
});

/** The lengths of the runs of partly covered pixels in `row`. */
function partialRuns(row: readonly number[]): number[] {
  return row
    .map((value) => (value > 12 && value < 243 ? "p" : " "))
    .join("")
    .split(" ")
    .filter((run) => run !== "")
    .map((run) => run.length);
}

/** The ink the surface shows along a row, and device pixels per document's. */
interface ShownRow {
  readonly row: number[];
  readonly scale: number;
}

/**
 * The ink the surface shows, in a row through the H's stems: above the
 * x-height's guide, which runs a quarter of the way down the H. Waits for the
 * surface to show it at `scale`, or at another scale than `not`.
 */
async function shownRow(
  wanted?: { scale: number } | { not: number },
): Promise<ShownRow> {
  let found: ShownRow | undefined;
  await browser.waitUntil(async () => {
    const shown = await browser.execute(() => {
      const surface = document.querySelector(".inkline-surface");
      if (!(surface instanceof HTMLCanvasElement))
        throw new Error("no surface");
      return window.inklineTest.pictures.inkRow(surface, 62, 0.35);
    });
    found = shown;
    const scaled =
      wanted === undefined ||
      ("scale" in wanted
        ? shown.scale === wanted.scale
        : shown.scale !== wanted.not);
    return scaled && shown.row.some((value) => value > 200);
  });
  if (found === undefined) throw new Error("no ink on the surface");
  return found;
}

/**
 * Checks the ink's edges in what the surface shows: at most four, and at
 * most three document pixels each, as the surface enlarges a sample of the
 * base layer with smoothing.
 */
function expectNarrowOnSurface({ row, scale }: ShownRow): void {
  const edges = partialRuns(row);
  expect(edges.length).toBeLessThanOrEqual(4);
  expect(Math.max(...edges)).toBeLessThanOrEqual(Math.ceil(3 * scale));
}

/**
 * Drops a dim H, `side` pixels square, makes ink of it at the default
 * threshold, and checks the preview, zoomed in and as usual, the ink applied,
 * the saved symbol's row through its stems, and that reopening draws it the
 * same.
 */
async function checkDimClarity(side: number): Promise<void> {
  await browser.execute(async (n) => {
    const surface = document.querySelector(".inkline-surface");
    if (!(surface instanceof HTMLCanvasElement)) throw new Error("no surface");
    const { pictures } = window.inklineTest;
    pictures.drop(
      surface,
      new File([await pictures.dimPicture(n)], "dim-h.png", {
        type: "image/png",
      }),
    );
  }, side);
  await browser.$('[data-inkline-button="ink"]').waitForEnabled();
  await browser.$('[data-inkline-button="ink"]').click();
  await browser.$('[data-inkline-button="apply"]').waitForEnabled();
  const preview = await shownRow();
  await saveScreenshot(`dim-conversion-preview-${String(side)}`);
  await browser.$('[data-inkline-button="zoom"]').click();
  const zoomed = await shownRow({ not: preview.scale });
  await saveScreenshot(`dim-conversion-zoomed-${String(side)}`);
  await browser.$('[data-inkline-button="zoom"]').click();
  await shownRow({ scale: preview.scale });
  await browser.$('[data-inkline-button="apply"]').click();
  await browser
    .$('[data-inkline-button="apply"]')
    .waitForDisplayed({ reverse: true });
  const applied = await shownRow({ scale: preview.scale });
  await saveScreenshot(`dim-conversion-applied-${String(side)}`);
  await browser.keys(["Control", "Enter"]);
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
  const result = await browser.executeObsidian(async ({ app }) => {
    const file = app.vault.getFileByPath("001.ink.png");
    if (file === null) throw new Error("no saved ink");
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    const { canvas, render } = window.inklineTest;
    const opened = await canvas.openInk(bytes);
    if (opened.kind !== "editable" || opened.base === undefined)
      throw new Error("no base");
    const saved = await canvas.decodePng(bytes);
    const pixels = canvas.readPixels(saved);
    saved.close();
    const y = Math.floor(
      opened.base.y / 16 + (opened.base.height * opened.base.scale) / 4,
    );
    const profile = (data: Uint8ClampedArray, width: number) => {
      const row = [];
      for (let x = 0; x < width; x++)
        row.push(data[(y * width + x) * 4 + 3] ?? 0);
      return row;
    };
    const surface = new OffscreenCanvas(pixels.width, pixels.height);
    const context = surface.getContext("2d");
    if (context === null) throw new Error("no context");
    render.drawInk(context, opened.document.strokes, opened.base);
    const reopened = context.getImageData(0, 0, pixels.width, pixels.height);
    return {
      row: profile(pixels.data, pixels.width),
      reopened: profile(reopened.data, pixels.width),
    };
  });
  const edges = partialRuns(result.row);
  console.log(
    `Dim ${String(side)}-pixel H`,
    JSON.stringify({
      saved: edges,
      preview: partialRuns(preview.row),
      previewScale: preview.scale,
      zoomed: partialRuns(zoomed.row),
      zoomedScale: zoomed.scale,
      applied: partialRuns(applied.row),
      row: result.row,
    }),
  );
  expect(result.reopened).toEqual(result.row);
  // Four vertical edges, at most two antialiased document pixels each, as a
  // black H on white has.
  expect(edges.length).toBeLessThanOrEqual(4);
  expect(Math.max(...edges)).toBeLessThanOrEqual(2);
  expect(result.row.filter((value) => value === 255).length).toBeGreaterThan(8);
  expectNarrowOnSurface(preview);
  expectNarrowOnSurface(zoomed);
  expectNarrowOnSurface(applied);
}

/**
 * Drops a black H on white, `side` pixels square, makes ink of it, and checks
 * the saved symbol's row through its stems, and that reopening draws it the
 * same.
 */
async function checkClarity(side: number): Promise<void> {
  await browser.execute(async (n) => {
    const surface = document.querySelector(".inkline-surface");
    if (!(surface instanceof HTMLCanvasElement)) throw new Error("no surface");
    const { pictures } = window.inklineTest;
    const at = (sixteenths: number) => Math.round((sixteenths * n) / 16);
    const bar = Math.max(1, at(2));
    const picture = await pictures.picture(n, n, "white", [
      { x: at(4), y: 0, width: bar, height: n, colour: "black" },
      { x: at(10), y: 0, width: bar, height: n, colour: "black" },
      {
        x: at(4),
        y: at(7),
        width: at(10) + bar - at(4),
        height: bar,
        colour: "black",
      },
    ]);
    pictures.drop(
      surface,
      new File([picture], "small-h.png", { type: "image/png" }),
    );
  }, side);
  await browser.$('[data-inkline-button="ink"]').waitForEnabled();
  await browser.$('[data-inkline-button="ink"]').click();
  await browser.$('[data-inkline-button="apply"]').waitForEnabled();
  await saveScreenshot(`enlarged-conversion-preview-${String(side)}`);
  await browser.$('[data-inkline-button="apply"]').click();
  await browser
    .$('[data-inkline-button="apply"]')
    .waitForDisplayed({ reverse: true });
  await browser.keys(["Control", "Enter"]);
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
  const result = await browser.executeObsidian(async ({ app }) => {
    const file = app.vault.getFileByPath("001.ink.png");
    if (file === null) throw new Error("no saved ink");
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    const { canvas, render } = window.inklineTest;
    const opened = await canvas.openInk(bytes);
    if (opened.kind !== "editable" || opened.base === undefined)
      throw new Error("no base");
    const saved = await canvas.decodePng(bytes);
    const pixels = canvas.readPixels(saved);
    saved.close();
    const y = Math.floor(
      opened.base.y / 16 + (opened.base.height * opened.base.scale) / 4,
    );
    const profile = (data: Uint8ClampedArray, width: number) => {
      const row = [];
      for (let x = 0; x < width; x++)
        row.push(data[(y * width + x) * 4 + 3] ?? 0);
      return row;
    };
    const surface = new OffscreenCanvas(pixels.width, pixels.height);
    const context = surface.getContext("2d");
    if (context === null) throw new Error("no context");
    render.drawInk(context, opened.document.strokes, opened.base);
    const reopened = context.getImageData(0, 0, pixels.width, pixels.height);
    const row = profile(pixels.data, pixels.width);
    return {
      row,
      reopened: profile(reopened.data, pixels.width),
      partial: row.filter((v) => v > 0 && v < 255).length,
      scale: opened.base.scale,
      width: opened.base.width,
    };
  });
  console.log(`Converted ${String(side)}-pixel H`, JSON.stringify(result));
  expect(result.reopened).toEqual(result.row);
  // Four vertical edges, at most two antialiased document pixels each.
  const edges = result.row
    .map((value) => (value > 0 && value < 255 ? "p" : " "))
    .join("")
    .split(" ")
    .filter((run) => run !== "");
  expect(edges.length).toBeLessThanOrEqual(4);
  expect(Math.max(...edges.map((run) => run.length))).toBeLessThanOrEqual(2);
  expect(result.partial).toBeLessThanOrEqual(8);
  expect(result.row.filter((value) => value === 255).length).toBeGreaterThan(8);
}
