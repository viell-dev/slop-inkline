import { describe, expect, it } from "vitest";
import type { Stroke } from "../../../src/format/record.ts";
import {
  arcTolerance,
  sweepOutline,
  sweepPath,
  sweepRun,
  sweptStroke,
  type Point,
} from "../../../src/editor/sweep.ts";
import { gridOriginOf } from "../../../src/editor/session.ts";

/** The nonzero winding number of a closed polygon about `point`. */
function winding(polygon: readonly Point[], point: Point): number {
  let turns = 0;
  polygon.forEach((from, index) => {
    const to = polygon[(index + 1) % polygon.length] ?? from;
    const side =
      (to[0] - from[0]) * (point[1] - from[1]) -
      (point[0] - from[0]) * (to[1] - from[1]);
    if (from[1] <= point[1]) {
      if (to[1] > point[1] && side > 0) turns++;
    } else if (to[1] <= point[1] && side < 0) {
      turns--;
    }
  });
  return turns;
}

/** A fill stroke's points as corners. */
function cornersOf(stroke: Stroke): Point[] {
  const corners: Point[] = [];
  for (let index = 0; index + 1 < stroke.points.length; index += 2) {
    corners.push([stroke.points[index] ?? 0, stroke.points[index + 1] ?? 0]);
  }
  return corners;
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) /
              lengthSquared,
          ),
        );
  return Math.hypot(
    from[0] + along * dx - point[0],
    from[1] + along * dy - point[1],
  );
}

/** How far `point` is from the way through `points`, flat, in units. */
function distanceToWay(points: readonly number[], point: Point): number {
  let nearest = Infinity;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const from: Point = [points[index] ?? 0, points[index + 1] ?? 0];
    const to: Point = [
      points[index + 2] ?? from[0],
      points[index + 3] ?? from[1],
    ];
    nearest = Math.min(nearest, distanceToSegment(point, from, to));
  }
  return nearest;
}

/**
 * Where a stroke's fill disagrees with the exact sweep of a round brush of
 * `size` units along `points`, at samples every few units over its box, more
 * than `band` units from the sweep's edge: the chords of circles, and
 * rounding to whole units, each move the edge by up to one.
 */
function disagreements(
  stroke: Stroke,
  size: number,
  points: readonly number[],
  band = arcTolerance + 1,
): { wrong: number; samples: number } {
  const polygon = cornersOf(stroke);
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  const reach = size / 2 + 8;
  const left = Math.min(...xs) - reach;
  const top = Math.min(...ys) - reach;
  const right = Math.max(...xs) + reach;
  const bottom = Math.max(...ys) + reach;
  // About 120 samples each way, and never closer than a few units.
  const stepX = Math.max(5.3, (right - left) / 120);
  const stepY = Math.max(5.9, (bottom - top) / 120);
  let wrong = 0;
  let samples = 0;
  // Off the grid of whole units, so that no sample lies exactly on the
  // outline's straight bridge from the way's first point to its last, which
  // has no width: a renderer covers none of it.
  for (let y = top + 0.2913; y <= bottom; y += stepY) {
    for (let x = left + 0.1371; x <= right; x += stepX) {
      const edge = distanceToWay(points, [x, y]) - size / 2;
      if (Math.abs(edge) <= band) continue;
      samples++;
      if ((winding(polygon, [x, y]) !== 0) !== edge < 0) wrong++;
    }
  }
  return { wrong, samples };
}

/** Points along a curve, as a mouse reports them: on whole units. */
function curve(count: number, at: (step: number) => Point): number[] {
  return Array.from({ length: count }, (_, step) => at(step)).flatMap(
    ([x, y]) => [Math.round(x), Math.round(y)],
  );
}

/** A random walk from a seed, the same each run. */
function walk(seed: number, count: number, stride: number): number[] {
  let state = seed;
  const random = (): number => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const points: Point[] = [[1600, 1600]];
  for (let step = 0; step < count; step++) {
    const [x, y] = points.at(-1) ?? [0, 0];
    points.push([x + (random() - 0.5) * stride, y + (random() - 0.5) * stride]);
  }
  return points.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
}

const ways: Record<string, readonly number[]> = {
  straight: [0, 0, 640, 160],
  "a right angle": [0, 0, 480, 0, 480, 480],
  "a sharp turn": [0, 0, 480, 0, 0, 48],
  "a turn straight back": [0, 0, 480, 0, 160, 0],
  "two turns straight back": [0, 0, 480, 0, 160, 0, 400, 0],
  "a zigzag": Array.from({ length: 30 }, (_, step) => [
    step * 32,
    step % 2 === 0 ? 0 : 96,
  ]).flat(),
  "a tight zigzag": Array.from({ length: 30 }, (_, step) => [
    step * 8,
    step % 2 === 0 ? 0 : 112,
  ]).flat(),
  "a mouse's whole-pixel steps": curve(200, (step) => [
    step * 10,
    Math.round(step * 0.3) * 10,
  ]),
  "a long straight line": Array.from({ length: 200 }, (_, step) => [
    step * 6,
    step * 2,
  ]).flat(),
  "a figure eight": curve(121, (step) => {
    const turn = (2 * Math.PI * step) / 120;
    return [800 + 640 * Math.sin(turn), 800 + 320 * Math.sin(2 * turn)];
  }),
};

