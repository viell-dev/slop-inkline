// Writes v1-outlines.json and v1-pieces.json: the outlines of the strokes in
// strokes.ts, and the polygon pieces and cut strokes' rests there, rounded to
// thousandths of a pixel, which test/unit/ink/outline.test.ts compares with
// every change. From the first stable release these files are never replaced:
// if a shape must change, that is a new format version, with the new ones
// pinned under a new name.
//
//   node test/fixtures/outline/generate.ts

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pinnedOutlines, pinnedPieces } from "./pinned.ts";

for (const [name, value] of [
  ["v1-outlines.json", pinnedOutlines()],
  ["v1-pieces.json", pinnedPieces()],
] as const) {
  await writeFile(
    path.join(import.meta.dirname, name),
    `${JSON.stringify(value)}\n`,
    { flag: "wx" },
  );
}
