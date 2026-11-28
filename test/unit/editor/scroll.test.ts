import { describe, expect, it } from "vitest";
import {
  minThumb,
  scrollSpan,
  scrollSpare,
  scrollValue,
  thumbOf,
  viewAt,
} from "../../../src/editor/scroll.ts";

/** A zoomed view of 288 document pixels, from 144 to 432. */
const visible = { left: 144, right: 432 };

describe("scrollSpan", () => {
  it("is nothing while the view shows the image with room to spare", () => {
    expect(scrollSpan(visible, { left: 250, right: 300 })).toBeUndefined();
    expect(
      scrollSpan(visible, {
        left: visible.left + scrollSpare,
        right: visible.right - scrollSpare,
      }),
    ).toBeUndefined();
  });

  it("is nothing while there is no ink", () => {
    expect(scrollSpan(visible, undefined)).toBeUndefined();
  });

  it("spans the image with half an em to spare, and the view", () => {
    expect(scrollSpan(visible, { left: 0, right: 600 })).toEqual({
      left: -scrollSpare,
      right: 600 + scrollSpare,
    });
    // Reaching past one side only.
    expect(scrollSpan(visible, { left: 300, right: 500 })).toEqual({
      left: 144,
      right: 500 + scrollSpare,
    });
  });

  it("keeps the view in it once moved off the drawing, to show the way back", () => {
    expect(
      scrollSpan({ left: 1000, right: 1288 }, { left: 0, right: 48 }),
    ).toEqual({ left: -scrollSpare, right: 1288 });
  });

  it("takes less than a pixel past the view for none", () => {
    expect(
      scrollSpan(visible, {
        left: 250,
        right: visible.right - scrollSpare + 0.5,
      }),
    ).toBeUndefined();
  });
});

describe("thumbOf", () => {
  const span = { left: 0, right: 1152 };

  it("is as much of the track as the view is of the span, as far along", () => {
    // A quarter of the span, a quarter along what is left.
    expect(thumbOf(span, { left: 216, right: 504 }, 400)).toEqual({
      left: 75,
      width: 100,
    });
    expect(thumbOf(span, { left: 0, right: 288 }, 400).left).toBe(0);
    expect(thumbOf(span, { left: 864, right: 1152 }, 400).left).toBe(300);
  });

  it("is never narrower than it can be taken by", () => {
    const thumb = thumbOf({ left: 0, right: 100_000 }, visible, 400);
    expect(thumb.width).toBe(minThumb);
    expect(thumb.left).toBeGreaterThanOrEqual(0);
  });

  it("stays on the track", () => {
    expect(thumbOf(span, { left: -100, right: 188 }, 400).left).toBe(0);
    expect(thumbOf(span, { left: 2000, right: 2288 }, 400).left).toBe(300);
    expect(thumbOf(span, visible, 10).width).toBe(10);
  });
});

describe("viewAt", () => {
  const span = { left: 0, right: 1152 };

  it("undoes thumbOf", () => {
    for (const left of [0, 216, 500, 864]) {
      const shown = { left, right: left + 288 };
      const thumb = thumbOf(span, shown, 400);
      expect(viewAt(span, 288, 400, thumb)).toBeCloseTo(left + 144, 9);
    }
  });

  it("keeps the view within the span, however far the thumb is dragged", () => {
    expect(viewAt(span, 288, 400, { left: -50, width: 100 })).toBe(144);
    expect(viewAt(span, 288, 400, { left: 900, width: 100 })).toBe(1008);
  });
});

describe("scrollValue", () => {
  it("says how far along the span the view is, from 0 to 100", () => {
    const span = { left: 0, right: 1152 };
    expect(scrollValue(span, { left: 0, right: 288 })).toBe(0);
    expect(scrollValue(span, { left: 432, right: 720 })).toBe(50);
    expect(scrollValue(span, { left: 864, right: 1152 })).toBe(100);
    expect(scrollValue(span, { left: 2000, right: 2288 })).toBe(100);
    expect(scrollValue(span, { left: 0, right: 1152 })).toBe(0);
  });
});
