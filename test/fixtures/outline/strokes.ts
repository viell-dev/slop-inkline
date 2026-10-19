// The strokes whose outlines test/fixtures/outline/v1-outlines.json pins.

import type { Stroke } from "../../../src/format/record.ts";

export const pinnedStrokes: readonly Stroke[] = [
  { tool: "pen", size: 160, pressure: false, points: [800, 800] },
  {
    tool: "pen",
    size: 128,
    pressure: false,
    points: [320, 1600, 640, 960, 1280, 640, 1920, 960, 2240, 1600],
  },
  {
    tool: "pen",
    size: 192,
    pressure: true,
    points: [400, 2000, 40, 800, 1200, 160, 1400, 600, 255, 2000, 400, 90],
  },
  {
    tool: "eraser",
    size: 256,
    pressure: false,
    points: [0, 1500, 3000, 1500],
  },
];
