import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  drawHoldingShift,
  openAtMarker,
  settledSurface,
  startOver,
  storedDrafts,
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
    // Shift goes down before the press and up after the release.
    await drawHoldingShift([
      [0.3, 0.2],
      [0.4, 0.5],
      [0.45, 0.8],
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
});
