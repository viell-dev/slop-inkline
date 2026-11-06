import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SmoothStroke, Stroke } from "../../../src/format/record.ts";
import {
  cornerReach,
  cutBoxes,
  outlineBounds,
  restShape,
  polygonPieces,
  strokeBounds,
  strokeOutline,
  strokePoints,
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

describe("strokePoints", () => {
  it("converts units to pixels", () => {
    const stroke: Stroke = {
      tool: "pen",
      size: 32,
      points: [16, 32, -8, 0],
    };
    expect(strokePoints(stroke)).toEqual([
      [1, 2],
      [-0.5, 0],
    ]);
  });
});

describe("strokeOutline", () => {
  /** How far the curve an outline traces lies from a point, as it goes. */
  function radii(outline: Outline, x: number, y: number): number[] {
    const distances: number[] = [];
    let from: readonly [number, number] = [0, 0];
    const sink: PathSink = {
      moveTo: (startX, startY) => {
        from = [startX, startY];
      },
      lineTo: () => undefined,
      closePath: () => undefined,
      quadraticCurveTo: (cx, cy, toX, toY) => {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const u = 1 - t;
          distances.push(
            Math.hypot(
              u * u * from[0] + 2 * u * t * cx + t * t * toX - x,
              u * u * from[1] + 2 * u * t * cy + t * t * toY - y,
            ),
          );
        }
        from = [toX, toY];
      },
    };
    traceOutline(outline, sink);
    return distances;
  }

  it("draws a single point as a circle on it, as wide as the stroke", () => {
    for (const size of [16, 96, 160, 1024]) {
      const outline = strokeOutline({ tool: "pen", size, points: [800, 800] });
      for (const radius of radii(outline, 50, 50)) {
        expect(radius / (size / 32)).toBeCloseTo(1, 3);
      }
    }
  });

  it("draws points that are all one point as the same circle", () => {
    const one = strokeOutline({ tool: "pen", size: 96, points: [800, 800] });
    for (const count of [2, 3, 7]) {
      const points = new Array<number[]>(count).fill([800, 800]).flat();
      expect(strokeOutline({ tool: "pen", size: 96, points })).toEqual(one);
    }
  });

  it("keeps the size of a stroke without pressure", () => {
    const outline = strokeOutline({
      tool: "pen",
      size: 160,
      points: [0, 800, 1600, 800, 3200, 800],
    });
    const bounds = outlineBounds(outline);
    expect((bounds?.bottom ?? 0) - (bounds?.top ?? 0)).toBeCloseTo(10, 0);
  });

  // The pinned outlines change only when the outline's algorithm changes,
  // which would change how saved symbols look when reopened. Before the first
  // stable release, a deliberate change updates this file with a changelog
  // note; from then on, it needs a new pinned file and a format note.
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
): Stroke {
  return {
    tool: "pen",
    size: width * 16,
    points: corners.flatMap(([x, y]) => [x * 16, y * 16]),
    kind: "polygon",
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
      false,
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
    expect(polygonPieces([], 2, false)).toEqual([]);
  });
});

describe("a filled stroke", () => {
  it("is one piece through its points, leaving out repeated ones", () => {
    const filled: Stroke = {
      tool: "eraser",
      points: [0, 0, 160, 0, 160, 0, 80, 128, 0, 0],
      kind: "fill",
    };
    expect(strokeShape(filled)).toEqual({
      kind: "pieces",
      pieces: [
        [
          [0, 0],
          [10, 0],
          [5, 8],
          [0, 0],
        ],
      ],
    });
  });

  it("reaches its corners and no farther", () => {
    const triangle: Stroke = {
      tool: "pen",
      points: [0, 0, 1600, 0, 800, 1600, 0, 0],
      kind: "fill",
    };
    expect(strokeBounds(triangle)).toEqual({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
    });
  });
});

describe("strokeBounds", () => {
  it("is the outline's bounds for a stroke drawn as the pointer went", () => {
    const stroke: Stroke = {
      tool: "pen",
      size: 160,
      points: [0, 800, 1600, 800],
    };
    expect(strokeBounds(stroke)).toEqual(outlineBounds(strokeOutline(stroke)));
  });
});

describe("strokeBounds of a cut stroke", () => {
  // Up, then a short way back: what is left once its end is cut is drawn
  // again in the box, and reaches past the whole stroke's outline.
  const stroke: SmoothStroke = {
    tool: "pen",
    size: 320,
    points: [16000, 5728, 16800, 2528, 16640, 3328],
    cut: { end: "up" },
  };

  it("takes in what the rest of it draws inside its cut boxes", () => {
    const whole = outlineBounds(strokeOutline(stroke));
    const bounds = strokeBounds(stroke);
    const [box] = cutBoxes(stroke);
    const rest = restShape(stroke);
    if (
      whole === undefined ||
      bounds === undefined ||
      box === undefined ||
      rest?.kind !== "smooth"
    ) {
      throw new Error("no shape");
    }
    const reach = outlineBounds(rest.outline);
    if (reach === undefined) throw new Error("no rest");
    // The rest runs right through the box, and past the whole stroke's top,
    // which on its own would put the stroke below the line box.
    expect(reach.top).toBeLessThan(box.top);
    expect(whole.top).toBeGreaterThan(192);
    expect(bounds.top).toBe(box.top);
    expect(bounds.top).toBeLessThan(192);
  });

  it("takes in nothing of the rest beyond its cut boxes", () => {
    const [box] = cutBoxes(stroke);
    const whole = outlineBounds(strokeOutline(stroke));
    const bounds = strokeBounds(stroke);
    if (box === undefined || whole === undefined || bounds === undefined) {
      throw new Error("no shape");
    }
    expect(bounds.top).toBeGreaterThanOrEqual(Math.min(whole.top, box.top));
    expect(bounds.bottom).toBeLessThanOrEqual(
      Math.max(whole.bottom, box.bottom),
    );
  });

  it("is the outline's alone for a stroke without cuts", () => {
    const { cut: _, ...plain } = stroke;
    expect(strokeBounds(plain)).toEqual(outlineBounds(strokeOutline(plain)));
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
    // Right along a 2 px brush from (1, 1) to (5, 1) px.
    const stroke: Stroke = {
      tool: "pen",
      size: 32,
      points: [16, 16, 80, 16],
      cut: { start: "left", end: "right" },
    };
    expect(cutBoxes(stroke)).toEqual([
      { left: -2, right: 1, top: -2, bottom: 4 },
      { left: 5, right: 8, top: -2, bottom: 4 },
    ]);
  });

  it("takes nothing from a stroke without cuts", () => {
    expect(cutBoxes({ tool: "pen", size: 32, points: [16, 16] })).toEqual([]);
  });
});

describe("uncutRest", () => {
  // Down a 1 px brush, one point a pixel, for 10 px.
  const points = Array.from({ length: 11 }, (_, at) => [16, at * 16]).flat();
  const stroke: SmoothStroke = { tool: "pen", size: 16, points };

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

  it("leaves nothing of a short stroke, or of one without cuts", () => {
    expect(
      uncutRest({ ...stroke, size: 96, cut: { start: "up", end: "down" } }),
    ).toBeUndefined();
    expect(uncutRest(stroke)).toBeUndefined();
  });
});
