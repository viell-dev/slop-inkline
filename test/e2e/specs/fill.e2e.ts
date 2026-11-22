import { browser, expect } from "@wdio/globals";
import type { Stroke } from "../../../src/format/record.ts";
import { loadModules } from "../support/browser.ts";
import { pressed, save } from "../support/editing.ts";
import {
  draw,
  drawAndHold,
  hoverShifted,
  openAtMarker,
  recordOf,
  settledSurface,
  shiftClick,
  startOver,
  storedDrafts,
  surface,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import { framesDrawn } from "../support/waits.ts";

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
async function clickSurfacePoints(
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

/** A point on the surface, as fractions of its width and height. */
type At = readonly [number, number];

/** Drags from `from` to `to` and lets go there, as an ellipse is drawn. */
async function drag(from: At, to: At): Promise<void> {
  await draw([from, to]);
}

/**
 * Drags from `from` to `to` and lets go there, in one command, keeping what
 * the drawing area shows just before the release as `name`, as {@link keep}
 * does. It is read in the page as the release arrives, before the editor
 * takes it, as a read in a command of its own would come after the press had
 * already ended as a lost capture (#391).
 */
async function dragKeeping(from: At, to: At, name: string): Promise<void> {
  await browser.execute((kept) => {
    window.addEventListener(
      "pointerup",
      () => {
        window.inklineTest.shapeEdges.keepSurface(kept);
      },
      { capture: true, once: true },
    );
  }, name);
  await drawAndHold([from, to]);
}

/**
 * Keeps what the drawing area shows, once it has drawn its next frames, as
 * `name`, and returns how many of its pixels show ink.
 */
async function keep(name: string): Promise<number> {
  await framesDrawn();
  return browser.execute(
    (kept) => window.inklineTest.shapeEdges.keepSurface(kept),
    name,
  );
}

/** How many pixels the drawing area kept as `a` and as `b` differ in. */
async function pixelsApart(a: string, b: string): Promise<number> {
  return browser.execute(
    (first, second) => window.inklineTest.shapeEdges.pixelsApart(first, second),
    a,
    b,
  );
}

/** Hides the guides, so that the drawing area shows only the ink. */
async function hideGuides(): Promise<void> {
  await browser.keys("g");
  await browser.waitUntil(async () => (await pressed("guides")) === "false");
}

/**
 * Compares the drawing area kept as `filled` with `unfilled`, as
 * test/e2e/browser/shape-edges.ts does, and expects the filled shape to be
 * the unfilled one filled within: the same outer edge, pixel for pixel, and
 * everything within it as the line's middle is. `inside` is a point inside
 * the line.
 */
async function expectFilledWithin(
  unfilled: string,
  filled: string,
  tool: "pen" | "eraser",
  inside: At,
): Promise<void> {
  const compared = await browser.execute(
    (a, b, by, at) => window.inklineTest.shapeEdges.compareFill(a, b, by, at),
    unfilled,
    filled,
    tool,
    inside,
  );
  console.log(`${filled} against ${unfilled}`, JSON.stringify(compared));
  // Inside the line, what the line's middle is, where the line alone left
  // the opposite.
  expect(compared.middle).toEqual(tool === "pen" ? [0, 255] : [255, 0]);
  expect(compared.within).toBeGreaterThan(1000);
  expect(compared.withinUnlike).toBe(0);
  // The line keeps what it did.
  expect(compared.lineLess).toBe(0);
  // Outside it, the very same pixels, its partly inked edge among them.
  expect(compared.edge).toBeGreaterThan(100);
  expect(compared.outsideApart).toBe(0);
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
  it("fills a polygon closed on its first corner, and not an open one", async function () {
    await openEditor();
    await browser.keys(["Shift", "g"]);
    await browser.keys("y");
    await browser.keys("b");
    expect(await pressed("fill")).toBe("true");
    // A triangle, closed; then a wedge left open, ended with Enter.
    await shiftClick([0.25, 0.75], [0.35, 0.3], [0.45, 0.75], [0.25, 0.75]);
    await shiftClick([0.6, 0.75], [0.7, 0.3], [0.8, 0.75]);
    await browser.keys("Enter");
    await draftStrokes(3);
    await saveScreenshot("fill", browser.$(".inkline-editor"));
    await save();
    const [inside, sides, wedge] = await savedStrokes();
    // The triangle is its inside and its sides, through the same corners.
    expect(inside).toMatchObject({ kind: "fill" });
    expect(inside).not.toHaveProperty("size");
    expect(sides).toMatchObject({ kind: "polygon", points: inside?.points });
    expect(sides?.size).toBeGreaterThan(0);
    expect(wedge?.kind).toBe("polygon");
    const shown = await middles();
    console.log("Filled", JSON.stringify(shown));
    // The triangle's sides have its fill's points, so they read the same
    // pixels as its fill, the first of each below. Its middle is inked; the
    // open wedge's, between its legs, is not.
    expect(shown.alpha[0]).toBeGreaterThan(200);
    expect(shown.alpha[2]).toBe(0);
    // The triangle's sides reach past the row its base lies on, the
    // baseline, by half their width, as the wedge's legs' square ends do.
    expect(shown.below[0]).toBeGreaterThan(0);
    expect(shown.below[2]).toBeGreaterThan(0);
    expect(shown.redrawn).toBe(0);
  });

  it("draws a filled polygon as the polygon unfilled, filled within, shows it so before the click, and takes it back with one Undo", async function () {
    // From #342: a filled shape lost half the brush's width round it.
    await openEditor();
    await hideGuides();
    await browser.keys("4");
    await browser.keys("y");
    const corners = [
      [0.3, 0.8],
      [0.42, 0.2],
      [0.54, 0.8],
    ] as const;
    const [first] = corners;
    await clickSurfacePoints(...corners, first);
    const [unfilled] = await draftStrokes(1);
    expect(unfilled?.kind).toBe("polygon");
    expect(await keep("polygon unfilled")).toBeGreaterThan(0);
    await browser.keys(["Control", "z"]);
    await draftStrokes(0);
    expect(await keep("polygon undone")).toBe(0);

    await browser.keys("b");
    expect(await pressed("fill")).toBe("true");
    await clickSurfacePoints(...corners);
    // On its first corner, it shows what a click there leaves.
    await hoverShifted({ at: first, shift: false });
    await keep("polygon closing");
    await clickSurfacePoints(first);
    expect(await draftStrokes(2)).toEqual([
      { tool: "pen", points: unfilled?.points, kind: "fill" },
      unfilled,
    ]);
    await keep("polygon filled");
    await saveScreenshot("fill-polygon", browser.$(".inkline-editor"));
    expect(await pixelsApart("polygon closing", "polygon filled")).toBe(0);
    await expectFilledWithin(
      "polygon unfilled",
      "polygon filled",
      "pen",
      [0.42, 0.6],
    );

    // One Undo takes back all of it.
    await browser.keys(["Control", "z"]);
    await draftStrokes(0);
    expect(await keep("polygon filled, undone")).toBe(0);
  });

  it("draws a filled ellipse as the ellipse unfilled, filled within, shows it so while dragging, and takes it back with one Undo", async function () {
    await openEditor();
    await hideGuides();
    await browser.keys("4");
    await browser.keys("o");
    const from = [0.3, 0.25] as const;
    const to = [0.6, 0.75] as const;
    await drag(from, to);
    const [unfilled] = await draftStrokes(1);
    expect(unfilled).not.toHaveProperty("kind");
    expect(await keep("ellipse unfilled")).toBeGreaterThan(0);
    await browser.keys(["Control", "z"]);
    await draftStrokes(0);

    await browser.keys("b");
    expect(await pressed("fill")).toBe("true");
    // Before the release, it shows what letting go there leaves.
    await dragKeeping(from, to, "ellipse dragged");
    expect(await draftStrokes(2)).toEqual([
      { tool: "pen", points: unfilled?.points, kind: "fill" },
      unfilled,
    ]);
    await keep("ellipse filled");
    await saveScreenshot("fill-ellipse", browser.$(".inkline-editor"));
    expect(await pixelsApart("ellipse dragged", "ellipse filled")).toBe(0);
    await expectFilledWithin(
      "ellipse unfilled",
      "ellipse filled",
      "pen",
      [0.45, 0.5],
    );

    await browser.keys(["Control", "z"]);
    await draftStrokes(0);
    expect(await keep("ellipse filled, undone")).toBe(0);
  });

  it("erases a hole of an ellipse's shape from a filled block, out to the eraser line's edge", async function () {
    await openEditor();
    await hideGuides();
    await browser.keys("y");
    await browser.keys("b");
    await clickSurfacePoints(
      [0.2, 0.15],
      [0.8, 0.15],
      [0.8, 0.85],
      [0.2, 0.85],
      [0.2, 0.15],
    );
    await browser.keys("e");
    await browser.keys("4");
    await browser.keys("o");
    // Fill stays on for Ellipse.
    expect(await pressed("fill")).toBe("true");
    // The same ellipse unfilled first, to compare the hole with.
    const from = [0.42, 0.3] as const;
    const to = [0.58, 0.7] as const;
    await browser.keys("b");
    await drag(from, to);
    const [, , ring] = await draftStrokes(3);
    expect(ring?.tool).toBe("eraser");
    expect(ring).not.toHaveProperty("kind");
    await keep("hole unfilled");
    await browser.keys(["Control", "z"]);
    await draftStrokes(2);
    await browser.keys("b");
    await drag(from, to);
    const [block, sides, hole, round] = await draftStrokes(4);
    expect(block?.kind).toBe("fill");
    expect(sides?.kind).toBe("polygon");
    expect(hole).toEqual({
      tool: "eraser",
      points: ring?.points,
      kind: "fill",
    });
    expect(round).toEqual(ring);
    await keep("hole filled");
    await saveScreenshot("fill-hole", browser.$(".inkline-editor"));
    await expectFilledWithin(
      "hole unfilled",
      "hole filled",
      "eraser",
      [0.5, 0.5],
    );
    await save();
    const shown = await middles();
    console.log("Hole", JSON.stringify(shown));
    // All four have the same middle, which the eraser's fill took away.
    expect(shown.alpha).toEqual([0, 0, 0, 0]);
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
            points,
            kind: "fill",
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
});
