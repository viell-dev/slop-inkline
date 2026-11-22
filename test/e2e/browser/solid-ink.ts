// How solid a polygon's ink is inside it, as Chromium's canvas draws it: the
// pixels that lie wholly inside the shape the format defines must be fully
// inked, with no seam where its pieces meet. These run in the renderer, where
// the canvas is the browser's own, and only counts cross to the test.

import type { Stroke } from "../../../src/format/record.ts";
import type { Point } from "../../../src/ink/freehand.ts";
import {
  strokeBounds,
  strokePoints,
  strokeShape,
  type Outline,
} from "../../../src/ink/outline.ts";
import { drawInk } from "../../../src/ink/render.ts";

/** How solid a stroke's ink is inside it, by {@link measureSolidInk}. */
export interface SolidInk {
  /** The pixels that lie wholly inside the stroke's shape. */
  readonly inside: number;
  /** How many of them are not fully inked, and the least alpha among them. */
  readonly short: number;
  readonly least: number;
  /** The first such pixel's middle, in document pixels, for a failure. */
  readonly at: Point | undefined;
}

/** Twice a polygon's signed area. */
function area(polygon: readonly Point[]): number {
  let sum = 0;
  polygon.forEach(([x0, y0], index) => {
    const [x1, y1] = polygon[(index + 1) % polygon.length] ?? [x0, y0];
    sum += x0 * y1 - x1 * y0;
  });
  return sum;
}

/**
 * A convex polygon cut by the line through `a` and `b`: the part on its left,
 * where a piece that winds as the pieces do lies, and the part on its right.
 */
function cut(
  polygon: readonly Point[],
  a: Point,
  b: Point,
): [Point[], Point[]] {
  const side = ([x, y]: Point): number =>
    (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const left: Point[] = [];
  const right: Point[] = [];
  polygon.forEach((p, index) => {
    const q = polygon[(index + 1) % polygon.length] ?? p;
    const [sp, sq] = [side(p), side(q)];
    if (sp >= 0) left.push(p);
    if (sp <= 0) right.push(p);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
      const t = sp / (sp - sq);
      const crossing: Point = [
        p[0] + (q[0] - p[0]) * t,
        p[1] + (q[1] - p[1]) * t,
      ];
      left.push(crossing);
      right.push(crossing);
    }
  });
  return [left, right];
}

/**
 * Whether convex pieces, which wind one way, cover all of a convex polygon:
 * what each piece leaves of it is cut away by the next, down to nothing.
 */
function coveredBy(
  polygon: readonly Point[],
  pieces: readonly Outline[],
): boolean {
  let left: (readonly Point[])[] = [polygon];
  for (const piece of pieces) {
    const outside: Point[][] = [];
    for (const part of left) {
      let rest: readonly Point[] = part;
      piece.forEach((a, index) => {
        const b = piece[(index + 1) % piece.length] ?? a;
        if (rest.length < 3) return;
        const [inside, beyond] = cut(rest, a, b);
        // Above what rounding leaves where two pieces meet, about 2e-12
        // for corners some hundred pixels from the origin.
        if (beyond.length >= 3 && Math.abs(area(beyond)) > 1e-9) {
          outside.push(beyond);
        }
        rest = inside;
      });
    }
    left = outside;
    if (left.length === 0) return true;
  }
  return false;
}

/**
 * Where the edges of two different pieces cross, other than at `corners`,
 * where a side's rectangle ends across the next one's start.
 */
function crossings(
  pieces: readonly Outline[],
  corners: readonly Point[],
): Point[] {
  const edges = pieces.flatMap((piece, index) =>
    piece.map((a, at) => ({
      index,
      a,
      b: piece[(at + 1) % piece.length] ?? a,
    })),
  );
  const found: Point[] = [];
  for (const [at, e] of edges.entries()) {
    for (const f of edges.slice(at + 1)) {
      if (e.index === f.index) continue;
      const [ex, ey] = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
      const [fx, fy] = [f.b[0] - f.a[0], f.b[1] - f.a[1]];
      const cross = ex * fy - ey * fx;
      if (cross === 0) continue;
      const [gx, gy] = [f.a[0] - e.a[0], f.a[1] - e.a[1]];
      const t = (gx * fy - gy * fx) / cross;
      const u = (gx * ey - gy * ex) / cross;
      if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) continue;
      const point: Point = [e.a[0] + ex * t, e.a[1] + ey * t];
      const atCorner = corners.some(
        ([x, y]) => Math.hypot(point[0] - x, point[1] - y) < 1e-6,
      );
      if (!atCorner) found.push(point);
    }
  }
  return found;
}

/**
 * Draws `stroke`, a polygon, alone with the renderer's own `drawInk`, `scale`
 * device pixels to the document pixel and shifted by a fraction of a pixel,
 * as the editor draws on its surface, on a canvas made with `settings`, as
 * saving reads one back with `willReadFrequently`. Then measures the pixels
 * within `reach` document pixels of its corners but its first and last: one
 * counts as wholly inside when its pieces cover it, and `margin` device
 * pixels more on every side, as a renderer's antialiasing can reach a little
 * past an edge. Pixels within `clearance` device pixels of where the edges
 * of two pieces cross inside the shape are left out, as Chromium can leave
 * one beside such a crossing short too (#422).
 */
export function measureSolidInk(
  stroke: Stroke,
  scale: number,
  settings: CanvasRenderingContext2DSettings,
  reach: number,
  margin: number,
  clearance: number,
): SolidInk {
  const bounds = strokeBounds(stroke);
  const shape = strokeShape(stroke);
  if (bounds === undefined || shape.kind !== "pieces") {
    throw new Error("not a polygon");
  }
  const [shiftX, shiftY] = [0.37, 0.61];
  const originX = (bounds.left - 2) * scale - shiftX;
  const originY = (bounds.top - 2) * scale - shiftY;
  const width = Math.ceil((bounds.right + 2) * scale - originX);
  const height = Math.ceil((bounds.bottom + 2) * scale - originY);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", settings);
  if (context === null) throw new Error("no 2D canvas context");
  context.setTransform(scale, 0, 0, scale, -originX, -originY);
  drawInk(context, [stroke], undefined);
  const { data } = context.getImageData(0, 0, width, height);
  const corners = strokePoints(stroke).slice(1, -1);
  const crossed = crossings(shape.pieces, corners);
  /** A point of the canvas, in document pixels. */
  const documentPoint = (x: number, y: number): Point => [
    (x + originX) / scale,
    (y + originY) / scale,
  ];
  let inside = 0;
  let short = 0;
  let least = 255;
  let at: Point | undefined;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // An empty pixel inside the shape is as short as can be.
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;
      const middle = documentPoint(x + 0.5, y + 0.5);
      const near = corners.some(
        ([cx, cy]) => Math.hypot(middle[0] - cx, middle[1] - cy) <= reach,
      );
      if (!near) continue;
      const nearCrossing = crossed.some(
        ([px, py]) =>
          Math.hypot(middle[0] - px, middle[1] - py) * scale <= clearance,
      );
      if (nearCrossing) continue;
      const [low, high] = [-margin, 1 + margin];
      const square = [
        documentPoint(x + low, y + low),
        documentPoint(x + high, y + low),
        documentPoint(x + high, y + high),
        documentPoint(x + low, y + high),
      ];
      if (!coveredBy(square, shape.pieces)) continue;
      inside++;
      if (alpha === 255) continue;
      short++;
      least = Math.min(least, alpha);
      at ??= middle;
    }
  }
  return { inside, short, least, at };
}
