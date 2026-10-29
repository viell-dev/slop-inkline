import { browser, expect } from "@wdio/globals";
import type { Stroke } from "../../../src/format/record.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  recordOf,
  settledSurface,
  startOver,
  storedDrafts,
  surface,
  symbolFiles,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

async function pressed(id: string): Promise<string | null> {
  return browser
    .$(`[data-inkline-button="${id}"]`)
    .getAttribute("aria-pressed");
}

async function openEditor(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
}

/**
 * Clicks the surface at each point, as fractions of its width and height
 * from its top left corner.
 */
async function click(
  ...points: readonly (readonly [number, number])[]
): Promise<void> {
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

/** The strokes of the editor's draft, once it holds `count` of them. */
async function draftStrokes(
  count: number,
): Promise<{ tool: string; points: readonly number[]; kind?: string }[]> {
  await browser.waitUntil(
    async () => ((await storedDrafts())[0]?.strokes.length ?? 0) === count,
  );
  const [draft] = await storedDrafts();
  return draft?.strokes ?? [];
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
 * The saved symbol's alpha at the middle of each of its strokes' points,
 * where a filled shape is inked and an outline alone is not; the inked
 * pixels below each stroke's lowest point, across its points' width; and how
 * many pixels differ from a redraw of its record.
 */
async function middles(): Promise<{
  alpha: number[];
  below: number[];
  redrawn: number;
}> {
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
    const surface = new OffscreenCanvas(width, height);
    const context = surface.getContext("2d");
    if (context === null) throw new Error("no context");
    render.drawInk(context, opened.document.strokes, undefined);
    const again = context.getImageData(0, 0, width, height).data;
    let redrawn = 0;
    for (let at = 3; at < again.length; at += 4) {
      if (Math.abs((again[at] ?? 0) - (saved.data[at] ?? 0)) > 1) redrawn++;
    }
    const at = (x: number, y: number): number =>
      saved.data[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] ?? 0;
    const extents = opened.document.strokes.map(({ points }) => {
      const xs = points.filter((_, index) => index % 2 === 0);
      const ys = points.filter((_, index) => index % 2 === 1);
      return {
        left: Math.min(...xs) / 16,
        right: Math.max(...xs) / 16,
        top: Math.min(...ys) / 16,
        bottom: Math.max(...ys) / 16,
      };
    });
    const alpha = extents.map(({ left, right, top, bottom }) =>
      at((left + right) / 2, (top + bottom) / 2),
    );
    const below = extents.map(({ left, right, bottom }) => {
      let count = 0;
      for (let y = Math.ceil(bottom); y < height; y++) {
        for (let x = Math.floor(left); x < Math.ceil(right); x++) {
          if (at(x, y) > 0) count++;
        }
      }
      return count;
    });
    return { alpha, below, redrawn };
  });
}

