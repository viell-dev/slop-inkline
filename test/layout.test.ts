import { describe, expect, it } from "vitest";
import { computeInkLineLayout } from "../src/layout/compute-ink-line-layout";
import { parseDisplayHeightEm } from "../src/layout/parse-display-height-em";

describe("parseDisplayHeightEm", () => {
  it("parses positive em values", () => {
    expect(parseDisplayHeightEm("2em")).toBe(2);
    expect(parseDisplayHeightEm(" 1.25em ")).toBe(1.25);
  });

  it("falls back for non-em, non-positive, and invalid values", () => {
    expect(parseDisplayHeightEm("18px")).toBe(1.5);
    expect(parseDisplayHeightEm("0em")).toBe(1.5);
    expect(parseDisplayHeightEm("-1em")).toBe(1.5);
    expect(parseDisplayHeightEm("em")).toBe(1.5);
  });

  it("keeps parseFloat's loose handling of spaces before the unit", () => {
    expect(parseDisplayHeightEm("2 em")).toBe(2);
  });
});

describe("computeInkLineLayout", () => {
  it("centers the cap-height band in the stored square", () => {
    const layout = computeInkLineLayout(1.5, 0.7);

    expect(layout.capLineY).toBeCloseTo(51.2);
    expect(layout.baselineY).toBeCloseTo(140.8);
    expect(layout.verticalAlignEm).toBeCloseTo(-0.4);
  });

  it("clamps guide positions when the cap ratio exceeds the display height", () => {
    expect(computeInkLineLayout(0.35, 0.7)).toEqual({
      capLineY: 0,
      baselineY: 192,
      verticalAlignEm: 0.175,
    });
  });
});
