// Stroke outlines: the filled shape each stroke paints, smooth for a stroke
// drawn as the pointer went, and straight-sided pieces for a polygon. Both are
// part of the file format, since reopening a file draws its strokes again:
// changing how either is made changes how saved symbols look, which
// test/unit/ink/outline.test.ts pins.

import {
  unitsPerPixel,
  type SmoothStroke,
  type Stroke,
} from "../format/record.ts";
import { freehandShape, type FreehandShape, type Point } from "./freehand.ts";
import type { Bounds } from "./geometry.ts";

/** A polygon's corners, in pixels. */
export type Outline = readonly Point[];

/**
 * What a stroke fills, in pixels: for a stroke drawn as the pointer went, one
 * outline traced as a smooth curve, or a circle if its path never got away from
 * its first point; or straight-sided pieces filled together, which make a
 * polygon stroke.
 */
export type StrokeShape =
  | FreehandShape
  | { readonly kind: "pieces"; readonly pieces: readonly Outline[] };

/**
 * How far a polygon's sharp corner may reach past the corner point, in
 * stroke widths: twice its width, as SVG's default miter limit of 4 allows. A
 * sharper corner's point is cut off square across its bisector there.
 */
export const cornerReach = 2;

/** A stroke's points, in pixels. */
export function strokePoints(stroke: Stroke): Point[] {
  const points: Point[] = [];
  for (let index = 0; index + 2 <= stroke.points.length; index += 2) {
    points.push([
      (stroke.points[index] ?? 0) / unitsPerPixel,
      (stroke.points[index + 1] ?? 0) / unitsPerPixel,
    ]);
  }
  return points;
}

/** What a stroke drawn as the pointer went fills. */
export function smoothShape(stroke: SmoothStroke): FreehandShape {
  return freehandShape(strokePoints(stroke), stroke.size / unitsPerPixel);
}

/**
 * What a stroke fills: a smooth stroke's outline or dot, a polygon's pieces,
 * or a filled stroke's inside, as a single piece that the nonzero rule fills.
 */
export function strokeShape(stroke: Stroke): StrokeShape {
  if (stroke.kind === "fill") {
    return { kind: "pieces", pieces: [corners(stroke)] };
  }
  if (stroke.kind !== "polygon") return smoothShape(stroke);
  const points = corners(stroke);
  const closed = isClosed(points);
  return {
    kind: "pieces",
    pieces: polygonPieces(
      closed ? points.slice(0, -1) : points,
      stroke.size / unitsPerPixel,
      closed,
    ),
  };
}

/** Where a shape's ink can go, or undefined for nowhere. */
function shapeBounds(shape: StrokeShape): Bounds | undefined {
  if (shape.kind === "dot") {
    const { center, radius } = shape;
    const [x, y] = center;
    return {
      left: x - radius,
      top: y - radius,
      right: x + radius,
      bottom: y + radius,
    };
  }
  return outlineBounds(
    shape.kind === "smooth" ? shape.outline : shape.pieces.flat(),
  );
}

/** The smallest box around two boxes, either of which may be nothing. */
function joined(
  a: Bounds | undefined,
  b: Bounds | undefined,
): Bounds | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/** Where two boxes overlap, if they do. */
function overlap(a: Bounds, b: Bounds): Bounds | undefined {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return left < right && top < bottom
    ? { left, top, right, bottom }
    : undefined;
}

/**
 * Where a stroke can leave ink, in pixels, or undefined for nowhere: its
 * shape, and for a cut stroke, the rest of it inside its cut boxes, whose
 * outline is its own and can reach past the whole stroke's.
 */
export function strokeBounds(stroke: Stroke): Bounds | undefined {
  const shape = shapeBounds(strokeShape(stroke));
  const rest = restShape(stroke);
  if (rest === undefined) return shape;
  const reach = shapeBounds(rest);
  if (reach === undefined) return shape;
  return cutBoxes(stroke).reduce(
    (bounds, box) => joined(bounds, overlap(reach, box)),
    shape,
  );
}

/** A stroke's points, in pixels, with no point repeated in a row. */
function corners(stroke: Stroke): Point[] {
  return strokePoints(stroke).filter(([x, y], index, points) => {
    const before = points[index - 1];
    return before?.[0] !== x || before[1] !== y;
  });
}

/**
 * Whether a polygon's corners close it: at least three, and the last the
 * first again.
 */
function isClosed(corners: readonly Point[]): boolean {
  const [first] = corners;
  const last = corners.at(-1);
  return (
    corners.length >= 4 &&
    first !== undefined &&
    first[0] === last?.[0] &&
    first[1] === last[1]
  );
}

/**
 * A polygon's orientation made positive, so that pieces filled together add
 * up. Its area is taken about its first corner, which keeps the sign right
 * far from the origin.
 */
