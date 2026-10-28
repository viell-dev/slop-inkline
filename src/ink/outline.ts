// Stroke outlines: the filled shape each stroke paints, from perfect-freehand.
// The options are part of the file format, since reopening a file draws its
// strokes again: changing them, or perfect-freehand's version, changes how
// saved symbols look, which test/unit/ink/outline.test.ts pins.

import { getStroke, type StrokeOptions } from "perfect-freehand";
import { maxPressure, unitsPerPixel, type Stroke } from "../format/record.ts";
import type { Bounds } from "./geometry.ts";

/** A polygon's corners, in pixels. */
export type Outline = readonly (readonly [number, number])[];

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

/** The polygon a stroke fills. */
export function strokeOutline(stroke: Stroke): Outline {
  return getStroke(outlineInput(stroke), outlineOptions(stroke)).map(
    ([x, y]) => [x, y] as const,
  );
}

/**
 * The boxes a stroke's cuts take away, in pixels: past the line through each
 * cut end, across the cut's direction, as far as the brush reaches from that
 * end and a pixel more for its soft edge. The rest of the stroke lies on the
 * other side of the line, so only that end's round cap goes.
 */
export function cutBoxes(stroke: Stroke): Bounds[] {
  const { cut, points } = stroke;
  if (cut === undefined) return [];
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
