import { browser, expect } from "@wdio/globals";
import type { Stroke } from "../../../src/format/record.ts";
import { loadModules } from "../support/browser.ts";
import {
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

/** Opens the editor for a new symbol, with Polygon on and the XL brush. */
async function openPolygon(grid: boolean): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
  await browser.keys("4");
  if (grid) {
    await browser.keys(["Shift", "g"]);
    await browser.waitUntil(async () => (await pressed("grid")) === "true");
  }
  await browser.keys("y");
  expect(await pressed("polygon")).toBe("true");
  expect(await pressed("pen")).toBe("true");
}

/**
 * Clicks the surface at each point, as fractions of its width and height
 * from its top left corner: a press and a release, with the pointer moved
 * there between them as a mouse is.
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
 * The saved symbol's alpha at points out from each corner of its first
 * stroke, a polygon, `near` and `far` widths out along each axis, away from
 * the middle of its corners; and how many pixels differ from a redraw of its
 * record.
 */
async function savedInk(
  near: number,
  far: number,
): Promise<{
  near: number[];
  far: number[];
  redrawn: number;
}> {
  return browser.executeObsidian(
    async ({ app }, near, far) => {
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
      const again = redraw(strokes);
      let redrawn = 0;
      for (let at = 3; at < again.length; at += 4) {
        if (Math.abs((again[at] ?? 0) - (saved.data[at] ?? 0)) > 1) redrawn++;
      }
      const alpha = (data: Uint8ClampedArray, x: number, y: number): number =>
        data[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] ?? 0;
      const [polygon] = strokes;
      const points = polygon?.points ?? [];
      const xs = points.filter((_, at) => at % 2 === 0).map((x) => x / 16);
      const ys = points.filter((_, at) => at % 2 === 1).map((y) => y / 16);
      const middleX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const middleY = (Math.min(...ys) + Math.max(...ys)) / 2;
      const stroke = (polygon?.size ?? 0) / 16;
      const out = (widths: number): number[] =>
        xs.map((x, index) => {
          const y = ys[index] ?? 0;
          return alpha(
            saved.data,
            x + Math.sign(x - middleX) * widths * stroke,
            y + Math.sign(y - middleY) * widths * stroke,
          );
        });
      return {
        near: out(near),
        far: out(far),
        redrawn,
      };
    },
    near,
    far,
  );
}

