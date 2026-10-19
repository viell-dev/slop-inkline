import { describe, expect, it } from "vitest";
import { cropSpan, fontGuides, joinSpans } from "../../../src/editor/guides.ts";

describe("fontGuides", () => {
  it("places the font's lines in the line box, from its baseline", () => {
    expect(
      fontGuides({ ascent: 1, descent: 0.25, capHeight: 0.75, xHeight: 0.5 }),
    ).toEqual([
      { name: "ascender", y: 16 },
      { name: "cap height", y: 48 },
      { name: "x-height", y: 80 },
      { name: "baseline", y: 144 },
      { name: "descender", y: 176 },
    ]);
  });

  it("leaves out lines outside the line box", () => {
    expect(
      fontGuides({
        ascent: 1.5,
        descent: 0.5,
        capHeight: 0.7,
        xHeight: 0.5,
      }).map((guide) => guide.name),
    ).toEqual(["cap height", "x-height", "baseline"]);
  });
});

describe("cropSpan", () => {
  it("is the crop a save makes: the ink plus side bearings", () => {
    // Ink from 98 to 202 pixels, with 8 to spare on each side.
    expect(cropSpan({ left: 98, right: 202 })).toEqual({
      left: 90,
      right: 210,
    });
  });

  it("is the narrowest image for no ink or a dot", () => {
    expect(cropSpan(undefined)).toEqual({ left: 0, right: 48 });
    // 2 to 20 with side bearings, widened evenly to 48.
    expect(cropSpan({ left: 10, right: 12 })).toEqual({ left: -13, right: 35 });
  });
});
describe("joinSpans", () => {
  it("reaches across both, either of which may be empty", () => {
    expect(joinSpans({ left: 0, right: 10 }, { left: -5, right: 4 })).toEqual({
      left: -5,
      right: 10,
    });
    expect(joinSpans(undefined, { left: 1, right: 2 })).toEqual({
      left: 1,
      right: 2,
    });
    expect(joinSpans(undefined, undefined)).toBeUndefined();
  });
});
