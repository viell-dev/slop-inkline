// Synthetic test symbols for the #167 §2 investigation (symbol scale): an
// invented sign as dense as a complex CJK character, of fine strokes, and a
// wide one. Neither is a real character; both are drawn here from
// coordinates. Coordinates are in pixels of the 192-pixel line box (128 per
// em, baseline at 144), and strokes come out in the format's units.

import { unitsPerPixel } from "../../../src/format/record.ts";

/** A point in line-box pixels. */
export type Point = readonly [number, number];

/** A pen stroke as the record holds it. */
export interface PenStroke {
  readonly tool: "pen";
  readonly size: number;
  readonly points: number[];
}

/** Brush S, the finest: 3/64 em, 6 pixels at 128 pixels per em. */
export const brushS = 6;

/**
 * A pen stroke through `corners`, with a point every 2 pixels or less along
 * each straight piece, as the editor records a drawn line.
 */
export function pen(corners: readonly Point[], size = brushS): PenStroke {
  const points: number[] = [];
  const add = ([x, y]: Point): void => {
    points.push(Math.round(x * unitsPerPixel), Math.round(y * unitsPerPixel));
  };
  const [first] = corners;
  if (first === undefined) throw new Error("a stroke needs a point");
  add(first);
  for (let index = 1; index < corners.length; index++) {
    const from = corners[index - 1];
    const to = corners[index];
    if (from === undefined || to === undefined) continue;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil(length / 2));
    for (let step = 1; step <= steps; step++) {
      add([
        from[0] + ((to[0] - from[0]) * step) / steps,
        from[1] + ((to[1] - from[1]) * step) / steps,
      ]);
    }
  }
  return { tool: "pen", size: size * unitsPerPixel, points };
}

/**
 * The lattice in the middle of the dense sign: six horizontal strokes 12
 * pixels apart, from y 34 to 94, between verticals at x 50, 70, 90, and 110.
 * Each stroke is 6 pixels wide, leaving gaps of 6. A column at x 60 crosses
 * all six with nothing else in the way, which the measurements scan.
 */
export const lattice = {
  column: 60,
  lines: [34, 46, 58, 70, 82, 94],
  gaps: [40, 52, 64, 76, 88],
} as const;

/** The dense sign's strokes, all with brush S. */
export function denseCorners(): Point[][] {
  const strokes: Point[][] = [];
  // A dot and a roof.
  strokes.push([
    [80, 16],
    [84, 22],
  ]);
  strokes.push([
    [18, 27],
    [142, 27],
  ]);
  // Left: three stacked zigzags, and three dots under them.
  for (const top of [36, 56, 76]) {
    strokes.push([
      [34, top],
      [20, top + 8],
      [36, top + 11],
      [22, top + 17],
    ]);
  }
  for (const x of [18, 28, 38]) {
    strokes.push([
      [x, 100],
      [x + 2, 106],
    ]);
  }
  // Middle: the lattice.
  for (const x of [50, 70, 90, 110]) {
    strokes.push([
      [x, 34],
      [x, 94],
    ]);
  }
  for (const y of lattice.lines) {
    strokes.push([
      [50, y],
      [110, y],
    ]);
  }
  // Right: two verticals with rungs, one ending in a hook.
  strokes.push([
    [122, 34],
    [122, 104],
  ]);
  strokes.push([
    [144, 34],
    [144, 100],
    [138, 106],
  ]);
  for (const y of [34, 50, 66, 82]) {
    strokes.push([
      [122, y],
      [144, y],
    ]);
  }
  // A long bar across.
  strokes.push([
    [14, 114],
    [146, 114],
  ]);
  // Bottom left: a box with a cross in it.
  strokes.push([
    [22, 122],
    [66, 122],
    [66, 154],
    [22, 154],
    [22, 122],
  ]);
  strokes.push([
    [44, 122],
    [44, 154],
  ]);
  strokes.push([
    [22, 138],
    [66, 138],
  ]);
  // Bottom right: three legs on two bars, and a slanted stroke.
  for (const x of [84, 102, 120]) {
    strokes.push([
      [x, 122],
      [x, 152],
    ]);
  }
  strokes.push([
    [78, 136],
    [130, 136],
  ]);
  strokes.push([
    [78, 152],
    [140, 152],
  ]);
  strokes.push([
    [142, 120],
    [128, 142],
  ]);
  // A sweep under it all, below the baseline.
  strokes.push([
    [10, 164],
    [80, 170],
    [150, 166],
  ]);
  return strokes;
}

/** The dense sign as pen strokes. */
export function denseStrokes(): PenStroke[] {
  return denseCorners().map((corners) => pen(corners));
}

/**
 * A wide symbol: a bar 2,000 pixels long, about 15.6 em, with a tick every
 * 40 pixels, to see what a scale does to a symbol wider than a line.
 */
export function wideCorners(): Point[][] {
  const strokes: Point[][] = [
    [
      [8, 120],
      [2008, 120],
    ],
  ];
  for (let x = 8; x <= 2008; x += 40) {
    strokes.push([
      [x, 96],
      [x, 144],
    ]);
  }
  return strokes;
}

export function wideStrokes(): PenStroke[] {
  return wideCorners().map((corners) => pen(corners, 12));
}

/**
 * The finest lattice brush S can draw with a gap left: six horizontal
 * strokes 9 pixels apart, from y 40 to 85, so 3-pixel gaps, between
 * verticals at x 50, 70, 90, and 110. A column at x 60 crosses all six.
 */
export const fineLattice = {
  column: 60,
  lines: [40, 49, 58, 67, 76, 85],
  gaps: [44.5, 53.5, 62.5, 71.5, 80.5],
} as const;

export function fineStrokes(): PenStroke[] {
  const strokes: Point[][] = [];
  for (const x of [50, 70, 90, 110]) {
    strokes.push([
      [x, fineLattice.lines[0]],
      [x, fineLattice.lines[5]],
    ]);
  }
  for (const y of fineLattice.lines) {
    strokes.push([
      [50, y],
      [110, y],
    ]);
  }
  // A foot on the baseline, so that it reads as a sign in a line.
  strokes.push([
    [40, 140],
    [120, 140],
  ]);
  return strokes.map((corners) => pen(corners));
}

/**
 * A symbol 4,000 pixels wide, 31 em: at 100% it is 500 CSS pixels in 16-pixel
 * text, and at 200%, the most 0.9.2 allows, 1,000, wider than Obsidian's
 * readable line.
 */
export function widerStrokes(): PenStroke[] {
  const strokes: Point[][] = [
    [
      [8, 120],
      [3992, 120],
    ],
  ];
  for (let x = 8; x <= 3992; x += 80) {
    strokes.push([
      [x, 96],
      [x, 144],
    ]);
  }
  return strokes.map((corners) => pen(corners, 12));
}