describe("sweptStroke", () => {
  for (const [name, points] of Object.entries(ways)) {
    for (const size of [96, 384]) {
      it(`fills exactly what a brush of ${String(size)} units sweeps along ${name}`, () => {
        const stroke = sweptStroke("eraser", size, points);
        expect(stroke.kind).toBe("fill");
        const { wrong, samples } = disagreements(stroke, size, points);
        expect(samples).toBeGreaterThan(500);
        expect(wrong).toBe(0);
      });
    }
  }

  for (const seed of [7, 11, 13, 17]) {
    it(`fills exactly what a brush sweeps along a random walk, seed ${String(seed)}`, () => {
      const points = walk(seed, 120, 90);
      const size = 96 + (seed % 4) * 96;
      const { wrong, samples } = disagreements(
        sweptStroke("eraser", size, points),
        size,
        points,
      );
      expect(samples).toBeGreaterThan(500);
      expect(wrong).toBe(0);
    });
  }

  it("leaves the ink a loop goes round, as an island", () => {
    // A circle of radius 480 units with a brush 192 wide: the ink within
    // 384 units of its middle is not swept.
    const points = curve(181, (step) => [
      1600 + 480 * Math.cos((2 * Math.PI * step) / 180),
      1600 + 480 * Math.sin((2 * Math.PI * step) / 180),
    ]);
    const stroke = sweptStroke("eraser", 192, points);
    const polygon = cornersOf(stroke);
    expect(winding(polygon, [1600, 1600])).toBe(0);
    expect(winding(polygon, [1600 + 300, 1600])).toBe(0);
    expect(winding(polygon, [1600 + 480, 1600])).not.toBe(0);
    expect(winding(polygon, [1600, 1600 - 560])).not.toBe(0);
    expect(winding(polygon, [1600, 1600 - 600])).toBe(0);
    expect(disagreements(stroke, 192, points).wrong).toBe(0);
  });

  it("goes inside a turn straight through where the edges meet, between long lines", () => {
    const corners = cornersOf(
      sweptStroke("eraser", 96, [0, 0, 480, 0, 480, 480]),
    );
    expect(corners).toContainEqual([432, 48]);
    // Not in to the corner and out again, as between short lines.
    expect(corners).not.toContainEqual([480, 0]);
    const short = cornersOf(sweptStroke("eraser", 96, [0, 0, 24, 0, 24, 24]));
    expect(short).toContainEqual([24, 0]);
  });

  it("starts and ends at the way's last point, for the grid a drawing's ends suggest", () => {
    const points = [100, 200, 300, 260, 500, 120];
    const stroke = sweptStroke("eraser", 192, points);
    expect(stroke.points.slice(0, 2)).toEqual([500, 120]);
    expect(stroke.points.slice(-2)).toEqual([500, 120]);
    // Coming down to a row, so that its sides there lie on the row too, the
    // grid is guessed from its end alone, where it is.
    const down = sweptStroke("eraser", 384, [376, 256, 376, 2304]);
    expect(down.kind).toBe("fill");
    expect(gridOriginOf({ strokes: [down] })).toBe(376 / 16 - 16);
  });

  it("never goes out and back along itself, which a renderer can leave a hairline of", () => {
    const strokes: [string, Stroke][] = [
      ...Object.entries(ways).map(([name, points]): [string, Stroke] => [
        name,
        sweptStroke("eraser", 192, points),
      ]),
      ["a tap", sweptStroke("eraser", 384, [0, 0])],
    ];
    for (const [name, stroke] of strokes) {
      expect(stroke.kind, name).toBe("fill");
      const corners = cornersOf(stroke);
      corners.forEach((corner, index) => {
        const next = corners[(index + 1) % corners.length] ?? corner;
        const after = corners[(index + 2) % corners.length] ?? corner;
        const ax = next[0] - corner[0];
        const ay = next[1] - corner[1];
        const bx = after[0] - next[0];
        const by = after[1] - next[1];
        // No edge followed by one straight back along its line.
        expect(ax * by - ay * bx === 0 && ax * bx + ay * by < 0, name).toBe(
          false,
        );
      });
    }
  });

  it("is the brush's circle, from and back to its centre, for a way that never left its first point", () => {
    const dot = sweptStroke("eraser", 96, [40, 50, 40, 50]);
    expect(dot.kind).toBe("fill");
    expect(dot.points.slice(0, 2)).toEqual([40, 50]);
    expect(dot.points.slice(-2)).toEqual([40, 50]);
    const polygon = cornersOf(dot);
    for (let angle = 0; angle < 2 * Math.PI; angle += 0.1) {
      const at = (distance: number): Point => [
        40 + distance * Math.cos(angle),
        50 + distance * Math.sin(angle),
      ];
      expect(winding(polygon, at(46))).not.toBe(0);
      expect(winding(polygon, at(49))).toBe(0);
    }
  });

  it("never takes back what it swept as the way goes on", () => {
    // A sample a shape covers stays covered as each later point is added,
    // but by its edge, where rounding to whole units can move it a little.
    for (const seed of [3, 5]) {
      const points = walk(seed, 40, 60);
      const size = 192;
      const prefixes = Array.from(
        { length: points.length / 2 - 1 },
        (_, count) => points.slice(0, 2 * count + 4),
      );
      const shapes = prefixes.map((prefix) =>
        cornersOf(sweptStroke("eraser", size, prefix)),
      );
      const xs = points.filter((_, index) => index % 2 === 0);
      const ys = points.filter((_, index) => index % 2 === 1);
      let checked = 0;
      for (
        let y = Math.min(...ys) - 100;
        y <= Math.max(...ys) + 100;
        y += 9.1
      ) {
        for (
          let x = Math.min(...xs) - 100;
          x <= Math.max(...xs) + 100;
          x += 8.9
        ) {
          let before = false;
          shapes.forEach((shape, index) => {
            const now = winding(shape, [x, y]) !== 0;
            if (before && !now) {
              const edge =
                distanceToWay(prefixes[index] ?? [], [x, y]) - size / 2;
              expect(Math.abs(edge)).toBeLessThanOrEqual(arcTolerance + 1);
            }
            before = now;
            checked++;
          });
        }
      }
      expect(checked).toBeGreaterThan(10_000);
    }
  });
});