describe("Fill", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  after(async function () {
    await startOver();
  });

  it("fills a polygon closed on its first corner, and not an open one", async function () {
    await openEditor();
    await browser.keys(["Shift", "g"]);
    await browser.keys("y");
    await browser.keys("b");
    expect(await pressed("fill")).toBe("true");
    // A triangle, closed; then a wedge left open, ended with Enter.
    await click([0.25, 0.75], [0.35, 0.3], [0.45, 0.75], [0.25, 0.75]);
    await click([0.6, 0.75], [0.7, 0.3], [0.8, 0.75]);
    await browser.keys("Enter");
    await draftStrokes(2);
    await saveScreenshot("fill", browser.$(".inkline-editor"));
    await save();
    const [triangle, wedge] = await savedStrokes();
    expect(triangle).toMatchObject({ kind: "polygon", fill: true });
    expect(wedge?.kind).toBe("polygon");
    expect(wedge).not.toHaveProperty("fill");
    const shown = await middles();
    console.log("Filled", JSON.stringify(shown));
    // The triangle's middle is inked; the open wedge's, between its legs,
    // is not.
    expect(shown.alpha[0]).toBeGreaterThan(200);
    expect(shown.alpha[1]).toBe(0);
    // The triangle sits on the row its base lies on, the baseline, with
    // nothing below; the wedge's legs are cut flush with it too.
    expect(shown.below).toEqual([0, 0]);
    expect(shown.redrawn).toBe(0);
  });

  it("erases a hole of an ellipse's shape from a filled block", async function () {
    await openEditor();
    await browser.keys("y");
    await browser.keys("b");
    await click(
      [0.3, 0.25],
      [0.7, 0.25],
      [0.7, 0.75],
      [0.3, 0.75],
      [0.3, 0.25],
    );
    await browser.keys("e");
    await browser.keys("o");
    // Fill stays on for Ellipse.
    expect(await pressed("fill")).toBe("true");
    await draw([
      [0.42, 0.4],
      [0.58, 0.6],
    ]);
    const [block, hole] = await draftStrokes(2);
    expect(block?.kind).toBe("polygon");
    expect(hole?.tool).toBe("eraser");
    await save();
    const shown = await middles();
    console.log("Hole", JSON.stringify(shown));
    // Both have the same middle, which the eraser's fill took away.
    expect(shown.alpha).toEqual([0, 0]);
    expect(shown.redrawn).toBe(0);
    // Between the hole and the block's edge, the block's fill is still there.
    const inked = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no saved ink");
      const bytes = new Uint8Array(await app.vault.readBinary(file));
      const { canvas } = window.inklineTest;
      const opened = await canvas.openInk(bytes);
      if (opened.kind !== "editable") throw new Error("not editable");
      const bitmap = await canvas.decodePng(bytes);
      const saved = canvas.readPixels(bitmap);
      bitmap.close();
      const [block] = opened.document.strokes;
      const points = block?.points ?? [];
      const xs = points.filter((_, at) => at % 2 === 0);
      const ys = points.filter((_, at) => at % 2 === 1);
      // A quarter of the way in from the block's left side, at its middle.
      const x = (Math.min(...xs) * 3 + Math.max(...xs)) / 64;
      const y = (Math.min(...ys) + Math.max(...ys)) / 32;
      return (
        saved.data[(Math.floor(y) * saved.width + Math.floor(x)) * 4 + 3] ?? 0
      );
    });
    expect(inked).toBeGreaterThan(200);
  });

  it("fills the middle of a star drawn in one line, by the nonzero rule", async function () {
    // From the independent review of #123: simple shapes fill the same by
    // either rule, so only a shape that crosses itself tells them apart.
    const shown = await browser.execute(() => {
      const { render } = window.inklineTest;
      // A five-pointed star, each corner two points on, round a centre at
      // (50, 50) px, 40 px out: its middle is wound twice.
      const points = [0, 2, 4, 1, 3, 0].flatMap((step) => {
        const angle = -Math.PI / 2 + (step * 2 * Math.PI) / 5;
        return [
          Math.round((50 + 40 * Math.cos(angle)) * 16),
          Math.round((50 + 40 * Math.sin(angle)) * 16),
        ];
      });
      const surface = new OffscreenCanvas(100, 100);
      const context = surface.getContext("2d");
      if (context === null) throw new Error("no context");
      render.drawInk(
        context,
        [
          {
            tool: "pen",
            size: 16,
            pressure: false,
            points,
            kind: "polygon",
            fill: true,
          },
        ],
        undefined,
      );
      const { data } = context.getImageData(0, 0, 100, 100);
      const at = (x: number, y: number): number =>
        data[(y * 100 + x) * 4 + 3] ?? 0;
      // The middle, a point inside an arm, and one outside between two arms.
      return [at(50, 52), at(50, 20), at(25, 25)];
    });
    console.log("Star", JSON.stringify(shown));
    expect(shown[0]).toBeGreaterThan(250);
    expect(shown[1]).toBeGreaterThan(250);
    expect(shown[2]).toBe(0);
  });

  it("is off while drawing freehand, and Next keeps it", async function () {
    await openEditor();
    const fill = browser.$('[data-inkline-button="fill"]');
    expect(await fill.isEnabled()).toBe(false);
    await browser.keys("b");
    await waitForStatus("Fill is for Ellipse and Polygon");
    expect(await pressed("fill")).toBe("false");
    await browser.keys("o");
    expect(await fill.isEnabled()).toBe(true);
    await fill.click();
    expect(await pressed("fill")).toBe("true");
    await draw([
      [0.3, 0.3],
      [0.6, 0.7],
    ]);
    await draftStrokes(1);
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
    await waitForEditor();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await pressed("ellipse")).toBe("true");
    expect(await pressed("fill")).toBe("true");
    const [ellipse] = await savedStrokes();
    expect(ellipse?.fill).toBe(true);
  });
});
