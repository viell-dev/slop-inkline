import { browser, expect } from "@wdio/globals";
import { unitsPerPixel } from "../../../src/format/record.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  settledSurface,
  startOver,
  storedDrafts,
  surface,
  symbolFiles,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

async function openEditor(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
}

async function zoomPressed(): Promise<string | null> {
  return browser.$('[data-inkline-button="zoom"]').getAttribute("aria-pressed");
}

/** The drawing area's size in CSS pixels, once it stops changing. */
async function surfaceSize(): Promise<{ width: number; height: number }> {
  return settledSurface();
}

/**
 * How many document pixels the drawing area shows across: the line box is
 * as tall as it is, so its width over its height, times the box's height.
 */
async function shownAcross(): Promise<number> {
  const { width, height } = await surfaceSize();
  return (width / height) * lineBox.height;
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

describe("Zoom", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  after(async function () {
    await startOver();
  });

  it("shows the drawing taller with Z or the button, as far as the window allows", async function () {
    await openEditor();
    const usual = await surfaceSize();
    expect(await zoomPressed()).toBe("false");
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    await browser.waitUntil(
      async () => (await surfaceSize()).height > usual.height * 1.3,
    );
    const zoomed = await surfaceSize();
    expect(await zoomPressed()).toBe("true");
    expect(zoomed.width).toBe(usual.width);
    const limit = await browser.execute(() => window.innerHeight * 0.55);
    // Twice as tall, or as tall as the window allows.
    expect(zoomed.height).toBeLessThanOrEqual(
      Math.max(limit, usual.height) + 1,
    );
    expect(
      Math.abs(zoomed.height - usual.height * 2) < 2 ||
        Math.abs(zoomed.height - limit) < 2,
    ).toBe(true);
    await saveScreenshot("zoom-in");
    await browser.$('[data-inkline-button="zoom"]').click();
    await waitForStatus("Zoomed out");
    await browser.waitUntil(
      async () => Math.abs((await surfaceSize()).height - usual.height) < 1,
    );
    expect(await zoomPressed()).toBe("false");
  });

  it("maps the pointer to the drawing at either size, about the same middle", async function () {
    await openEditor();
    const middle = await tap(0.5, 0.5);
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    const across = await shownAcross();
    const again = await tap(0.5, 0.5);
    // The middle stays where it was, to a pixel of rounding.
    expect(Math.abs(again.x - middle.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(again.y - middle.y)).toBeLessThanOrEqual(1.5);
    // A quarter of the way across is a quarter of what the surface shows.
    const right = await tap(0.75, 0.25);
    expect(Math.abs(right.x - again.x - across / 4)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(right.y - lineBox.height / 4)).toBeLessThanOrEqual(1.5);
    // Shown larger, the drawing is still one line of text tall.
    expect(across).toBeLessThan(4.5 * lineBox.pxPerEm * 0.75);
  });

  it("moves along the drawing with the wheel and the arrow keys", async function () {
    await openEditor();
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    const across = await shownAcross();
    const start = await tap(0.5, 0.5);
    await browser.keys("ArrowRight");
    const arrowed = await tap(0.5, 0.5);
    expect(Math.abs(arrowed.x - start.x - across / 4)).toBeLessThanOrEqual(1.5);
    const { width } = await surfaceSize();
    await browser
      .action("wheel")
      .scroll({ origin: await surface().getElement(), deltaY: 100 })
      .perform();
    await browser.pause(100);
    const wheeled = await tap(0.5, 0.5);
    expect(
      Math.abs(wheeled.x - arrowed.x - (100 / width) * across),
    ).toBeLessThanOrEqual(1.5);
    await browser.keys("ArrowLeft");
    const back = await tap(0.5, 0.5);
    expect(Math.abs(back.x - wheeled.x + across / 4)).toBeLessThanOrEqual(1.5);
  });

  it("centres the drawing with Fit, staying zoomed", async function () {
    await openEditor();
    // A short stroke left of the middle.
    await draw([
      [0.2, 0.5],
      [0.3, 0.5],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const points = (await storedDrafts())[0]?.strokes[0]?.points ?? [];
    const centre =
      ((points[0] ?? 0) + (points.at(-2) ?? 0)) / 2 / unitsPerPixel;
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    for (let step = 0; step < 6; step++) await browser.keys("ArrowRight");
    await browser.keys("f");
    await browser.pause(200);
    expect(await zoomPressed()).toBe("true");
    const middle = await tap(0.5, 0.5);
    // Fit centres the drawing's ink with its side bearings, to a few pixels.
    expect(Math.abs(middle.x - centre)).toBeLessThanOrEqual(12);
  });

  it("keeps the zoom for the next symbol", async function () {
    await openEditor();
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    const zoomed = await surfaceSize();
    await draw([
      [0.4, 0.4],
      [0.6, 0.6],
    ]);
    await browser.keys(["Control", "Shift", "Enter"]);
    // The first symbol is saved, and a blank editor opens for the next.
    await browser.waitUntil(async () =>
      (await symbolFiles()).includes("001.ink.png"),
    );
    await waitForEditor();
    await browser.waitUntil(async () => (await storedDrafts()).length === 0);
    await browser.waitUntil(async () => (await zoomPressed()) === "true");
    expect(Math.abs((await surfaceSize()).height - zoomed.height)).toBeLessThan(
      2,
    );
  });
});
