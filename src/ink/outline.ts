// Stroke outlines: the filled shape each stroke paints, from perfect-freehand
// for a stroke drawn as the pointer went, and straight-sided pieces for a
// polygon. Both are part of the file format, since reopening a file draws its
// strokes again: changing the options, perfect-freehand's version, or how a
// polygon's corners are made changes how saved symbols look, which
// test/unit/ink/outline.test.ts pins.

import { getStroke, type StrokeOptions } from "perfect-freehand";
import { maxPressure, unitsPerPixel, type Stroke } from "../format/record.ts";
import type { Bounds } from "./geometry.ts";

/** A point, in pixels. */
type Point = readonly [number, number];

/** A polygon's corners, in pixels. */
export type Outline = readonly Point[];

/**
 * What a stroke fills, in pixels: one outline traced as a smooth curve, as
 * for a stroke drawn as the pointer went, or straight-sided pieces filled
 * together, which make a polygon stroke.
 */
export type StrokeShape =
  | { readonly kind: "smooth"; readonly outline: Outline }
  | { readonly kind: "pieces"; readonly pieces: readonly Outline[] };

/**
 * How far a polygon's sharp corner may reach past the corner point, in
 * stroke widths: twice its width, as SVG's default miter limit of 4 allows. A
 * sharper corner's point is cut off square across its bisector there.
 */
export const cornerReach = 2;

/** The perfect-freehand options for a stroke. */
export function outlineOptions(stroke: Stroke): StrokeOptions {
  return {
    size: stroke.size / unitsPerPixel,
    // Pressure narrows a pen's stroke to half its size at the lightest touch;
    // strokes without pressure keep their size throughout.
    thinning: stroke.pressure ? 0.5 : 0,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    last: true,
  };
}

/** The points as perfect-freehand takes them, in pixels with 0–1 pressure. */
export function outlineInput(stroke: Stroke): [number, number, number][] {
  const stride = stroke.pressure ? 3 : 2;
  const input: [number, number, number][] = [];
  for (let index = 0; index + stride <= stroke.points.length; index += stride) {
    const x = (stroke.points[index] ?? 0) / unitsPerPixel;
    const y = (stroke.points[index + 1] ?? 0) / unitsPerPixel;
    const pressure = stroke.pressure
      ? (stroke.points[index + 2] ?? 0) / maxPressure
      : 0.5;
    input.push([x, y, pressure]);
  }
  return input;
}

/** The polygon perfect-freehand gives for a stroke drawn as the pointer went. */
export function strokeOutline(stroke: Stroke): Outline {
  return getStroke(outlineInput(stroke), outlineOptions(stroke)).map(
    ([x, y]) => [x, y] as const,
  );
}

/** What a stroke fills: its outline, or a polygon's pieces. */
export function strokeShape(stroke: Stroke): StrokeShape {
  if (stroke.kind !== "polygon") {
    return { kind: "smooth", outline: strokeOutline(stroke) };
  }
  const corners = polygonCorners(stroke);
  const closed = isClosed(corners);
  return {
    kind: "pieces",
    pieces: polygonPieces(
      closed ? corners.slice(0, -1) : corners,
      stroke.size / unitsPerPixel,
      { closed, start: true, end: true },
    ),
  };
}

/** Where a stroke can leave ink, in pixels, or undefined for nowhere. */
export function strokeBounds(stroke: Stroke): Bounds | undefined {
  const shape = strokeShape(stroke);
  return outlineBounds(
    shape.kind === "smooth" ? shape.outline : shape.pieces.flat(),
  );
}

/** A polygon stroke's corners, in pixels, with no point repeated in a row. */
export function polygonCorners(stroke: Stroke): Point[] {
  const stride = stroke.pressure ? 3 : 2;
  const corners: Point[] = [];
  for (let at = 0; at + stride <= stroke.points.length; at += stride) {
    const x = (stroke.points[at] ?? 0) / unitsPerPixel;
    const y = (stroke.points[at + 1] ?? 0) / unitsPerPixel;
    const last = corners.at(-1);
    if (last?.[0] === x && last[1] === y) continue;
    corners.push([x, y]);
  }
  return corners;
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

/** Whether a stroke is a closed polygon, which has no ends to cut. */
function isClosedPolygon(stroke: Stroke): boolean {
  return stroke.kind === "polygon" && isClosed(polygonCorners(stroke));
}

/** A polygon's orientation made positive, so that pieces filled together add up. */
function oriented(outline: Point[]): Point[] {
  let area = 0;
  outline.forEach(([x0, y0], index) => {
    const [x1, y1] = outline[(index + 1) % outline.length] ?? [x0, y0];
    area += x0 * y1 - x1 * y0;
  });
  return area < 0 ? outline.reverse() : outline;
}

/**
 * The pieces a polygon `width` pixels wide fills, through `corners` in
 * pixels: a rectangle along each side, and at each corner where it turns, a
 * wedge on the outer side out to where the sides' outer edges meet, cut off
 * square across the corner's bisector {@link cornerReach} widths from the
 * corner point. `closed` joins the last corner to the first. Otherwise
 * `start` and `end` say whether those ends are square, reaching half the
 * width past their corner; else they stop flat across at it. A single corner
 * is a square dot as wide as the stroke, if an end there is square. The
 * pieces all wind one way, so that filling them together with the nonzero
 * rule fills everything any of them covers.
 */
export function polygonPieces(
  corners: readonly Point[],
  width: number,
  shape: {
    readonly closed: boolean;
    readonly start: boolean;
    readonly end: boolean;
  },
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
    if (!shape.start && !shape.end) return [];
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
  const { closed } = shape;
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
    const before = !closed && side === 0 && shape.start ? half : 0;
    const after = !closed && side === sides - 1 && shape.end ? half : 0;
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
    // The corner points along the bisector between the sides' outer edges.
    const spread = Math.hypot(ix - ox, iy - oy);
    const [ux, uy] = [(ix - ox) / spread, (iy - oy) / spread];
    const cos = n1x * ux + n1y * uy;
    const tip = cos > 0 ? half / cos : Infinity;
    if (tip <= reach) {
      pieces.push([[cx, cy], p1, [cx + ux * tip, cy + uy * tip], p2]);
      continue;
    }
    // Each outer edge runs on until it is `reach` along the bisector.
    const along = ((reach - half * cos) * spread) / (1 - dot);
    pieces.push([
      [cx, cy],
      p1,
      [p1[0] + ix * along, p1[1] + iy * along],
      [p2[0] - ox * along, p2[1] - oy * along],
      p2,
    ]);
  }
  return pieces.map(oriented);
}