function oriented(outline: Point[]): Point[] {
  const [ox, oy] = outline[0] ?? [0, 0];
  let area = 0;
  outline.forEach(([x0, y0], index) => {
    const [x1, y1] = outline[(index + 1) % outline.length] ?? [x0, y0];
    area += (x0 - ox) * (y1 - oy) - (x1 - ox) * (y0 - oy);
  });
  return area < 0 ? outline.reverse() : outline;
}

/**
 * The pieces a polygon `width` pixels wide fills, through `corners` in
 * pixels: a rectangle along each side, and at each corner where it turns, a
 * wedge on the outer side out to where the sides' outer edges meet, cut off
 * square across the corner's bisector {@link cornerReach} widths from the
 * corner point. `closed` joins the last corner to the first; otherwise those
 * ends are square, reaching half the width past their corner. A single corner
 * is a square dot as wide as the stroke. The pieces all wind one way, so that
 * filling them together with the nonzero rule fills everything any of them
 * covers.
 */
export function polygonPieces(
  corners: readonly Point[],
  width: number,
  closed: boolean,
): Outline[] {
  const points = corners.filter(
    ([x, y], index) =>
      index === 0 ||
      corners[index - 1]?.[0] !== x ||
      corners[index - 1]?.[1] !== y,
  );
  const half = width / 2;
  const first = points[0];
  if (first === undefined) return [];
  if (points.length === 1) {
    const [x, y] = first;
    return [
      oriented([
        [x - half, y - half],
        [x + half, y - half],
        [x + half, y + half],
        [x - half, y + half],
      ]),
    ];
  }
  const count = points.length;
  const sides = closed ? count : count - 1;
  const at = (index: number): Point => points[(index + count) % count] ?? first;
  /** The unit direction of the side from corner `index` to the next. */
  const direction = (index: number): Point => {
    const [x0, y0] = at(index);
    const [x1, y1] = at(index + 1);
    const length = Math.hypot(x1 - x0, y1 - y0);
    return [(x1 - x0) / length, (y1 - y0) / length];
  };
  const pieces: Point[][] = [];
  for (let side = 0; side < sides; side++) {
    const [dx, dy] = direction(side);
    const [x0, y0] = at(side);
    const [x1, y1] = at(side + 1);
    const before = !closed && side === 0 ? half : 0;
    const after = !closed && side === sides - 1 ? half : 0;
    const [ax, ay] = [x0 - dx * before, y0 - dy * before];
    const [bx, by] = [x1 + dx * after, y1 + dy * after];
    const [nx, ny] = [-dy * half, dx * half];
    pieces.push([
      [ax + nx, ay + ny],
      [bx + nx, by + ny],
      [bx - nx, by - ny],
      [ax - nx, ay - ny],
    ]);
  }
  const reach = cornerReach * width;
  for (
    let corner = closed ? 0 : 1;
    corner < (closed ? count : count - 1);
    corner++
  ) {
    const [ix, iy] = direction(corner - 1);
    const [ox, oy] = direction(corner);
    const cross = ix * oy - iy * ox;
    const dot = ix * ox + iy * oy;
    if (cross === 0 && dot > 0) continue;
    // The sides' normals on the outer side of the turn; a side doubling back
    // has two, and either does.
    const turn = cross < 0 ? -1 : 1;
    const [n1x, n1y] = [turn * iy, -turn * ix];
    const [n2x, n2y] = [turn * oy, -turn * ox];
    const [cx, cy] = at(corner);
    const p1: Point = [cx + n1x * half, cy + n1y * half];
    const p2: Point = [cx + n2x * half, cy + n2y * half];
    // The corner points along the bisector between the sides' outer edges:
    // between their normals for a gentle turn, and between their directions,
    // away from the second, for a sharp one, where each sum is well defined.
    const [bx, by] = dot > 0 ? [n1x + n2x, n1y + n2y] : [ix - ox, iy - oy];
    const spread = Math.hypot(bx, by);
    const [ux, uy] = [bx / spread, by / spread];
    const cos = n1x * ux + n1y * uy;
    const tip = cos > 0 ? half / cos : Infinity;
    if (tip <= reach) {
      pieces.push([[cx, cy], p1, [cx + ux * tip, cy + uy * tip], p2]);
      continue;
    }
    // Each outer edge runs on until it is `reach` along the bisector. A
    // corner is cut only where the edges meet more than four times as far
    // out as they start, so both run well out along it.
    const rest = reach - half * cos;
    const along1 = rest / (ix * ux + iy * uy);
    const along2 = rest / -(ox * ux + oy * uy);
    pieces.push([
      [cx, cy],
      p1,
      [p1[0] + ix * along1, p1[1] + iy * along1],
      [p2[0] - ox * along2, p2[1] - oy * along2],
      p2,
    ]);
  }
  return pieces.map(oriented);
}

/**
 * The boxes a stroke's cuts take away, in pixels: past the horizontal line
 * through each cut end, as far as the brush reaches from that end and a pixel
 * more for its soft edge. Only the end's own ink goes there:
 * {@link uncutRest} draws the rest of the stroke in them again.
 */
