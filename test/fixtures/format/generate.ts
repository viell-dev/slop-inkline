// Writes the version 1 golden files in this directory. They pin what version
// 1 files contain, so that every later version keeps reading them. The script
// writes only fixtures that do not exist yet, and never replaces a file: add a
// new fixture under a new name, then run
//
//   node test/fixtures/format/generate.ts
//
// The drawings are synthetic, and the pixels are not renderings of the
// strokes: these files test the format, not drawing.

import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeInkFile } from "../../../src/format/ink-file.ts";
import { serializeRecord, type InkRecord } from "../../../src/format/record.ts";
import { blank, encodePng } from "../../support/png.ts";

const directory = import.meta.dirname;

/** A grey square, half covered, as a base layer's pixels. */
function baseImage(): Uint8Array {
  const size = 4;
  const data = new Uint8Array(size * size * 4);
  for (let index = 0; index < size * size; index++) {
    data.set([124, 124, 124, index % 2 === 0 ? 255 : 0], index * 4);
  }
  return encodePng({ width: size, height: size, data });
}

const fixtures: Record<string, InkRecord> = {
  "v1-strokes": {
    box: { pxPerEm: 128, width: 64, height: 192, baseline: 144 },
    strokes: [
      {
        tool: "pen",
        size: 160,
        pressure: true,
        points: [160, 800, 128, 480, 1600, 200, 800, 2304, 255],
      },
      { tool: "pen", size: 96, pressure: false, points: [512, 1024] },
      {
        tool: "eraser",
        size: 320,
        pressure: false,
        points: [-80, 1200, 1100, 1200],
      },
    ],
  },
  "v1-base": {
    box: { pxPerEm: 128, width: 40, height: 192, baseline: 144 },
    strokes: [{ tool: "eraser", size: 64, pressure: false, points: [64, 64] }],
    base: { x: 160, y: 320, scale: 2, png: baseImage() },
  },
  // Strokes drawn on the grid, cut flat where they end on it.
  "v1-cuts": {
    box: { pxPerEm: 128, width: 48, height: 192, baseline: 144 },
    strokes: [
      {
        tool: "pen",
        size: 96,
        pressure: false,
        points: [128, 512, 128, 2304],
        cut: { start: "up", end: "down" },
      },
      {
        tool: "eraser",
        size: 96,
        pressure: false,
        points: [0, 1600, 640, 1600],
        cut: { end: "right" },
      },
    ],
  },
  // Polygons: a closed triangle, and an open zigzag cut at its start.
  "v1-polygons": {
    box: { pxPerEm: 128, width: 64, height: 192, baseline: 144 },
    strokes: [
      {
        tool: "pen",
        size: 96,
        pressure: false,
        points: [128, 2304, 512, 1024, 896, 2304, 128, 2304],
        kind: "polygon",
      },
      {
        tool: "eraser",
        size: 48,
        pressure: false,
        points: [256, 1280, 512, 1792, 768, 1280],
        kind: "polygon",
        cut: { start: "up" },
      },
    ],
  },
};

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

for (const [name, record] of Object.entries(fixtures)) {
  const image = path.join(directory, `${name}.ink.png`);
  const expected = path.join(directory, `${name}.json`);
  const present = [await exists(image), await exists(expected)];
  if (present.every(Boolean)) continue;
  if (present.some(Boolean)) {
    throw new Error(`${name} is half there; restore it from Git`);
  }
  const png = encodePng(blank(record.box.width, record.box.height));
  // "wx" fails rather than replace a file that appeared meanwhile.
  await writeFile(image, await writeInkFile(png, record), { flag: "wx" });
  await writeFile(expected, `${serializeRecord(record)}\n`, { flag: "wx" });
  console.log(`wrote ${name}`);
}
