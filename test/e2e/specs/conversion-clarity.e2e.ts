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
});

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
