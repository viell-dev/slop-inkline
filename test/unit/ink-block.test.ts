// That the end-to-end tests' measure of a block of ink, by which they compare
// a symbol's shape on the screen and in a PDF with the shape it was drawn in,
// finds a block's edges to a fraction of a pixel.

import { describe, expect, it } from "vitest";
import {
  commonColour,
  furthestColour,
  measureBlock,
  type Rgb,
} from "../support/ink-block.ts";

const ground: Rgb = [250, 248, 246];
const ink: Rgb = [40, 30, 20];

/** How much of the pixel at `at` lies between `from` and `to`. */
function overlap(from: number, to: number, at: number): number {
  return Math.max(0, Math.min(to, at + 1) - Math.max(from, at));
}

/**
 * A picture of `ground`, with a block of `ink` from `left` to `right` and
 * from `top` to `bottom`, each pixel the block's edge crosses mixed by how
 * much of it the block covers, as a browser draws it.
 */
function picture(
  width: number,
  height: number,
  block: { left: number; top: number; right: number; bottom: number },
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const share =
        overlap(block.left, block.right, x) *
        overlap(block.top, block.bottom, y);
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        data[at + channel] = Math.round(
          (ground[channel] ?? 0) +
            ((ink[channel] ?? 0) - (ground[channel] ?? 0)) * share,
        );
      }
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("measureBlock", () => {
  it("finds a block's edges and size to a fraction of a pixel", () => {
    const block = { left: 10.3, top: 5.25, right: 371.8, bottom: 18.7 };
    const pixels = picture(400, 30, block);
    const found = measureBlock(
      pixels,
      { left: 0, top: 0, right: 400, bottom: 30 },
      ground,
      ink,
    );
    expect(found).toBeDefined();
    for (const edge of ["left", "top", "right", "bottom"] as const) {
      expect(Math.abs((found?.[edge] ?? 0) - block[edge])).toBeLessThan(0.05);
    }
    expect(Math.abs((found?.width ?? 0) - 361.5)).toBeLessThan(0.05);
    expect(Math.abs((found?.height ?? 0) - 13.45)).toBeLessThan(0.05);
    expect(found?.colour).toEqual(ink);
  });

  it("counts only what lies in the region", () => {
    const pixels = picture(100, 40, {
      left: 20,
      top: 10,
      right: 80,
      bottom: 30,
    });
    const found = measureBlock(
      pixels,
      { left: 0, top: 0, right: 50, bottom: 40 },
      ground,
      ink,
    );
    expect(found?.left).toBeCloseTo(20, 5);
    expect(found?.right).toBeCloseTo(50, 5);
    expect(found?.height).toBeCloseTo(20, 5);
  });

  it("finds no block in the ground alone", () => {
    const pixels = picture(20, 20, { left: 0, top: 0, right: 0, bottom: 0 });
    const region = { left: 0, top: 0, right: 20, bottom: 20 };
    expect(measureBlock(pixels, region, ground, ink)).toBeUndefined();
    expect(furthestColour(pixels, region, ground)).toEqual(ground);
  });

  it("tells the ground and the ink by their colours", () => {
    const pixels = picture(40, 20, {
      left: 5.5,
      top: 4,
      right: 30,
      bottom: 16,
    });
    const region = { left: 0, top: 0, right: 40, bottom: 20 };
    expect(commonColour(pixels, region)).toEqual(ground);
    expect(furthestColour(pixels, region, ground)).toEqual(ink);
  });
});