describe("Polygon", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  after(async function () {
    await startOver();
  });

  it("closes a rectangle on its first corner, with sharp corners in the saved image", async function () {
    await openPolygon(true);
    await click([0.35, 0.3], [0.65, 0.3], [0.65, 0.7], [0.35, 0.7]);
    // Nothing is committed until the shape is closed or ended.
    expect((await storedDrafts())[0]?.strokes ?? []).toEqual([]);
    await click([0.35, 0.3]);
    await saveScreenshot("polygon", browser.$(".inkline-editor"));
    const [rectangle] = await draftStrokes(1);
    expect(rectangle?.kind).toBe("polygon");
    const points = rectangle?.points ?? [];
    expect(points).toHaveLength(10);
    expect(points.slice(-2)).toEqual(points.slice(0, 2));
    // Polygon stays on for the next shape.
    expect(await pressed("polygon")).toBe("true");
    await save();
    const [saved] = await savedStrokes();
    expect(saved?.kind).toBe("polygon");
    expect(saved).not.toHaveProperty("cut");
    // 0.4 widths out along each axis is 0.57 widths from the corner point,
    // past a round corner's 0.5, inside a sharp one; 0.6 is past both.
    const ink = await savedInk(0.4, 0.6);
    console.log("Rectangle", JSON.stringify(ink));
    for (const alpha of ink.near) expect(alpha).toBeGreaterThan(200);
    for (const alpha of ink.far) expect(alpha).toBeLessThan(10);
    expect(ink.redrawn).toBe(0);
  });

  it("takes back corners with Undo, ends open with Enter, and drops a shape with Esc", async function () {
    await openPolygon(false);
    const undo = browser.$('[data-inkline-button="undo"]');
    expect(await undo.isEnabled()).toBe(false);
    await click([0.3, 0.4]);
    // Undo takes back the corner, and with it the shape.
    expect(await undo.isEnabled()).toBe(true);
    await undo.click();
    expect(await undo.isEnabled()).toBe(false);
    await click([0.3, 0.4], [0.5, 0.4], [0.5, 0.7]);
    await browser.keys(["Control", "z"]);
    await click([0.4, 0.7]);
    await browser.keys("Enter");
    const [open] = await draftStrokes(1);
    expect(open?.kind).toBe("polygon");
    // The corners clicked but the one taken back: the last is below the
    // first two, and between them across.
    const [ax = 0, ay = 0, bx = 0, , dx = 0, dy = 0] = open?.points ?? [];
    expect(open?.points).toHaveLength(6);
    expect(dx).toBeGreaterThan(ax);
    expect(dx).toBeLessThan(bx);
    expect(dy).toBeGreaterThan(ay);
    await click([0.6, 0.3], [0.7, 0.5]);
    await browser.keys("Escape");
    await waitForStatus("Polygon dropped");
    expect(await browser.$(".inkline-editor").isExisting()).toBe(true);
    expect(await draftStrokes(1)).toHaveLength(1);
    // Clear, from its key, drops a shape being placed with the drawing.
    await click([0.6, 0.3], [0.7, 0.5]);
    await browser.keys("Delete");
    await draftStrokes(0);
    await click([0.2, 0.2], [0.2, 0.2]);
    const [dot] = await draftStrokes(1);
    expect(dot?.points).toHaveLength(2);
  });

  it("saves a polygon whose corner barely turns", async function () {
    // From the independent review of #121: a corner on the line between its
    // neighbours made infinite pieces, and saving never finished.
    const saved = await browser.execute(async () => {
      const { canvas } = window.inklineTest;
      const { record } = await canvas.saveInk(
        {
          strokes: [
            {
              tool: "pen",
              size: 192,
              pressure: false,
              points: [400, 800, 416, 944, 656, 3104],
              kind: "polygon",
            },
          ],
        },
        undefined,
        [],
      );
      return record.box.width;
    });
    // 15 px across, the stroke's 12 px width, and the side bearings.
    expect(saved).toBeGreaterThan(40);
    expect(saved).toBeLessThan(60);
  });

  it("keeps an open shape's square ends on the grid, uncut", async function () {
    await openPolygon(true);
    // Up from one point and down to another, as the legs of an A, ended on
    // the last corner.
    await click([0.4, 0.75], [0.5, 0.25], [0.6, 0.75], [0.6, 0.75]);
    const [legs] = await draftStrokes(1);
    expect(legs?.kind).toBe("polygon");
    expect(legs?.points).toHaveLength(6);
    await save();
    const [saved] = await savedStrokes();
    expect(saved).not.toHaveProperty("cut");
    const ink = await savedInk(0.4, 0.6);
    console.log("Legs", JSON.stringify(ink));
    expect(ink.redrawn).toBe(0);
  });

  it("draws a polygon that ends beside its first side whole", async function () {
    // The owner's pentagon from #126, as 0.3.0-alpha.8 saved it: its end one
    // cell along its first side, cut there, which took ink from that side.
    const shown = await browser.execute(() => {
      const { render } = window.inklineTest;
      const cell = 14 * 16;
      const baseline = 144 * 16;
      const start = 80 * 16;
      const points = [
        [0, 0],
        [-3, 0],
        [-4, 2],
        [-2, 4],
        [0, 2],
        [-1, 0],
      ].flatMap(([column = 0, row = 0]) => [
        start + column * cell,
        baseline - row * cell,
      ]);
      const stroke = {
        tool: "pen" as const,
        size: 192,
        pressure: false,
        points,
        kind: "polygon" as const,
      };
      const row = (drawn: typeof stroke): number[] => {
        const surface = new OffscreenCanvas(128, 192);
        const context = surface.getContext("2d");
        if (context === null) throw new Error("no context");
        render.drawInk(context, [drawn], undefined);
        const { data } = context.getImageData(0, 150 - 1, 128, 1);
        return Array.from({ length: 128 }, (_, x) => data[x * 4 + 3] ?? 0);
      };
      return {
        cut: row({ ...stroke, cut: { start: "right", end: "down" } } as never),
        uncut: row(stroke),
        from: Math.round((start - 3 * cell) / 16),
        to: Math.round(start / 16),
      };
    });
    console.log("Pentagon", JSON.stringify({ ...shown, cut: undefined }));
    // A row 5 pixels below the baseline, inside the first side's lower half.
    const side = shown.cut.slice(shown.from, shown.to);
    expect(Math.min(...side)).toBeGreaterThanOrEqual(250);
    expect(shown.cut).toEqual(shown.uncut);
  });

  it("takes the eraser chosen while placing, and keeps Polygon on through Next", async function () {
    await openPolygon(false);
    await click([0.3, 0.3]);
    await browser.keys("e");
    await click([0.6, 0.6], [0.6, 0.6]);
    const [erased] = await draftStrokes(1);
    expect(erased?.tool).toBe("eraser");
    expect(erased?.points).toHaveLength(4);
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
    expect(await pressed("polygon")).toBe("true");
    await browser.keys("y");
    expect(await pressed("polygon")).toBe("false");
  });
});
