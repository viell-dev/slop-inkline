import { describe, expect, it } from "vitest";
import {
  alphaBounds,
  cropAlpha,
  inkAlpha,
  inkBounds,
  inkPixels,
  lightInk,
  luminance,
  otsuThreshold,
  repeatPixels,
  thresholdAlpha,
  regionValues,
  thresholdEdge,
  traceInk,
  type RgbaPixels,
} from "../../../src/ink/pixels.ts";
import { inkGrey } from "../../../src/ink/render.ts";

function pixels(width: number, height: number, rgba: number[]): RgbaPixels {
  return { width, height, data: Uint8ClampedArray.from(rgba) };
}

const clear = [0, 0, 0, 0];

describe("inkBounds", () => {
  it("finds the rectangle around every pixel with alpha", () => {
    const image = pixels(3, 3, [
      ...clear,
      ...clear,
      ...clear,
      ...clear,
      9,
      9,
      9,
      1,
      ...clear,
      ...clear,
      ...clear,
      0,
      0,
      0,
      255,
    ]);
    expect(inkBounds(image)).toEqual({ left: 1, top: 1, right: 3, bottom: 3 });
  });

  it("finds nothing in a transparent image", () => {
    expect(
      inkBounds(pixels(2, 1, [...clear, 255, 255, 255, 0])),
    ).toBeUndefined();
  });
});

describe("inkAlpha", () => {
  it("keeps the alpha of a picture with transparency", () => {
    const image = pixels(2, 1, [255, 0, 0, 255, 0, 0, 255, 100]);
    expect([...inkAlpha(image)]).toEqual([255, 100]);
  });

  it("turns an opaque picture's darkness into ink", () => {
    const image = pixels(
      4,
      1,
      [
        255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255,
        // Pure green is bright: little ink.
        0, 255, 0, 255,
      ],
    );
    expect([...inkAlpha(image)]).toEqual([0, 255, 127, 73]);
  });

  it("converts the prototype's greyscale files exactly", () => {
    const greys = [255, 254, 200, 3, 0];
    const image = pixels(
      greys.length,
      1,
      greys.flatMap((grey) => [grey, grey, grey, 255]),
    );
    expect([...inkAlpha(image)]).toEqual(greys.map((grey) => 255 - grey));
  });
});

describe("inkPixels", () => {
  it("makes grey ink with the given alpha", () => {
    expect([...inkPixels(2, 1, Uint8ClampedArray.of(0, 200))]).toEqual([
      inkGrey,
      inkGrey,
      inkGrey,
      0,
      inkGrey,
      inkGrey,
      inkGrey,
      200,
    ]);
  });
});

describe("repeatPixels", () => {
  it("repeats each value across and down", () => {
    const values = Uint8ClampedArray.of(1, 2, 3, 4, 5, 6);
    // prettier-ignore
    expect([...repeatPixels(values, 3, 2, 2)]).toEqual([
      1, 1, 2, 2, 3, 3,
      1, 1, 2, 2, 3, 3,
      4, 4, 5, 5, 6, 6,
      4, 4, 5, 5, 6, 6,
    ]);
  });

  it("returns the values unchanged for a factor of 1", () => {
    const values = Uint8ClampedArray.of(7, 8);
    expect(repeatPixels(values, 2, 1, 1)).toBe(values);
  });
});

describe("luminance", () => {
  it("weighs the channels as Rec. 709 does, on white where transparent", () => {
    const image = pixels(4, 1, [
      ...[255, 255, 255, 255],
      ...[0, 0, 0, 255],
      ...[0, 255, 0, 255],
      ...[0, 0, 0, 0],
    ]);
    expect([...luminance(image)]).toEqual([
      255,
      0,
      Math.round(0.7152 * 255),
      255,
    ]);
  });

  it("lays half-transparent black on white as mid grey", () => {
    expect([...luminance(pixels(1, 1, [0, 0, 0, 128]))]).toEqual([127]);
  });
});

describe("otsuThreshold", () => {
  it("splits two groups between them", () => {
    const values = Uint8ClampedArray.from([
      ...new Array<number>(30).fill(40),
      ...new Array<number>(70).fill(200),
    ]);
    const threshold = otsuThreshold(values);
    expect(threshold).toBeGreaterThan(40);
    expect(threshold).toBeLessThanOrEqual(200);
  });

  it("puts each value of a two-value picture on its own side", () => {
    const values = Uint8ClampedArray.from([10, 10, 11, 11]);
    expect(otsuThreshold(values)).toBe(11);
  });

  it("takes the middle of thresholds that split equally well", () => {
    const values = Uint8ClampedArray.from([0, 0, 255, 255, 255]);
    expect(otsuThreshold(values)).toBe(128);
  });

  it("gives the middle for a picture of one value", () => {
    expect(otsuThreshold(Uint8ClampedArray.from([90, 90, 90]))).toBe(128);
  });
});

