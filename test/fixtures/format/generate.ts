// Writes the version 1 golden files in this directory. They pin what version
// 1 files contain, so that every later version keeps reading them: run this
// only to add a fixture, never to update one.
//
//   node test/fixtures/format/generate.ts
//
// The drawings are synthetic, and the pixels are not renderings of the
// strokes: these files test the format, not drawing.

import { writeFile } from "node:fs/promises";
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
};

for (const [name, record] of Object.entries(fixtures)) {
  const png = encodePng(blank(record.box.width, record.box.height));
  const file = await writeInkFile(png, record);
  await writeFile(path.join(directory, `${name}.ink.png`), file);
  await writeFile(
    path.join(directory, `${name}.json`),
    `${serializeRecord(record)}\n`,
  );
}
