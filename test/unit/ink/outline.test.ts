import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SmoothStroke, Stroke } from "../../../src/format/record.ts";
import type { FreehandShape } from "../../../src/ink/freehand.ts";
import {
  cornerReach,
  cutBoxes,
  outlineBounds,
  restShape,
  polygonPieces,
  smoothShape,
  strokeBounds,
  strokePoints,
  strokeShape,
  traceOutline,
  traceShape,
  uncutRest,
  type Outline,
  type PathSink,
  type StrokeShape,
} from "../../../src/ink/outline.ts";
import { pinnedOutlines, pinnedPieces } from "../../fixtures/outline/pinned.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/outline");

/** The outline of a smooth stroke that is not a dot. */
function outlineOf(stroke: SmoothStroke): Outline {
  const shape = smoothShape(stroke);
  if (shape.kind !== "smooth") throw new Error("a dot has no outline");
  return shape.outline;
}

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

describe("smoothShape", () => {
  it("draws a single point as a circle on it, as wide as the stroke", () => {
    for (const size of [1, 16, 96, 160, 1024, 65_536]) {
      expect(smoothShape({ tool: "pen", size, points: [800, 816] })).toEqual({
        kind: "dot",
        center: [50, 51],
        radius: size / 32,
      });
    }
  });

  it("draws points that are all one point as the same circle", () => {
    const one = smoothShape({ tool: "pen", size: 96, points: [800, 800] });
    for (const count of [2, 3, 7]) {
      const points = new Array<number[]>(count).fill([800, 800]).flat();
      expect(smoothShape({ tool: "pen", size: 96, points })).toEqual(one);
    }
  });

  it("draws a stroke whose path comes back to its start as that dot", () => {
    // Out and back, within its own width: the middle point is left out to
    // steady the stroke, and the last is where it began.
    const out = {
      tool: "pen",
      size: 320,
      points: [800, 800, 960, 800, 800, 800],
    };
    expect(smoothShape(out as SmoothStroke)).toEqual({
      kind: "dot",
      center: [50, 50],
      radius: 10,
    });
  });

  it("keeps the size of a stroke without pressure", () => {
    const outline = outlineOf({
      tool: "pen",
      size: 160,
      points: [0, 800, 1600, 800, 3200, 800],
    });
    const bounds = outlineBounds(outline);
    expect((bounds?.bottom ?? 0) - (bounds?.top ?? 0)).toBeCloseTo(10, 0);
  });

  // The pinned shapes change only when the steps change, which would change
  // how saved symbols look when reopened. Before the first stable release, a
  // deliberate change updates these files with a changelog note; from then on,
  // it needs a new pinned file and a format note.
  it("matches the pinned outlines", async () => {
    const pinned: unknown = JSON.parse(
      await readFile(path.join(fixtures, "v1-outlines.json"), "utf8"),
    );
    expect(pinnedOutlines()).toEqual(pinned);
  });

  it("matches the pinned polygon pieces and cut strokes' rests", async () => {
    const pinned: unknown = JSON.parse(
      await readFile(path.join(fixtures, "v1-pieces.json"), "utf8"),
    );
    expect(pinnedPieces()).toEqual(pinned);
  });

  it("settles a turn of exactly a right angle by the format's arithmetic", () => {
    // The samples either side of the middle one are exactly at right angles,
    // so the comparison that chooses a half circle is a tie. Multiplying by
    // a reciprocal, rather than dividing, rounds the product to just below
    // zero and draws a shape about 6 pixels away from this one.
    const size = 192;
    const corners = (x: number): number =>
      outlineOf({
        tool: "pen",
        size,
        points: [3840, 256, x, 2496, 160, 2096],
      }).length;
    expect(corners(4160)).toBe(48);
    expect(corners(4161)).toBe(74);
    expect(corners(4159)).toBe(48);
  });

  it("keeps its end when repeats shrink a step to nothing", () => {
    // A point level with the first, repeated: the step towards it shrinks until
    // squaring it gives 0, between points that still differ.
    const repeats = (count: number): number[] =>
      new Array<number[]>(count).fill([160, 0]).flat();
    for (const count of [300, 440, 450, 600, 2000]) {
      const ending: SmoothStroke = {
        tool: "pen",
        size: 96,
        points: [0, 0, 160, 480, ...repeats(count)],
      };
      const goingOn: SmoothStroke = {
        ...ending,
        points: [...ending.points, 1600, 0, 3200, 160],
      };
      for (const stroke of [ending, goingOn]) {
        expect(outlineOf(stroke).flat().every(Number.isFinite)).toBe(true);
        const bounds = Object.values(strokeBounds(stroke) ?? {});
        expect(bounds).toHaveLength(4);
        expect(bounds.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("has at most 28 corners for a point, however it doubles back", () => {
    // The worst a record can ask for, which is what limits.points bounds: every
    // point a sharp corner, with a half circle on each side, and the two ends.
    for (const count of [10, 1000, 5000]) {
      const points = Array.from({ length: count }, (_, index) => [
        index % 2 === 0 ? 0 : 1024,
        1024,
      ]).flat();
      const outline = outlineOf({ tool: "pen", size: 16, points });
      expect(outline.length).toBeGreaterThan(26 * count);
      expect(outline.length).toBeLessThanOrEqual(28 * count + 42);
    }
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

describe("uncutRest", () => {
  it("stops a walk that lands exactly on twice the brush's width", () => {
    // Steps of exactly 5 units, by 3 and 4 across and down, so the sum meets
    // twice the width of 5 on the second step, and no rounding may change it.
    const rest = uncutRest({
      tool: "pen",
      size: 5,
      points: [0, 0, 3, 4, 6, 8, 9, 12, 12, 16],
      cut: { start: "up" },
    });
    expect(rest?.points).toEqual([6, 8, 9, 12, 12, 16]);
  });
});

describe("strokeBounds", () => {
  it("is exactly the circle's for a dot", () => {
    expect(
      strokeBounds({ tool: "pen", size: 160, points: [800, 800] }),
    ).toEqual({ left: 45, top: 45, right: 55, bottom: 55 });
  });

  it("is the outline's bounds for a stroke drawn as the pointer went", () => {
    const stroke: Stroke = {
      tool: "pen",
      size: 160,
      points: [0, 800, 1600, 800],
    };
    expect(strokeBounds(stroke)).toEqual(outlineBounds(outlineOf(stroke)));
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
    const whole = outlineBounds(outlineOf(stroke));
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
    const whole = outlineBounds(outlineOf(stroke));
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
    expect(strokeBounds(plain)).toEqual(outlineBounds(outlineOf(plain)));
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
      arc: () => calls.push("A"),
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
      arc: () => calls.push("A"),
      closePath: () => calls.push("Z"),
    });
    expect(calls).toEqual([]);
  });
});

describe("traceShape", () => {
  it("draws a dot as a circle, not a curve near one", () => {
    const calls: string[] = [];
    traceShape(
      { kind: "dot", center: [3, 4], radius: 2 },
      {
        moveTo: (x, y) => calls.push(`M ${String(x)} ${String(y)}`),
        lineTo: () => calls.push("L"),
        quadraticCurveTo: () => calls.push("Q"),
        arc: (x, y, radius, start, end) =>
          calls.push(
            `A ${String(x)} ${String(y)} ${String(radius)} ${String(start)} ${String(end / Math.PI)}`,
          ),
        closePath: () => calls.push("Z"),
      },
    );
    expect(calls).toEqual(["M 5 4", "A 3 4 2 0 2", "Z"]);
  });

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
        arc: () => calls.push("A"),
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
    // Down a 2 px brush from (1, 1) to (1, 5) px.
    const stroke: Stroke = {
      tool: "pen",
      size: 32,
      points: [16, 16, 16, 80],
      cut: { start: "up", end: "down" },
    };
    expect(cutBoxes(stroke)).toEqual([
      { left: -2, right: 4, top: -2, bottom: 1 },
      { left: -2, right: 4, top: 5, bottom: 8 },
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

describe("a stroke moved by whole units", () => {
  /** The stroke's points moved so that the first lies at (`x`, `y`). */
  function movedTo<T extends Stroke>(stroke: T, x: number, y: number): T {
    const [firstX = 0, firstY = 0] = stroke.points;
    return {
      ...stroke,
      points: stroke.points.map((value, index) =>
        index % 2 === 0 ? value - firstX + x : value - firstY + y,
      ),
    };
  }

  /** Places that round differently, on and off the grid of pixels. */
  const places: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [16, 0],
    [-256, 0],
    [758, 2044],
    [1014, 2044],
    [12345, -6789],
    [2 ** 24 - 7000, 2 ** 23 + 3],
    [-(2 ** 24) + 7000, -(2 ** 24) + 7000],
  ];

  /** Strokes that are hard to keep the same, seeded, each from (0, 0). */
  function smoothStrokes(): SmoothStroke[] {
    let state = 0x51f217ab;
    const next = (range: number): number => {
      state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
      return (state >>> 8) % range;
    };
    const strokes: SmoothStroke[] = [
      { tool: "pen", size: 192, points: [1014, 2044, 214, 2364, 490, 2068] },
      { tool: "pen", size: 192, points: [3840, 256, 4160, 2496, 160, 2096] },
    ];
    for (let index = 0; index < 400; index++) {
      // A turn of about a right angle, where a tie decides the shape.
      const [dx, dy] = [next(2000) + 16, next(2000) + 16];
      const scale = next(5) + 1;
      strokes.push({
        tool: "pen",
        size: 16 * (next(24) + 1),
        points: [0, 0, dx, dy, dx + dy * scale, dy - dx * scale],
      });
    }
    for (let index = 0; index < 400; index++) {
      const points = [0, 0];
      const count = next(20) + 1;
      for (let point = 0; point < count; point++) {
        points.push(next(4001) - 2000, next(4001) - 2000);
      }
      strokes.push({ tool: "pen", size: next(600) + 1, points });
    }
    return strokes.map((stroke) => movedTo(stroke, 0, 0));
  }

  it("moves a smooth stroke's outline exactly, whatever rounding it meets", () => {
    /** Whether `moved` is `shape`, each number moved by (`ox`, `oy`) exactly. */
    const isMoved = (
      shape: FreehandShape,
      moved: FreehandShape,
      ox: number,
      oy: number,
    ): boolean => {
      if (shape.kind === "dot" || moved.kind === "dot") {
        return (
          shape.kind === moved.kind &&
          moved.kind === "dot" &&
          moved.center[0] === ox &&
          moved.center[1] === oy
        );
      }
      return (
        moved.outline.length === shape.outline.length &&
        shape.outline.every(([cx, cy], index) => {
          const [mx, my] = moved.outline[index] ?? [];
          return mx === cx + ox && my === cy + oy;
        })
      );
    };
    const reshaped: { points: readonly number[]; x: number; y: number }[] = [];
    for (const stroke of smoothStrokes()) {
      const shape = smoothShape(stroke);
      for (const [x, y] of places) {
        const moved = smoothShape(movedTo(stroke, x, y));
        if (!isMoved(shape, moved, x / 16, y / 16)) {
          reshaped.push({ points: stroke.points, x, y });
        }
      }
    }
    expect(reshaped).toEqual([]);
  });

  it("has the same corners wherever a tie falls", () => {
    const stroke: SmoothStroke = {
      tool: "pen",
      size: 192,
      points: [1014, 2044, 214, 2364, 490, 2068],
    };
    expect(outlineOf(stroke)).toHaveLength(48);
    expect(outlineOf(movedTo(stroke, 758, 2044))).toHaveLength(48);
  });

  it("moves a dot, and a cut stroke's boxes and rest, with their points", () => {
    const dot: SmoothStroke = { tool: "pen", size: 96, points: [800, 800] };
    expect(smoothShape(movedTo(dot, 816, 800))).toEqual({
      kind: "dot",
      center: [51, 50],
      radius: 3,
    });
    const cut: SmoothStroke = {
      tool: "pen",
      size: 96,
      points: [800, 800, 1000, 1400, 1500, 1500, 2100, 1400, 2300, 800],
      cut: { start: "up", end: "down" },
    };
    const rest = restShape(cut);
    if (rest?.kind !== "smooth") throw new Error("the rest is not an outline");
    for (const [x, y] of places) {
      const moved = movedTo(cut, x, y);
      const [dx, dy] = [(x - 800) / 16, (y - 800) / 16];
      expect(cutBoxes(moved)).toEqual(
        cutBoxes(cut).map(({ left, top, right, bottom }) => ({
          left: left + dx,
          top: top + dy,
          right: right + dx,
          bottom: bottom + dy,
        })),
      );
      const movedRest = restShape(moved);
      if (movedRest?.kind !== "smooth") throw new Error("no outline");
      expect(movedRest.outline).toHaveLength(rest.outline.length);
      movedRest.outline.forEach(([px, py], index) => {
        const [qx = 0, qy = 0] = rest.outline[index] ?? [];
        expect(px - qx).toBeCloseTo(dx, 6);
        expect(py - qy).toBeCloseTo(dy, 6);
      });
    }
  });

  it("moves a polygon's pieces and a fill's corners with their points", () => {
    const strokes: Stroke[] = [
      {
        tool: "pen",
        size: 96,
        kind: "polygon",
        points: [192, 2304, 576, 1024, 960, 2304, 192, 2304],
      },
      {
        tool: "pen",
        size: 64,
        kind: "polygon",
        points: [1264, 1000, 1564, 2200, 1864, 1000, 2164, 2200],
      },
      { tool: "pen", kind: "fill", points: [0, 0, 800, 0, 400, 640] },
    ];
    for (const stroke of strokes) {
      const shape = strokeShape(stroke);
      if (shape.kind !== "pieces") throw new Error("not pieces");
      for (const [x, y] of places) {
        const moved = strokeShape(movedTo(stroke, x, y));
        if (moved.kind !== "pieces") throw new Error("not pieces");
        const [dx, dy] = [
          (x - (stroke.points[0] ?? 0)) / 16,
          (y - (stroke.points[1] ?? 0)) / 16,
        ];
        expect(moved.pieces).toHaveLength(shape.pieces.length);
        moved.pieces.forEach((piece, index) => {
          const before = shape.pieces[index] ?? [];
          expect(piece).toHaveLength(before.length);
          piece.forEach(([px, py], corner) => {
            const [qx = 0, qy = 0] = before[corner] ?? [];
            expect(px - qx).toBeCloseTo(dx, 6);
            expect(py - qy).toBeCloseTo(dy, 6);
          });
        });
      }
    }
  });
});
