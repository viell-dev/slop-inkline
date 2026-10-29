import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Stroke } from "../../../src/format/record.ts";
import {
  cornerReach,
  cutBoxes,
  outlineBounds,
  outlineInput,
  polygonPieces,
  restShape,
  strokeBounds,
  strokeOutline,
  strokeShape,
  traceOutline,
  traceShape,
  uncutRest,
  type Outline,
  type PathSink,
  type StrokeShape,
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

/** A polygon stroke through `corners`, in pixels, `width` pixels wide. */
function polygon(
  corners: readonly (readonly [number, number])[],
  width: number,
  cut?: Stroke["cut"],
): Stroke {
  return {
    tool: "pen",
    size: width * 16,
    pressure: false,
    points: corners.flatMap(([x, y]) => [x * 16, y * 16]),
    kind: "polygon",
    ...(cut === undefined ? {} : { cut }),
  };
}

/** The pieces of a shape, which a polygon's always is. */
function piecesOf(shape: StrokeShape | undefined): readonly Outline[] {
  if (shape?.kind !== "pieces") throw new Error("not a polygon's pieces");
  return shape.pieces;
}

/** Twice a polygon's signed area. */
function area(outline: Outline): number {
  let sum = 0;
  outline.forEach(([x0, y0], index) => {
    const [x1, y1] = outline[(index + 1) % outline.length] ?? [x0, y0];
    sum += x0 * y1 - x1 * y0;
  });
  return sum;
}

/**
 * Whether filling the pieces with the nonzero rule covers a point: its
 * winding number around them all, which are convex and wind one way.
 */
function covers(pieces: readonly Outline[], x: number, y: number): boolean {
  return pieces.some((piece) =>
    piece.every(([x0, y0], index) => {
      const [x1, y1] = piece[(index + 1) % piece.length] ?? [x0, y0];
      return (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0) >= 0;
    }),
  );
}

describe("polygon strokes", () => {
  it("draw a single corner as a square dot as wide as the stroke", () => {
    expect(strokeBounds(polygon([[1, 1]], 2))).toEqual({
      left: 0,
      top: 0,
      right: 2,
      bottom: 2,
    });
  });

  it("draw a side with square ends, half the width past each corner", () => {
    expect(
      strokeBounds(
        polygon(
          [
            [1, 1],
            [5, 1],
          ],
          2,
        ),
      ),
    ).toEqual({ left: 0, top: 0, right: 6, bottom: 2 });
  });

  it("make a right-angled corner sharp on its outer side", () => {
    const pieces = piecesOf(
      strokeShape(
        polygon(
          [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
          2,
        ),
      ),
    );
    // Two sides and the corner's wedge, all wound one way.
    expect(pieces).toHaveLength(3);
    for (const piece of pieces) expect(area(piece)).toBeGreaterThan(0);
    // Round, the corner would not reach (10.9, -0.9), 1.27 from the corner.
    expect(covers(pieces, 10.9, -0.9)).toBe(true);
    expect(covers(pieces, 11.1, -0.9)).toBe(false);
    expect(covers(pieces, 10.9, -1.1)).toBe(false);
    // Inside the turn, the sides meet without filling past their edges.
    expect(covers(pieces, 8.9, 1.1)).toBe(false);
    expect(covers(pieces, 9.1, 0.9)).toBe(true);
  });

  it("cut a sharper corner's point off twice the width past the corner", () => {
    // Out 20 px and back to 2 px below the start: a turn of about 174°.
    const pieces = piecesOf(
      strokeShape(
        polygon(
          [
            [0, 0],
            [20, 0],
            [0, 2],
          ],
          2,
        ),
      ),
    );
    expect(cornerReach).toBe(2);
    // Uncut, the point would reach 20 px past the corner.
    expect(outlineBounds(pieces.flat())?.right).toBeCloseTo(24, 1);
    // Along the corner's bisector, the sides' directions' difference.
    const [bx, by] = [1 + 20 / Math.hypot(20, 2), -2 / Math.hypot(20, 2)];
    const length = Math.hypot(bx, by);
    const reach = Math.max(
      ...pieces.flat().map(([x, y]) => ((x - 20) * bx + y * by) / length),
    );
    expect(reach).toBeCloseTo(4, 9);
  });

  it("square off a side that doubles back on itself at twice the width", () => {
    const pieces = piecesOf(
      strokeShape(
        polygon(
          [
            [0, 0],
            [10, 0],
            [0, 0],
          ],
          2,
        ),
      ),
    );
    expect(outlineBounds(pieces.flat())).toEqual({
      left: -1,
      top: -1,
      right: 14,
      bottom: 1,
    });
    expect(covers(pieces, 13.9, 0.9)).toBe(true);
  });

  it("close a polygon whose last corner is its first, with every corner sharp", () => {
    const square = polygon(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      2,
      { start: "up", end: "up" },
    );
    const pieces = piecesOf(strokeShape(square));
    // Four sides and four corners: no ends.
    expect(pieces).toHaveLength(8);
    for (const [x, y] of [
      [-0.9, -0.9],
      [10.9, -0.9],
      [10.9, 10.9],
      [-0.9, 10.9],
    ] as const) {
      expect(covers(pieces, x, y)).toBe(true);
    }
    expect(covers(pieces, 5, 5)).toBe(false);
    expect(covers(pieces, -1.1, 5)).toBe(false);
    // A closed polygon has no ends to cut.
    expect(cutBoxes(square)).toEqual([]);
    expect(restShape(square)).toBeUndefined();
  });

  it("leave a polygon open when it comes back to its start with two corners", () => {
    // Out and back: three points, the last the first, but not a shape.
    const pieces = piecesOf(
      strokeShape(
        polygon(
          [
            [0, 0],
            [10, 0],
            [0, 0],
          ],
          2,
        ),
      ),
    );
    // Its square ends reach past the start.
    expect(outlineBounds(pieces.flat())?.left).toBe(-1);
  });

  it("ignore a corner repeated in a row", () => {
    expect(
      strokeShape(
        polygon(
          [
            [0, 0],
            [0, 0],
            [10, 0],
            [10, 0],
          ],
          2,
        ),
      ),
    ).toEqual(
      strokeShape(
        polygon(
          [
            [0, 0],
            [10, 0],
          ],
          2,
        ),
      ),
    );
  });

  it("stay finite and close to their sides where corners barely turn", () => {
    // From the independent review of #121: a corner on the line between its
    // neighbours, whose directions' dot product rounds to 1, made infinite
    // pieces, and saving never finished.
    const reviewed: Stroke = {
      tool: "pen",
      size: 192,
      pressure: false,
      points: [0, 0, 16, 144, 256, 2304],
      kind: "polygon",
    };
    const bounds = strokeBounds(reviewed);
    expect(bounds?.left).toBeCloseTo(-6.626, 3);
    expect(bounds?.top).toBeCloseTo(-6.626, 3);
    expect(bounds?.right).toBeCloseTo(22.626, 3);
    expect(bounds?.bottom).toBeCloseTo(150.626, 3);
    // Corners in a line, as units put them, every way round.
    for (let a = -40; a <= 40; a += 3) {
      for (let b = -40; b <= 40; b += 7) {
        if (a === 0 && b === 0) continue;
        for (const k of [2, 3, 16, -1]) {
          const points = [0, 0, a, b, a * k, b * k];
          const pieces = piecesOf(
            strokeShape({ ...reviewed, size: 16, points }),
          ).flat();
          const xs = points.filter((_, at) => at % 2 === 0).map((x) => x / 16);
          const ys = points.filter((_, at) => at % 2 === 1).map((y) => y / 16);
          // Within the corners' box, grown by what a corner cut at twice the
          // width can reach along an axis: twice the width along its
          // bisector, and half the width across it.
          const grow = Math.hypot(2, 0.5) + 1e-9;
          for (const [x, y] of pieces) {
            expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - grow);
            expect(x).toBeLessThanOrEqual(Math.max(...xs) + grow);
            expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - grow);
            expect(y).toBeLessThanOrEqual(Math.max(...ys) + grow);
          }
        }
      }
    }
  });

  it("wind every piece one way far from the origin", () => {
    // From the independent review of #121, within the format's limits.
    const pieces = polygonPieces(
      [
        [1_000_000, 1_000_000],
        [1_000_001, 1_000_001],
        [1_000_002, 1_000_002.0625],
      ],
      0.0625,
      { closed: false, start: true, end: true },
    );
    expect(pieces).toHaveLength(3);
    for (const piece of pieces) {
      const [ox, oy] = piece[0] ?? [0, 0];
      expect(
        area(piece.map(([x, y]) => [x - ox, y - oy] as const)),
      ).toBeGreaterThan(0);
    }
  });

  it("give nothing for no corners, or a lone corner with flat ends", () => {
    const shape = { closed: false, start: false, end: false };
    expect(polygonPieces([], 2, shape)).toEqual([]);
    expect(polygonPieces([[1, 1]], 2, shape)).toEqual([]);
  });

  it("leave the rest of a cut polygon in its cut boxes, flat where it was cut", () => {
    // Down 20 px with a 1 px brush, cut at its end.
    const down = polygon(
      [
        [0, 0],
        [0, 20],
      ],
      1,
      { end: "down" },
    );
    expect(outlineBounds(piecesOf(restShape(down)).flat())).toEqual({
      left: -0.5,
      top: -0.5,
      right: 0.5,
      bottom: 18,
    });
    const both = polygon(
      [
        [0, 0],
        [0, 20],
      ],
      1,
      { start: "up", end: "down" },
    );
    expect(outlineBounds(piecesOf(restShape(both)).flat())).toEqual({
      left: -0.5,
      top: 2,
      right: 0.5,
      bottom: 18,
    });
    // Twice the width from each end leaves nothing of 3 px.
    expect(
      restShape(
        polygon(
          [
            [0, 0],
            [0, 3],
          ],
          1,
          { start: "up", end: "down" },
        ),
      ),
    ).toBeUndefined();
    expect(
      restShape(
        polygon(
          [
            [0, 0],
            [0, 20],
          ],
          1,
        ),
      ),
    ).toBeUndefined();
  });

  it("keep the corners of a cut polygon's rest, and its sharp corners", () => {
    // Down 10 px, right 10 px, and down 10 px again, cut at both ends.
    const step = polygon(
      [
        [0, 0],
        [0, 10],
        [10, 10],
        [10, 20],
      ],
      1,
      { start: "up", end: "down" },
    );
    const rest = piecesOf(restShape(step));
    // Three sides and two corners.
    expect(rest).toHaveLength(5);
    expect(outlineBounds(rest.flat())).toEqual({
      left: -0.5,
      top: 2,
      right: 10.5,
      bottom: 18,
    });
    expect(covers(rest, -0.45, 10.45)).toBe(true);
  });

  it("take its cut boxes from its ends, as a stroke's", () => {
    expect(
      cutBoxes(
        polygon(
          [
            [1, 1],
            [5, 1],
          ],
          2,
          { start: "left", end: "right" },
        ),
      ),
    ).toEqual([
      { left: -2, right: 1, top: -2, bottom: 4 },
      { left: 5, right: 8, top: -2, bottom: 4 },
    ]);
  });
});

