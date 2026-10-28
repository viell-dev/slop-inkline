import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Stroke } from "../../../src/format/record.ts";
import {
  cutBoxes,
  outlineBounds,
  outlineInput,
  strokeOutline,
  traceOutline,
  uncutRest,
  type PathSink,
} from "../../../src/ink/outline.ts";
import { pinnedStrokes } from "../../fixtures/outline/strokes.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/outline");

describe("outlineInput", () => {
  it("converts units to pixels and pressure to 0–1", () => {
    const stroke: Stroke = {
      tool: "pen",
      size: 32,
      pressure: true,
      points: [16, 32, 255, -8, 0, 0],
    };
    expect(outlineInput(stroke)).toEqual([
      [1, 2, 1],
      [-0.5, 0, 0],
    ]);
  });

  it("gives strokes without pressure the middle pressure", () => {
    const stroke: Stroke = {
      tool: "pen",
      size: 32,
      pressure: false,
      points: [16, 16],
    };
    expect(outlineInput(stroke)).toEqual([[1, 1, 0.5]]);
  });
});

describe("strokeOutline", () => {
  it("draws a round dot for a single point, about as wide as the stroke", () => {
    const bounds = outlineBounds(
      strokeOutline({
        tool: "pen",
        size: 160,
        pressure: false,
        points: [800, 800],
      }),
    );
    if (bounds === undefined) throw new Error("no outline");
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    // perfect-freehand's dots run a little wider than the stroke: 12 px here.
    expect(width).toBeGreaterThanOrEqual(10);
    expect(width).toBeLessThanOrEqual(12.5);
    expect(height).toBeCloseTo(width, 0);
    expect((bounds.left + bounds.right) / 2).toBeCloseTo(50, 0);
  });

  it("keeps the size of a stroke without pressure", () => {
    const outline = strokeOutline({
      tool: "pen",
      size: 160,
      pressure: false,
      points: [0, 800, 1600, 800, 3200, 800],
    });
    const bounds = outlineBounds(outline);
    expect((bounds?.bottom ?? 0) - (bounds?.top ?? 0)).toBeCloseTo(10, 0);
  });

  it("narrows a light pen stroke", () => {
    const at = (pressure: number): number => {
      const bounds = outlineBounds(
        strokeOutline({
          tool: "pen",
          size: 160,
          pressure: true,
          points: [0, 800, pressure, 1600, 800, pressure, 3200, 800, pressure],
        }),
      );
      return (bounds?.bottom ?? 0) - (bounds?.top ?? 0);
    };
    expect(at(0)).toBeLessThan(at(128));
    expect(at(128)).toBeLessThan(at(255));
  });

  // The pinned outlines change only when perfect-freehand or the options
  // change, which would change how saved symbols look when reopened. Before
  // the first stable release, a deliberate change updates this file with a
  // changelog note; from then on, it needs a new pinned file and a format note.
  it("matches the pinned outlines", async () => {
    const pinned: unknown = JSON.parse(
      await readFile(path.join(fixtures, "v1-outlines.json"), "utf8"),
    );
    const round = (value: number): number => Math.round(value * 1000) / 1000;
    const outlines = pinnedStrokes.map((stroke) =>
      strokeOutline(stroke).map(([x, y]) => [round(x), round(y)]),
    );
    expect(outlines).toEqual(pinned);
  });
});

describe("outlineBounds", () => {
  it("has none for an empty outline", () => {
    expect(outlineBounds([])).toBeUndefined();
  });
});

describe("traceOutline", () => {
  it("draws a closed curve through the edges' midpoints", () => {
    const calls: string[] = [];
    const sink: PathSink = {
      moveTo: (x, y) => calls.push(`M ${String(x)} ${String(y)}`),
      quadraticCurveTo: (cx, cy, x, y) =>
        calls.push(`Q ${String(cx)} ${String(cy)} ${String(x)} ${String(y)}`),
      closePath: () => calls.push("Z"),
    };
    traceOutline(
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      sink,
    );
    expect(calls).toEqual([
      "M 2 0",
      "Q 4 0 4 2",
      "Q 4 4 2 4",
      "Q 0 4 0 2",
      "Q 0 0 2 0",
      "Z",
    ]);
  });

  it("draws nothing for an empty outline", () => {
    const calls: string[] = [];
    traceOutline([], {
      moveTo: () => calls.push("M"),
      quadraticCurveTo: () => calls.push("Q"),
      closePath: () => calls.push("Z"),
    });
    expect(calls).toEqual([]);
  });
});

describe("cutBoxes", () => {
  it("takes a box past the line through each cut end, a brush and a pixel deep", () => {
    // Right along a 2 px brush from (1, 1) to (5, 1) px, with pressure.
    const stroke: Stroke = {
      tool: "pen",
      size: 32,
      pressure: true,
      points: [16, 16, 128, 80, 16, 255],
      cut: { start: "left", end: "right" },
    };
    expect(cutBoxes(stroke)).toEqual([
      { left: -2, right: 1, top: -2, bottom: 4 },
      { left: 5, right: 8, top: -2, bottom: 4 },
    ]);
  });

  it("takes nothing from a stroke without cuts", () => {
    expect(
      cutBoxes({ tool: "pen", size: 32, pressure: false, points: [16, 16] }),
    ).toEqual([]);
  });
});

describe("uncutRest", () => {
  // Down a 1 px brush, one point a pixel, for 10 px.
  const points = Array.from({ length: 11 }, (_, at) => [16, at * 16]).flat();
  const stroke: Stroke = { tool: "pen", size: 16, pressure: false, points };

  it("leaves out the points within twice the brush's width of each cut end", () => {
    expect(uncutRest({ ...stroke, cut: { start: "up" } })?.points).toEqual(
      points.slice(2 * 2),
    );
    expect(uncutRest({ ...stroke, cut: { end: "down" } })?.points).toEqual(
      points.slice(0, -2 * 2),
    );
    expect(
      uncutRest({ ...stroke, cut: { start: "up", end: "down" } }),
    ).toMatchObject({ tool: "pen", size: 16, points: points.slice(4, -4) });
  });

  it("keeps a point's pressure, and leaves nothing of a short stroke", () => {
    const pressed: Stroke = {
      tool: "eraser",
      size: 16,
      pressure: true,
      points: [0, 0, 9, 0, 32, 9, 0, 64, 9, 0, 96, 9],
      cut: { start: "up" },
    };
    expect(uncutRest(pressed)?.points).toEqual([0, 32, 9, 0, 64, 9, 0, 96, 9]);
    expect(
      uncutRest({ ...stroke, size: 96, cut: { start: "up", end: "down" } }),
    ).toBeUndefined();
    expect(uncutRest(stroke)).toBeUndefined();
  });
});
