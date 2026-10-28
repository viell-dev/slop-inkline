import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  editorGrid,
  openAtMarker,
  settledSurface,
  startOver,
  storedDrafts,
  surface,
  symbolFiles,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** A stroke's points as `x, y` pairs, in units. */
function pairs(points: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let at = 0; at + 1 < points.length; at += 2) {
    out.push([points[at] ?? 0, points[at + 1] ?? 0]);
  }
  return out;
}

/** The box a stroke's points fill, and how far each is off its ellipse. */
function fit(points: readonly number[]): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** The most any point is off the ellipse filling the box, as a fraction. */
  off: number;
  closed: boolean;
} {
  const all = pairs(points);
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const off = Math.max(
    ...all.map(([x, y]) =>
      Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1),
    ),
  );
  const [first] = all;
  const last = all.at(-1);
  return {
    left,
    right,
    top,
    bottom,
    off,
    closed: first?.[0] === last?.[0] && first?.[1] === last?.[1],
  };
}

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

/** The strokes of the editor's draft, once it holds `count` of them. */
async function draftStrokes(
  count: number,
): Promise<{ tool: string; points: readonly number[] }[]> {
  await browser.waitUntil(
    async () => ((await storedDrafts())[0]?.strokes.length ?? 0) === count,
  );
  const [draft] = await storedDrafts();
  return draft?.strokes ?? [];
}

describe("Ellipse", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  after(async function () {
    await startOver();
  });

  it("draws an ellipse across the box dragged with O, then freehand again", async function () {
    await openEditor();
    await browser.keys("o");
    expect(await pressed("ellipse")).toBe("true");
    expect(await pressed("pen")).toBe("true");
    await draw([
      [0.3, 0.3],
      [0.45, 0.4],
      [0.6, 0.7],
    ]);
    await saveScreenshot("ellipse", browser.$(".inkline-editor"));
    const [ellipse] = await draftStrokes(1);
    const shape = fit(ellipse?.points ?? []);
    console.log("Ellipse", JSON.stringify(shape));
    expect(ellipse?.tool).toBe("pen");
    expect(shape.closed).toBe(true);
    expect(shape.off).toBeLessThan(0.02);
    // The box is 0.3 of the surface across and 0.4 down, at one scale.
    const { width, height } = await settledSurface();
    const expected = (0.3 * width) / (0.4 * height);
    const ratio = (shape.right - shape.left) / (shape.bottom - shape.top);
    expect(Math.abs(ratio / expected - 1)).toBeLessThan(0.05);
    // O again draws freehand.
    await browser.keys("o");
    expect(await pressed("ellipse")).toBe("false");
    await draw([
      [0.2, 0.5],
      [0.25, 0.6],
    ]);
    const [, free] = await draftStrokes(2);
    expect(fit(free?.points ?? []).closed).toBe(false);
  });

  it("draws a circle while Shift is held", async function () {
    await openEditor();
    await browser.$('[data-inkline-button="ellipse"]').click();
    expect(await pressed("ellipse")).toBe("true");
    const { width, height } = await settledSurface();
    const canvas = await surface().getElement();
    const at = (x: number, y: number) => ({
      origin: canvas,
      x: Math.round((x - 0.5) * width),
      y: Math.round((y - 0.5) * height),
    });
    await browser.actions([
      browser
        .action("key")
        .down(Key.Shift)
        .pause(10)
        .pause(10)
        .pause(10)
        .pause(10)
        .up(Key.Shift),
      browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move(at(0.3, 0.2))
        .down()
        .move({ ...at(0.4, 0.5), duration: 50 })
        .move({ ...at(0.45, 0.8), duration: 50 })
        .up(),
    ]);
    const [circle] = await draftStrokes(1);
    const shape = fit(circle?.points ?? []);
    console.log("Circle", JSON.stringify(shape));
    expect(shape.closed).toBe(true);
    expect(shape.off).toBeLessThan(0.02);
    const across = shape.right - shape.left;
    const down = shape.bottom - shape.top;
    expect(Math.abs(across / down - 1)).toBeLessThan(0.01);
  });

  it("puts an ellipse's box on the grid, with the eraser too", async function () {
    await openEditor();
    await browser.keys(["Shift", "g"]);
    await browser.keys("o");
    await browser.keys("e");
    expect(await pressed("ellipse")).toBe("true");
    expect(await pressed("eraser")).toBe("true");
    await draw([
      [0.31, 0.27],
      [0.5, 0.5],
      [0.62, 0.73],
    ]);
    const [erased] = await draftStrokes(1);
    expect(erased?.tool).toBe("eraser");
    const shape = fit(erased?.points ?? []);
    const { spacing, rows } = await editorGrid();
    const units = rows.map((row) => Math.round(row * 16));
    console.log("On the grid", JSON.stringify({ shape, spacing, units }));
    expect(shape.closed).toBe(true);
    expect(units).toContain(shape.top);
    expect(units).toContain(shape.bottom);
    const columns = (shape.right - shape.left) / (spacing * 16);
    expect(Math.abs(columns - Math.round(columns))).toBeLessThan(0.01);
    expect(Math.round(columns)).toBeGreaterThan(0);
  });

  it("keeps Ellipse on through Next", async function () {
    await openEditor();
    await browser.keys("o");
    await draw([
      [0.3, 0.3],
      [0.6, 0.7],
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
    await waitForEditor();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await pressed("ellipse")).toBe("true");
  });
});
