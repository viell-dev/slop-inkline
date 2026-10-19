import { describe, expect, it } from "vitest";
import {
  crop,
  display,
  lineBox,
  minWidth,
  sideBearing,
} from "../../../src/ink/geometry.ts";

describe("lineBox", () => {
  it("is 1.5 em tall with the baseline 0.375 em above the bottom", () => {
    expect(lineBox.height / lineBox.pxPerEm).toBe(1.5);
    expect((lineBox.height - lineBox.baseline) / lineBox.pxPerEm).toBe(0.375);
  });

  it("fits the default font measured in Obsidian at 16 px", () => {
    // Ascent 17, descent 5, line height 24, from the 2026-10-18 measurement.
    const em = 16;
    const box = (lineBox.height / lineBox.pxPerEm) * em;
    const belowBaseline =
      ((lineBox.height - lineBox.baseline) / lineBox.pxPerEm) * em;
    expect(box).toBe(24);
    expect(belowBaseline).toBeGreaterThanOrEqual(5);
    expect(box - belowBaseline).toBeGreaterThanOrEqual(17);
  });
});

describe("crop", () => {
  it("adds a side bearing to each side of the ink, in whole pixels", () => {
    expect(crop({ left: 10.4, top: 0, right: 90.2, bottom: 5 })).toEqual({
      left: 10 - sideBearing,
      width: 91 - 10 + 2 * sideBearing,
    });
  });

  it("widens narrow ink evenly to the minimum width", () => {
    const narrow = crop({ left: 100, top: 0, right: 104, bottom: 1 });
    expect(narrow.width).toBe(minWidth);
    const before = 100 - narrow.left;
    const after = narrow.left + narrow.width - 104;
    expect(Math.abs(before - after)).toBeLessThanOrEqual(1);
  });

  it("keeps negative positions", () => {
    expect(crop({ left: -50, top: 0, right: 50, bottom: 1 })).toEqual({
      left: -58,
      width: 116,
    });
  });

  it("gives an empty drawing the minimum width", () => {
    expect(crop(undefined)).toEqual({ left: 0, width: minWidth });
  });
});

describe("display", () => {
  it("shows the line box at 1.5 em with its baseline on the text's", () => {
    expect(display({ ...lineBox, width: 64 })).toEqual({
      heightEm: 1.5,
      verticalAlignEm: -0.375,
    });
  });

  it("follows another box's own geometry", () => {
    expect(
      display({ pxPerEm: 100, width: 10, height: 200, baseline: 150 }),
    ).toEqual({ heightEm: 2, verticalAlignEm: -0.5 });
  });
});
