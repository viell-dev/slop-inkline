// Writes v1-outlines.json: the outlines of the strokes in strokes.ts, rounded
// to thousandths of a pixel, which test/unit/ink/outline.test.ts compares
// with every change. The file is never replaced: if the outlines must change,
// pin the new ones under a new name and describe the change in
// docs/file-format.md.
//
//   node test/fixtures/outline/generate.ts

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { strokeOutline } from "../../../src/ink/outline.ts";
import { pinnedStrokes } from "./strokes.ts";

const round = (value: number): number => Math.round(value * 1000) / 1000;
const outlines = pinnedStrokes.map((stroke) =>
  strokeOutline(stroke).map(([x, y]) => [round(x), round(y)]),
);
await writeFile(
  path.join(import.meta.dirname, "v1-outlines.json"),
  `${JSON.stringify(outlines)}\n`,
  { flag: "wx" },
);