export function cutBoxes(stroke: Stroke): Bounds[] {
  if (stroke.kind !== undefined) return [];
  const { cut, points } = stroke;
  if (cut === undefined) return [];
  const last = points.length - 2;
  const reach = stroke.size / unitsPerPixel + 1;
  const boxes: Bounds[] = [];
  for (const [direction, at] of [
    [cut.start, 0],
    [cut.end, last],
  ] as const) {
    if (direction === undefined || at < 0) continue;
    const x = (points[at] ?? 0) / unitsPerPixel;
    const y = (points[at + 1] ?? 0) / unitsPerPixel;
    const across = { left: x - reach, right: x + reach };
    boxes.push(
      direction === "down"
        ? { ...across, top: y, bottom: y + reach }
        : { ...across, top: y - reach, bottom: y },
    );
  }
  return boxes;
}

/**
 * A cut stroke without the ends that are cut: its points, leaving out from
 * each cut end those less than twice the brush's width from it along the
 * stroke, so that what is left, round ends and all, stays clear of the cut
 * boxes but for other parts of the stroke that pass through them, as when it
 * comes back near an end. Undefined when nothing is left, or the stroke has
 * no cuts.
 */
export function uncutRest(stroke: SmoothStroke): SmoothStroke | undefined {
  const { cut, points } = stroke;
  if (cut === undefined) return undefined;
  const count = points.length / 2;
  const trim = 2 * stroke.size;
  /** The first point, stepping by `step` from `at`, at least `trim` along. */
  const beyond = (at: number, step: number): number => {
    let along = 0;
    let index = at;
    while (along < trim) {
      const next = index + step;
      if (next < 0 || next >= count) return next;
      const dx = (points[next * 2] ?? 0) - (points[index * 2] ?? 0);
      const dy = (points[next * 2 + 1] ?? 0) - (points[index * 2 + 1] ?? 0);
      // Not `Math.hypot`, which rounds differently from one engine to another:
      // a walk can land exactly on `trim`, and this decides which point it is.
      along += Math.sqrt(dx * dx + dy * dy);
      index = next;
    }
    return index;
  };
  const first = cut.start === undefined ? 0 : beyond(0, 1);
  const last = cut.end === undefined ? count - 1 : beyond(count - 1, -1);
  if (first > last || first >= count || last < 0) return undefined;
  return {
    tool: stroke.tool,
    size: stroke.size,
    points: points.slice(first * 2, (last + 1) * 2),
  };
}

/**
 * What a cut stroke fills in its cut boxes: the outline of its
 * {@link uncutRest}. Undefined when nothing is left, or it has no cuts.
 */
export function restShape(stroke: Stroke): StrokeShape | undefined {
  if (stroke.kind !== undefined) return undefined;
  const rest = uncutRest(stroke);
  return rest === undefined ? undefined : smoothShape(rest);
}

/** The outline's bounding box, or undefined when it has no corners. */
export function outlineBounds(outline: Outline): Bounds | undefined {
  if (outline.length === 0) return undefined;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [x, y] of outline) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { left, top, right, bottom };
}

/** Where a path goes: the subset of a canvas context's path methods used. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): void;
  closePath(): void;
}

/**
 * Adds an outline to a path as a closed, smooth curve: quadratic curves
 * through the midpoints of its edges, with its corners as control points.
 */
export function traceOutline(outline: Outline, path: PathSink): void {
  const count = outline.length;
  const first = outline[0];
  if (first === undefined) return;
  const corner = (index: number): readonly [number, number] =>
    outline[index % count] ?? first;
  const mid = (index: number): [number, number] => {
    const [x0, y0] = corner(index);
    const [x1, y1] = corner(index + 1);
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  };
  const [startX, startY] = mid(0);
  path.moveTo(startX, startY);
  for (let index = 1; index <= count; index++) {
    const [cx, cy] = corner(index);
    const [x, y] = mid(index);
    path.quadraticCurveTo(cx, cy, x, y);
  }
  path.closePath();
}

/**
 * Adds what a stroke fills to a path: its outline as {@link traceOutline}
 * does, its circle, or each of a polygon's pieces with straight sides.
 */
export function traceShape(shape: StrokeShape, path: PathSink): void {
  if (shape.kind === "smooth") {
    traceOutline(shape.outline, path);
    return;
  }
  if (shape.kind === "dot") {
    const [x, y] = shape.center;
    path.moveTo(x + shape.radius, y);
    path.arc(x, y, shape.radius, 0, 2 * Math.PI);
    path.closePath();
    return;
  }
  for (const piece of shape.pieces) {
    const [first, ...rest] = piece;
    if (first === undefined) continue;
    path.moveTo(first[0], first[1]);
    for (const [x, y] of rest) path.lineTo(x, y);
    path.closePath();
  }
}
