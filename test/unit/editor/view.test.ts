import { describe, expect, it } from "vitest";
import { addedStrokes } from "../../../src/editor/view.ts";
import type { Stroke } from "../../../src/format/record.ts";
import type { InkDocument } from "../../../src/ink/document.ts";

const pen: Stroke = { tool: "pen", size: 192, points: [0, 0, 160, 0] };
const fill: Stroke = {
  tool: "eraser",
  points: [0, 0, 160, 0, 80, 160, 0, 0],
  kind: "fill",
};
const sides: Stroke = {
  tool: "eraser",
  size: 192,
  points: [0, 0, 160, 0, 80, 160, 0, 0],
  kind: "polygon",
};
const png = new Uint8Array([1, 2, 3]);

describe("addedStrokes", () => {
  const before: InkDocument = { strokes: [pen] };
  const layer = { x: 0, y: 0, width: 16, height: 16, png };

  it("gives the strokes after the same strokes, one or a filled shape's two", () => {
    expect(addedStrokes(before, { strokes: [pen, sides] })).toEqual([sides]);
    expect(addedStrokes(before, { strokes: [pen, fill, sides] })).toEqual([
      fill,
      sides,
    ]);
    expect(addedStrokes({ strokes: [] }, { strokes: [pen] })).toEqual([pen]);
  });

  it("keeps to a base layer that stays", () => {
    expect(
      addedStrokes(
        { strokes: [pen], base: layer },
        { strokes: [pen, fill, sides], base: layer },
      ),
    ).toEqual([fill, sides]);
    expect(
      addedStrokes({ strokes: [pen] }, { strokes: [pen, sides], base: layer }),
    ).toBeUndefined();
  });

  it("is undefined when nothing changed or a stroke went", () => {
    expect(addedStrokes(before, before)).toBeUndefined();
    expect(addedStrokes(before, { strokes: [pen] })).toBeUndefined();
    expect(addedStrokes({ strokes: [pen, sides] }, before)).toBeUndefined();
  });

  it("is undefined when an earlier stroke changed, as undoing and drawing does", () => {
    expect(
      addedStrokes(
        { strokes: [pen, sides] },
        { strokes: [pen, { ...sides }, fill] },
      ),
    ).toBeUndefined();
  });
});
