import { describe, expect, it } from "vitest";
import { measuredAlone, toMeasureAlone } from "../../../src/editor/view.ts";
import type { Stroke } from "../../../src/format/record.ts";
import { addedStrokes } from "../../../src/ink/document.ts";

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

describe("toMeasureAlone", () => {
  const penFill: Stroke = { ...fill, tool: "pen" };
  const penSides: Stroke = { ...sides, tool: "pen" };

  it("measures a pen stroke, or a filled shape's two, each alone", () => {
    expect(measuredAlone).toBe(2);
    expect(
      toMeasureAlone(addedStrokes({ strokes: [] }, { strokes: [pen] })),
    ).toEqual([pen]);
    expect(
      toMeasureAlone(
        addedStrokes({ strokes: [pen] }, { strokes: [pen, penFill, penSides] }),
      ),
    ).toEqual([penFill, penSides]);
  });

  it("measures everything again for the eraser's, or for any other change", () => {
    expect(
      toMeasureAlone(
        addedStrokes({ strokes: [pen] }, { strokes: [pen, fill, sides] }),
      ),
    ).toBeUndefined();
    expect(toMeasureAlone(undefined)).toBeUndefined();
  });

  it("measures everything again for a draft of many strokes restored over a picture alone", () => {
    // A symbol that is only its base layer, then a pen-only draft of 500
    // strokes put over it in one step: one full measurement, not 500.
    const layer = { x: 0, y: 0, width: 16, height: 16, png };
    const restored = Array.from({ length: 500 }, (_, index): Stroke => ({
      ...pen,
      points: [index * 16, 0, index * 16 + 160, 0],
    }));
    const added = addedStrokes(
      { strokes: [], base: layer },
      { strokes: restored, base: layer },
    );
    expect(added).toHaveLength(500);
    expect(toMeasureAlone(added)).toBeUndefined();
    // So is a frame that finds three pen strokes together.
    expect(toMeasureAlone([pen, penFill, penSides])).toBeUndefined();
  });
});
