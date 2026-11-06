// The strokes whose outlines test/fixtures/outline/v1-outlines.json pins: one
// for each path through the outline's algorithm, as docs/file-format.md gives
// it, so that anyone implementing it has something to compare with.

import type { SmoothStroke } from "../../../src/format/record.ts";

export const pinnedStrokes: readonly SmoothStroke[] = [
  // One point: a dot.
  { tool: "pen", size: 160, points: [800, 800] },
  // Points that stay on one point: the same dot.
  { tool: "pen", size: 160, points: [800, 800, 800, 800, 800, 800] },
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
];
