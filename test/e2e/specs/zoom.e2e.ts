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

/** How wide the preview shows the symbol, in CSS pixels, and its font size. */
async function previewWidth(): Promise<{ width: number; fontSize: number }> {
  return browser.execute(() => {
    const ink = document.querySelector(".inkline-editor .inkline-preview-ink");
    const line = document.querySelector(".inkline-editor .inkline-preview");
    if (!(ink instanceof HTMLCanvasElement) || !(line instanceof HTMLElement)) {
      throw new Error("no preview");
    }
    return {
      width: Number.parseFloat(ink.style.width),
      fontSize: Number.parseFloat(getComputedStyle(line).fontSize),
    };
  });
}

/** How many of the preview's pixels hold ink. */
async function previewInk(): Promise<number> {
  return browser.execute(() => {
    const ink = document.querySelector(".inkline-editor .inkline-preview-ink");
    if (!(ink instanceof HTMLCanvasElement)) throw new Error("no preview");
    const context = ink.getContext("2d");
    if (context === null) throw new Error("no context");
    const { data } = context.getImageData(0, 0, ink.width, ink.height);
    let count = 0;
    for (let index = 3; index < data.length; index += 4) {
      if ((data[index] ?? 0) > 0) count++;
    }
    return count;
  });
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

  it("keeps the preview and the image's edges whole when zoomed and moved along", async function () {
    await openEditor();
    // Wider than the zoomed view shows.
    await draw([
      [0.08, 0.5],
      [0.5, 0.5],
      [0.92, 0.5],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    await browser.pause(200);
    const usual = await previewWidth();
    const inked = await previewInk();
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    await browser.pause(200);
    expect(Math.abs((await previewWidth()).width - usual.width)).toBeLessThan(
      1,
    );
    for (let step = 0; step < 8; step++) await browser.keys("ArrowRight");
    await browser.pause(200);
    const moved = await previewWidth();
    expect(Math.abs(moved.width - usual.width)).toBeLessThan(1);
    // Still the whole symbol, not the part in view.
    expect(await previewInk()).toBeGreaterThan(inked * 0.9);
    // The saved image is as wide as the preview said.
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    const saved = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no saved symbol");
      const bitmap = await window.inklineTest.canvas.decodePng(
        new Uint8Array(await app.vault.readBinary(file)),
      );
      const { width } = bitmap;
      bitmap.close();
      return width;
    });
    const expected = (usual.width * lineBox.pxPerEm) / usual.fontSize;
    expect(Math.abs(saved - expected)).toBeLessThanOrEqual(1.5);
  });

  it("keeps its middle through repeated zooming", async function () {
    await openEditor();
    const start = await tap(0.5, 0.5);
    for (let step = 0; step < 20; step++) await browser.keys("z");
    await waitForStatus("Zoomed out");
    const end = await tap(0.5, 0.5);
    expect(Math.abs(end.x - start.x)).toBeLessThanOrEqual(1);
    // Where the window limits the zoom to a width of no whole number of
    // pixels, as an 803-pixel surface in a 768-pixel window does, rounding
    // moved the middle a pixel each time: the view alone, a hundred times.
    const middle = await browser.execute(() => {
      const view = new window.inklineTest.view.InkView(createEl("canvas"));
      view.resize(803, 1);
      const before = view.center;
      for (let round = 0; round < 100; round++) {
        view.heightLimit = 768 * 0.55;
        view.magnified = true;
        view.resize(803, 1);
        view.magnified = false;
        view.resize(803, 1);
      }
      return { before, after: view.center };
    });
    expect(middle.after).toBe(middle.before);
  });

  it("measures and previews the ink as a save crops it, however far away its erasers go", async function () {
    const result = await browser.execute(async () => {
      const { view, canvas, record } = window.inklineTest;
      const surface = createEl("canvas");
      document.body.append(surface);
      try {
        const dot = (x: number, tool: "pen" | "eraser", size: number) => ({
          tool,
          size: size * record.unitsPerPixel,
          pressure: false,
          points: [x * record.unitsPerPixel, 100 * record.unitsPerPixel],
        });
        /** What the view and a save make of a document, as the editor shows it. */
        const compare = async (
          strokes: ReturnType<typeof dot>[],
          fontSize: number,
        ) => {
          const document = { strokes };
          const ink = new view.InkView(surface);
          const xs = strokes.map((stroke) => (stroke.points[0] ?? 0) / 16);
          ink.fit(Math.min(...xs), Math.max(...xs));
          ink.resize(803, 1);
          ink.render(document, undefined, undefined);
          const preview = createEl("canvas");
          ink.drawPreview(preview, fontSize);
          const context = preview.getContext("2d");
          if (context === null) throw new Error("no context");
          const { data } = context.getImageData(
            0,
            0,
            preview.width,
            preview.height,
          );
          // Ink in the first and the last tenth of the preview's columns.
          const inkIn = (from: number, to: number) => {
            for (let y = 0; y < preview.height; y++) {
              for (let x = from; x < to; x++) {
                if ((data[(y * preview.width + x) * 4 + 3] ?? 0) > 0) {
                  return true;
                }
              }
            }
            return false;
          };
          const tenth = Math.max(1, Math.floor(preview.width / 10));
          const saved = await canvas.saveInk(document, undefined, []);
          return {
            image: ink.image,
            saved: { left: saved.left, width: saved.record.box.width },
            any: inkIn(0, preview.width),
            first: inkIn(0, tenth),
            last: inkIn(preview.width - tenth, preview.width),
          };
        };
        return {
          // A pen dot, and a tiny eraser a quarter of a million pixels away.
          distant: await compare(
            [dot(100, "pen", 10), dot(-262144, "eraser", 1)],
            16,
          ),
          // Two dots far apart, at a size whose preview height is fractional.
          apart: await compare([dot(100, "pen", 10), dot(2100, "pen", 10)], 17),
        };
      } finally {
        surface.remove();
      }
    });
    for (const [name, found] of Object.entries(result)) {
      // The edges the view shows are where a save crops.
      expect([name, found.image.left]).toEqual([name, found.saved.left]);
      expect([name, found.image.right - found.image.left]).toEqual([
        name,
        found.saved.width,
      ]);
    }
    expect(result.distant.any).toBe(true);
    expect([result.apart.first, result.apart.last]).toEqual([true, true]);
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
    await browser.execute(() => {
      document
        .querySelector(".inkline-editor")
        ?.setAttribute("data-inkline-first", "");
    });
    await browser.keys(["Control", "Shift", "Enter"]);
    // The first editor gives way to a blank one for the next symbol.
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
    expect(await zoomPressed()).toBe("true");
    expect(Math.abs((await surfaceSize()).height - zoomed.height)).toBeLessThan(
      2,
    );
    // And it saves a second symbol.
    await draw([
      [0.4, 0.6],
      [0.6, 0.4],
    ]);
    await browser.keys(["Control", "Enter"]);
    await browser.waitUntil(async () => (await symbolFiles()).length === 2);
  });
});
