// The drawings behind the version 1 golden files in this directory, which
// test/e2e/manual/fixtures.e2e.ts saves with the real editor code in Obsidian's
// Chromium, so that their pixels are what their records draw. Each file pins a
// rule of docs/file-format.md: a change that breaks one fails the tests in
// test/unit/format/ink-file.test.ts or test/e2e/specs/format.e2e.ts. The
// drawings are synthetic.

import type { Stroke } from "../../../src/format/record.ts";

/** A golden base layer's image: how many pixels a side, and their alpha. */
export interface GoldenImage {
  readonly side: number;
  readonly alpha: (x: number, y: number) => number;
}

/** A drawing, with where a base layer's image goes, if it has one. */
export interface GoldenDrawing {
  readonly strokes: readonly Stroke[];
  readonly base?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * A base layer for enlarging: a ramp across a shape that the edges of the image
 * cut, so that its scaling shows.
 */
const rampImage: GoldenImage = {
  side: 8,
  alpha: (x, y) => ((x + y) % 3 === 0 ? 0 : Math.round(((x + 1) * 255) / 8)),
};

/**
 * A base layer for reducing: lines a pixel wide, far enough apart that a filter
 * that samples only a few source pixels misses most of them.
 */
const linesImage: GoldenImage = {
  side: 960,
  alpha: (x, y) => (x % 13 === 0 || y % 17 === 0 ? 255 : 0),
};

/** The image of each golden file with a base layer. */
export const goldenImages: Readonly<Record<string, GoldenImage>> = {
  "v1-base": rampImage,
  "v1-base-reduced": linesImage,
};

/** A text chunk's data as a writer must write it, as `iTXt`. */
export function iTxtData(keyword: string, text: string): Uint8Array {
  return new TextEncoder().encode(`${keyword}\0\0\0\0\0${text}`);
}

/**
 * What each golden file that has text says about its symbol, by keyword: two
 * values each, the second outside Latin-1, as an `iTXt` chunk that a save
 * carries before the image data.
 */
export const goldenText: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "v1-text": {
    "Inkline reading": "TA\nた",
    "Inkline translation": "rice field\n田",
  },
};

export const goldenFiles: Readonly<Record<string, GoldenDrawing>> = {
  // Strokes of each tool: a curve, a dot, a loop that crosses itself, which
  // the nonzero rule keeps solid, a sharp turn, and an eraser across them.
  "v1-strokes": {
    strokes: [
      {
        tool: "pen",
        size: 160,
        points: [160, 800, 480, 1400, 960, 1700, 1600, 1500, 2000, 900],
      },
      { tool: "pen", size: 96, points: [2400, 1200] },
      {
        tool: "pen",
        size: 192,
        points: [
          2800, 2000, 3200, 1200, 3600, 800, 4000, 1200, 3600, 1600, 3200, 1200,
          3600, 800, 4400, 800,
        ],
      },
      {
        tool: "pen",
        size: 96,
        points: [4800, 800, 5600, 800, 6400, 800, 5600, 830, 4800, 830],
      },
      { tool: "eraser", size: 64, points: [0, 1300, 7000, 1300] },
    ],
  },
  // Flat ends: both ends of a stroke cut at the lines they stop on, one end
  // alone, and a stroke that comes back near its cut end, which the rest of
  // it draws in the cut box again.
  "v1-cuts": {
    strokes: [
      {
        tool: "pen",
        size: 128,
        points: [512, 512, 512, 1500, 512, 2304],
        cut: { start: "up", end: "down" },
      },
      {
        tool: "pen",
        size: 96,
        points: [1200, 800, 1400, 1600, 1600, 2304],
        cut: { end: "down" },
      },
      {
        tool: "pen",
        size: 96,
        points: [
          2200, 2304, 2200, 1200, 2500, 900, 2800, 1200, 2800, 2000, 2400, 2240,
          2300, 1800,
        ],
        cut: { start: "down" },
      },
      {
        tool: "eraser",
        size: 64,
        points: [512, 1000, 512, 1400],
        cut: { start: "up", end: "down" },
      },
    ],
  },
  // Polygons: closed, open, a corner past the mitre limit, a side that
  // doubles back, a lone corner, and an eraser.
  "v1-polygons": {
    strokes: [
      {
        tool: "pen",
        size: 96,
        points: [128, 2304, 512, 1024, 896, 2304, 128, 2304],
        kind: "polygon",
      },
      {
        tool: "pen",
        size: 64,
        points: [1200, 1000, 1500, 2200, 1800, 1000, 2100, 2200],
        kind: "polygon",
      },
      {
        tool: "pen",
        size: 96,
        points: [2400, 1200, 3200, 1400, 2400, 1600],
        kind: "polygon",
      },
      {
        tool: "pen",
        size: 64,
        points: [3600, 1200, 4400, 1200, 3800, 1200],
        kind: "polygon",
      },
      { tool: "pen", size: 160, points: [4800, 1600], kind: "polygon" },
      {
        tool: "eraser",
        size: 48,
        points: [256, 1760, 768, 1760],
        kind: "polygon",
      },
    ],
  },
  // Fills: a triangle, a star drawn in one line, which fills its middle, and
  // a hole.
  "v1-fill": {
    strokes: [
      { tool: "pen", points: [128, 2304, 512, 1024, 896, 2304], kind: "fill" },
      {
        tool: "pen",
        points: [
          1600, 800, 2000, 2200, 960, 1300, 2240, 1300, 1200, 2200, 1600, 800,
        ],
        kind: "fill",
      },
      {
        tool: "eraser",
        points: [448, 1792, 576, 1792, 576, 2048, 448, 2048, 448, 1792],
        kind: "fill",
      },
    ],
  },
  // A base layer stretched to a size that is no whole multiple of its image,
  // an eraser through it, and a pen over it.
  "v1-base": {
    strokes: [
      { tool: "eraser", size: 64, points: [400, 1400, 1400, 1400] },
      { tool: "pen", size: 96, points: [200, 1800, 1500, 1800] },
    ],
    base: { x: 160, y: 800, width: 1170, height: 1170 },
  },
  // A base layer drawn smaller than its image, as a large picture is opened: a
  // fifth of its size, the whole height of the line box.
  "v1-base-reduced": {
    strokes: [],
    base: { x: 0, y: 0, width: 3072, height: 3072 },
  },
  // A sign with text about it, which is all this file is for.
  "v1-text": {
    strokes: [
      { tool: "pen", size: 160, points: [320, 1000, 1760, 1000] },
      { tool: "pen", size: 160, points: [1040, 480, 1040, 2000] },
    ],
  },
};