describe("lightInk", () => {
  it("takes the smaller part of the picture as the ink", () => {
    const darkGround = Uint8ClampedArray.from([0, 0, 0, 255]);
    const lightGround = Uint8ClampedArray.from([255, 255, 255, 0]);
    expect(lightInk(darkGround, 128)).toBe(true);
    expect(lightInk(lightGround, 128)).toBe(false);
  });
});

describe("thresholdAlpha", () => {
  it("makes dark values ink, with a ramp across the threshold", () => {
    const values = Uint8ClampedArray.from([0, 99, 100, 255]);
    const alpha = [...thresholdAlpha(values, 100, false)];
    expect(alpha[0]).toBe(255);
    expect(alpha[3]).toBe(0);
    // Either side of the threshold, about half: the ramp's middle is between.
    expect(alpha[1]).toBeGreaterThan(127);
    expect(alpha[2]).toBeLessThan(128);
    expect((alpha[1] ?? 0) + (alpha[2] ?? 0)).toBe(255);
  });

  it("makes light values ink with light", () => {
    const values = Uint8ClampedArray.from([0, 255]);
    expect([...thresholdAlpha(values, 100, true)]).toEqual([0, 255]);
  });

  it("is full or empty beyond half the edge from the threshold", () => {
    const half = thresholdEdge / 2;
    const values = Uint8ClampedArray.from([100 - half - 1, 100 + half]);
    expect([...thresholdAlpha(values, 100, false)]).toEqual([255, 0]);
  });
});

describe("alphaBounds and cropAlpha", () => {
  const alpha = Uint8ClampedArray.from([
    ...[0, 0, 0, 0],
    ...[0, 9, 0, 0],
    ...[0, 0, 7, 0],
  ]);

  it("finds the rectangle around every value above zero", () => {
    expect(alphaBounds(alpha, 4)).toEqual({
      left: 1,
      top: 1,
      right: 3,
      bottom: 3,
    });
    expect(alphaBounds(new Uint8ClampedArray(6), 3)).toBeUndefined();
  });

  it("crops to a rectangle", () => {
    expect([
      ...cropAlpha(alpha, 4, { left: 1, top: 1, right: 3, bottom: 3 }),
    ]).toEqual([9, 0, 0, 7]);
  });
});

describe("traceInk", () => {
  // A 4 × 4 picture: white, with a black 2 × 2 square in its middle.
  const white = [255, 255, 255, 255];
  const black = [0, 0, 0, 255];
  const picture = pixels(4, 4, [
    ...white,
    ...white,
    ...white,
    ...white,
    ...white,
    ...black,
    ...black,
    ...white,
    ...white,
    ...black,
    ...black,
    ...white,
    ...white,
    ...white,
    ...white,
    ...white,
  ]);
  const values = { width: 4, height: 4, values: luminance(picture) };
  const everywhere = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };

  it("crops to the ink, and says where it sits", () => {
    const ink = traceInk(
      values,
      { x: 100, y: 50, scale: 2 },
      128,
      false,
      everywhere,
    );
    expect(ink).toEqual({
      alpha: Uint8ClampedArray.from([255, 255, 255, 255]),
      width: 2,
      height: 2,
      x: 102,
      y: 52,
    });
  });

  it("keeps only what lies in the region, by whole picture pixels", () => {
    // The region ends inside the square's first column, which it keeps.
    const ink = traceInk(values, { x: 0, y: 0, scale: 10 }, 128, false, {
      left: 0,
      top: 0,
      right: 15,
      bottom: 40,
    });
    expect(ink).toMatchObject({ width: 1, height: 2, x: 10, y: 10 });
  });

  it("takes the light ground as ink with light", () => {
    const ink = traceInk(
      values,
      { x: 0, y: 0, scale: 1 },
      128,
      true,
      everywhere,
    );
    expect(ink?.width).toBe(4);
    expect(
      [...(ink?.alpha ?? [])].filter((value) => value === 255),
    ).toHaveLength(12);
  });

  it("finds nothing outside the picture or without ink", () => {
    const place = { x: 0, y: 0, scale: 1 };
    expect(
      traceInk(values, place, 128, false, {
        left: 10,
        top: 0,
        right: 20,
        bottom: 4,
      }),
    ).toBeUndefined();
    // The top row is all ground.
    expect(
      traceInk(values, place, 128, false, {
        left: 0,
        top: 0,
        right: 4,
        bottom: 1,
      }),
    ).toBeUndefined();
  });
});

describe("regionValues", () => {
  it("cuts out the part in the region, and says where it starts", () => {
    const picture = {
      width: 3,
      height: 2,
      values: Uint8ClampedArray.from([1, 2, 3, 4, 5, 6]),
    };
    const part = regionValues(
      picture,
      { x: 10, y: 0, scale: 2 },
      {
        left: 12,
        top: 0,
        right: 16,
        bottom: 4,
      },
    );
    expect(part).toEqual({
      values: Uint8ClampedArray.from([2, 3, 5, 6]),
      width: 2,
      height: 2,
      left: 1,
      top: 0,
    });
  });
});
