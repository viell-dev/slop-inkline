// The strokes whose shapes the files beside this one pin, so that anyone
// implementing docs/file-format.md has something to compare with:
// v1-outlines.json has one smooth stroke for each path through the outline's
// steps, and v1-pieces.json the polygons and cut strokes of the golden files.
// A dot has no outline: its shape is its circle.

import type { SmoothStroke } from "../../../src/format/record.ts";

export const pinnedStrokes: readonly SmoothStroke[] = [
  // Two points, which get three more between them.
  { tool: "pen", size: 96, points: [320, 1600, 2240, 640] },
  // Three points.
  { tool: "pen", size: 96, points: [320, 1600, 960, 640, 1920, 960] },
  // A curve.
  {
    tool: "pen",
    size: 128,
    points: [320, 1600, 640, 960, 1280, 640, 1920, 960, 2240, 1600],
  },
  // Long and straight.
  { tool: "eraser", size: 256, points: [0, 1500, 3000, 1500] },
  // Shorter than the end's noise: only its last point has sides.
  { tool: "pen", size: 16, points: [800, 800, 816, 808, 832, 800] },
  // Doubling back: a sharp corner, drawn as a half circle on each side.
  {
    tool: "pen",
    size: 96,
    points: [400, 400, 800, 400, 1200, 400, 1600, 400, 1200, 416, 800, 416],
  },
  // Sharp corners one after another.
  {
    tool: "pen",
    size: 160,
    points: [
      400, 800, 1200, 800, 400, 1000, 1200, 1000, 400, 1200, 1200, 1200, 400,
      1400,
    ],
  },
  // A loop that crosses itself, as its outline does.
  {
    tool: "pen",
    size: 192,
    points: [
      400, 1600, 800, 800, 1200, 400, 1600, 800, 1200, 1200, 800, 800, 1200,
      400, 2000, 400,
    ],
  },
  // Points that repeat, which the path leaves out.
  {
    tool: "pen",
    size: 64,
    points: [320, 320, 320, 320, 640, 480, 640, 480, 960, 320, 960, 320],
  },
  // A wide brush over a short way, within its own width of the start.
  { tool: "pen", size: 1024, points: [800, 800, 880, 840, 960, 800, 1040, 840] },
  // A turn of exactly a right angle, where the comparison with zero that
  // chooses a sharp corner is a tie: the arithmetic of the steps makes the
  // product 0, so this has no half circle. Each stroke after it moves a point
  // one unit, to either side of the tie, and has 74 corners or 48 as that side
  // does.
  { tool: "pen", size: 192, points: [3840, 256, 4160, 2496, 160, 2096] },
  { tool: "pen", size: 192, points: [3840, 256, 4161, 2496, 160, 2096] },
  { tool: "pen", size: 192, points: [3840, 256, 4159, 2496, 160, 2096] },
  // A point about the brush's radius from where a half circle ended, whose
  // side point stays or goes by how that distance is taken.
  {
    tool: "pen",
    size: 320,
    points: [
      15680, 1120, 15680, 800, 15680, 560, 15680, 480, 15520, 480, 15200, 480,
      15200, 640, 15520, 640, 15520, 560, 15520, 240, 15840, 240, 15840, -80,
      16080, -80,
    ],
  },
];