/**
 * The boxes a stroke's cuts take away, in pixels: past the line through each
 * cut end, across the cut's direction, as far as the brush reaches from that
 * end and a pixel more for its soft edge. Only the end's own ink goes there:
 * {@link uncutRest} draws the rest of the stroke in them again.
 */
export function cutBoxes(stroke: Stroke): Bounds[] {
  const { cut, points } = stroke;
  if (cut === undefined || isClosedPolygon(stroke)) return [];
  const stride = stroke.pressure ? 3 : 2;
  const last = points.length - stride;
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
    const along = { top: y - reach, bottom: y + reach };
    boxes.push(
      direction === "down"
        ? { ...across, top: y, bottom: y + reach }
        : direction === "up"
          ? { ...across, top: y - reach, bottom: y }
          : direction === "right"
            ? { ...along, left: x, right: x + reach }
            : { ...along, left: x - reach, right: x },
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
export function uncutRest(stroke: Stroke): Stroke | undefined {
  const { cut, points } = stroke;
  if (cut === undefined) return undefined;
  const stride = stroke.pressure ? 3 : 2;
  const count = points.length / stride;
  const trim = 2 * stroke.size;
  /** The first point, stepping by `step` from `at`, at least `trim` along. */
  const beyond = (at: number, step: number): number => {
    let along = 0;
    let index = at;
    while (along < trim) {
      const next = index + step;
      if (next < 0 || next >= count) return next;
      along += Math.hypot(
        (points[next * stride] ?? 0) - (points[index * stride] ?? 0),
        (points[next * stride + 1] ?? 0) - (points[index * stride + 1] ?? 0),
      );
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
    pressure: stroke.pressure,
    points: points.slice(first * stride, (last + 1) * stride),
  };
}

/**
 * What a cut stroke fills in its cut boxes: the outline of its
 * {@link uncutRest}, or for a polygon, its sides without the length of
 * twice its width from each cut end, with flat ends there. Undefined when
 * nothing is left, or the stroke has no cuts.
 */
export function restShape(stroke: Stroke): StrokeShape | undefined {
  if (stroke.kind !== "polygon") {
    const rest = uncutRest(stroke);
    return rest === undefined
      ? undefined
      : { kind: "smooth", outline: strokeOutline(rest) };
  }
  const { cut } = stroke;
  if (cut === undefined || isClosedPolygon(stroke)) return undefined;
  const corners = polygonCorners(stroke);
  const width = stroke.size / unitsPerPixel;
  const lengths = corners.slice(1).map(([x1, y1], index) => {
    const [x0, y0] = corners[index] ?? [x1, y1];
    return Math.hypot(x1 - x0, y1 - y0);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const from = cut.start === undefined ? 0 : 2 * width;
  const to = total - (cut.end === undefined ? 0 : 2 * width);
  if (from >= to) return undefined;
  /** The point `distance` along the sides from the first corner. */
  const pointAt = (distance: number): Point => {
    let walked = 0;
    for (const [index, length] of lengths.entries()) {
      const [x0, y0] = corners[index] ?? [0, 0];
      const [x1, y1] = corners[index + 1] ?? [x0, y0];
      if (walked + length >= distance) {
        const along = length === 0 ? 0 : (distance - walked) / length;
        return [x0 + (x1 - x0) * along, y0 + (y1 - y0) * along];
      }
      walked += length;
    }
    return corners.at(-1) ?? [0, 0];
  };
  const kept: Point[] = [pointAt(from)];
  let walked = 0;
  for (const [index, length] of lengths.entries()) {
    walked += length;
    const corner = corners[index + 1];
    if (corner !== undefined && walked > from && walked < to) kept.push(corner);
  }
  kept.push(pointAt(to));
  return {
    kind: "pieces",
    pieces: polygonPieces(kept, width, {
      closed: false,
      start: cut.start === undefined,
      end: cut.end === undefined,
    }),
  };
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
  closePath(): void;
}

/**
 * Adds an outline to a path as a closed, smooth curve: quadratic curves
 * through the midpoints of its edges, with its corners as control points,
 * as perfect-freehand's own examples draw it.
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
 * does, or each of a polygon's pieces with straight sides.
 */
export function traceShape(shape: StrokeShape, path: PathSink): void {
  if (shape.kind === "smooth") {
    traceOutline(shape.outline, path);
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