describe("sweepPath", () => {
  it("keeps every point on its lines, and the ends exactly", () => {
    const points = curve(300, (step) => [
      step * 10 + Math.round(Math.sin(step) * 2),
      Math.round(step * 0.37) * 10,
    ]);
    const path = sweepPath(points);
    expect(path[0]).toEqual([points[0], points[1]]);
    expect(path.at(-1)).toEqual([points.at(-2), points.at(-1)]);
    for (let index = 0; index + 1 < points.length; index += 2) {
      const point: Point = [points[index] ?? 0, points[index + 1] ?? 0];
      const nearest = Math.min(
        ...path
          .slice(1)
          .map((to, at) => distanceToSegment(point, path[at] ?? to, to)),
      );
      expect(nearest).toBeLessThan(1e-9);
    }
  });

  it("changes only its last line as points are added", () => {
    const points = walk(23, 200, 20);
    // Some points in a row on one line, and one back along it.
    points.push(2000, 2000, 2010, 2000, 2030, 2000, 2020, 2000, 2050, 2000);
    let before = sweepPath(points.slice(0, 2));
    for (let count = 2; count <= points.length / 2; count++) {
      const path = sweepPath(points.slice(0, 2 * count));
      expect(path.slice(0, before.length - 1)).toEqual(before.slice(0, -1));
      before = path;
    }
    // A point back along a line is a corner, as the line does not reach it.
    expect(before.slice(-4)).toEqual([
      [2000, 2000],
      [2030, 2000],
      [2020, 2000],
      [2050, 2000],
    ]);
  });

  it("merges a straight line, in runs of at most sweepRun points", () => {
    const points = Array.from({ length: 1000 }, (_, step) => [
      step * 4,
      step,
    ]).flat();
    const path = sweepPath(points);
    expect(path.length).toBe(Math.ceil(999 / sweepRun) + 1);
  });

  it("keeps a corner where the way comes straight back to it", () => {
    expect(sweepPath([0, 0, 160, 0, 0, 0])).toEqual([
      [0, 0],
      [160, 0],
      [0, 0],
    ]);
    const stroke = sweptStroke("eraser", 96, [0, 0, 160, 0, 0, 0]);
    expect(stroke.points.every(Number.isInteger)).toBe(true);
  });

  it("drops a point repeated in a row", () => {
    expect(sweepPath([0, 0, 0, 0, 16, 0, 16, 0])).toEqual([
      [0, 0],
      [16, 0],
    ]);
  });
});

describe("sweepOutline", () => {
  it("is a circle for a way of one point", () => {
    const outline = sweepOutline([[100, 100]], 48);
    expect(winding(outline, [100, 100])).not.toBe(0);
    expect(winding(outline, [100, 100 + 46])).not.toBe(0);
    expect(winding(outline, [100, 100 + 50])).toBe(0);
  });
});