describe("strokeBounds", () => {
  it("is the outline's bounds for a stroke drawn as the pointer went", () => {
    const stroke: Stroke = {
      tool: "pen",
      size: 160,
      pressure: false,
      points: [0, 800, 1600, 800],
    };
    expect(strokeBounds(stroke)).toEqual(outlineBounds(strokeOutline(stroke)));
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
      lineTo: (x, y) => calls.push(`L ${String(x)} ${String(y)}`),
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
      lineTo: () => calls.push("L"),
      quadraticCurveTo: () => calls.push("Q"),
      closePath: () => calls.push("Z"),
    });
    expect(calls).toEqual([]);
  });
});

describe("traceShape", () => {
  it("draws each of a polygon's pieces with straight sides", () => {
    const calls: string[] = [];
    traceShape(
      {
        kind: "pieces",
        pieces: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
          ],
          [],
          [
            [5, 5],
            [6, 5],
            [6, 6],
          ],
        ],
      },
      {
        moveTo: (x, y) => calls.push(`M ${String(x)} ${String(y)}`),
        lineTo: (x, y) => calls.push(`L ${String(x)} ${String(y)}`),
        quadraticCurveTo: () => calls.push("Q"),
        closePath: () => calls.push("Z"),
      },
    );
    expect(calls).toEqual([
      "M 0 0",
      "L 2 0",
      "L 2 2",
      "Z",
      "M 5 5",
      "L 6 5",
      "L 6 6",
      "Z",
    ]);
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
