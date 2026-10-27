import { describe, expect, it } from "vitest";
import {
  alphaBounds,
  enlargeFactor,
  enlargedRegion,
  inkDefaults,
  maxPreviewPixels,
  pictureLuminance,
  previewFactor,
  previewShrink,
  regionBounds,
  shrinkLuminance,
  thresholdRange,
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
  traceRegion,
  type RgbaPixels,
} from "../../../src/ink/pixels.ts";
import { limits } from "../../../src/format/record.ts";
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

describe("thresholdRange", () => {
  const all = Uint8ClampedArray.from([0, 15, 128, 240, 255]);

  it("leaves no ink at one end, and makes everything ink at the other", () => {
    expect([...thresholdAlpha(all, thresholdRange.min, false)]).toEqual([
      0, 0, 0, 0, 0,
    ]);
    expect([...thresholdAlpha(all, thresholdRange.max, false)]).toEqual([
      255, 255, 255, 255, 255,
    ]);
    expect([...thresholdAlpha(all, thresholdRange.min, true)]).toEqual([
      255, 255, 255, 255, 255,
    ]);
    expect([...thresholdAlpha(all, thresholdRange.max, true)]).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });
});

describe("pictureLuminance", () => {
  it("keeps each pixel's alpha only when the picture has transparency", () => {
    const opaque = pixels(1, 1, [0, 0, 0, 255]);
    expect(pictureLuminance(opaque)).toEqual({
      width: 1,
      height: 1,
      values: Uint8ClampedArray.from([0]),
    });
    const clear = pixels(2, 1, [255, 255, 255, 255, 0, 0, 0, 0]);
    expect(pictureLuminance(clear).alpha).toEqual(
      Uint8ClampedArray.from([255, 0]),
    );
  });
});

describe("previewFactor and shrinkLuminance", () => {
  it("shrinks only a picture beyond the preview's size", () => {
    expect(previewFactor(1024, 1024)).toBe(1);
    expect(maxPreviewPixels).toBe(1024 * 1024);
    expect(previewFactor(3840, 2160)).toBe(3);
    expect(previewFactor(4096, 4096)).toBe(4);
  });

  it("takes each block's mean, weighted by alpha, with smaller blocks at the edges", () => {
    const picture = {
      width: 3,
      height: 2,
      values: Uint8ClampedArray.from([0, 10, 100, 20, 30, 200]),
      alpha: Uint8ClampedArray.from([255, 255, 0, 255, 255, 0]),
    };
    expect(shrinkLuminance(picture, 2)).toEqual({
      width: 2,
      height: 1,
      // A transparent block's colours count for nothing.
      values: Uint8ClampedArray.from([15, 0]),
      alpha: Uint8ClampedArray.from([255, 0]),
    });
    expect(shrinkLuminance(picture, 1)).toBe(picture);
  });
});

describe("inkDefaults", () => {
  it("takes the smaller part of an opaque picture as the ink", () => {
    const darkOnLight = Uint8ClampedArray.from([0, 255, 255, 255]);
    const lightOnDark = Uint8ClampedArray.from([255, 0, 0, 0]);
    expect(inkDefaults({ values: darkOnLight })).toEqual({
      threshold: 128,
      light: false,
    });
    expect(inkDefaults({ values: lightOnDark }).light).toBe(true);
  });

  it("takes a transparent picture's opaque pixels as the ink", () => {
    // A light glyph, then a dark one, each on a transparent ground that
    // counts as white.
    const alpha = Uint8ClampedArray.from([255, 0, 0, 0]);
    expect(
      inkDefaults({
        values: Uint8ClampedArray.from([250, 255, 255, 255]),
        alpha,
      }).light,
    ).toBe(true);
    expect(
      inkDefaults({ values: Uint8ClampedArray.from([5, 255, 255, 255]), alpha })
        .light,
    ).toBe(false);
  });
});

describe("traceInk with transparency", () => {
  it("leaves a transparent ground empty, even as light ink", () => {
    // A white square on a transparent ground, 2 × 1.
    const picture = pictureLuminance(
      pixels(2, 1, [255, 255, 255, 255, 0, 0, 0, 0]),
    );
    const ink = traceInk(picture, { x: 0, y: 0, scale: 1 }, 128, true, {
      left: 0,
      top: 0,
      right: 2,
      bottom: 1,
    });
    expect(ink).toEqual({
      alpha: Uint8ClampedArray.from([255]),
      width: 1,
      height: 1,
      x: 0,
      y: 0,
    });
  });
});

describe("inkDefaults for a glyph of one grey", () => {
  it("makes all of it full ink, light or dark", () => {
    const alpha = Uint8ClampedArray.from([255, 255, 0, 0]);
    for (const grey of [40, 128, 200]) {
      const values = Uint8ClampedArray.from([grey, grey + 3, 255, 255]);
      const { threshold, light } = inkDefaults({ values, alpha });
      const ink = thresholdAlpha(values.subarray(0, 2), threshold, light);
      expect([...ink]).toEqual([255, 255]);
    }
  });
});

describe("regionBounds and previewShrink", () => {
  const place = { x: 0, y: 0, scale: 0.5 };
  it("finds the picture pixels in a region", () => {
    expect(
      regionBounds(100, 100, place, { left: 10, top: 0, right: 20, bottom: 5 }),
    ).toEqual({ left: 20, top: 0, right: 40, bottom: 10 });
    expect(
      regionBounds(100, 100, place, { left: 60, top: 0, right: 70, bottom: 5 }),
    ).toBeUndefined();
  });

  it("traces the picture itself when what is in view is small enough", () => {
    const small = { left: 0, top: 0, right: 10, bottom: 10 };
    const large = { left: 0, top: 0, right: 2000, bottom: 2000 };
    const middling = { left: 0, top: 0, right: 700, bottom: 700 };
    expect(previewShrink(4000, 4000, place, small)).toBe(1);
    // 1400 × 1400 picture pixels in view: twice smaller is enough.
    expect(previewShrink(4000, 4000, place, middling)).toBe(2);
    expect(previewShrink(4000, 4000, place, large)).toBe(4);
  });
});

describe("anti-aliased glyphs on a transparent ground", () => {
  it("keep each pixel's own colour, so that only the alpha thins the edges", () => {
    // A black core with a half-transparent black edge, on a clear ground.
    const picture = pictureLuminance(
      pixels(3, 1, [0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0]),
    );
    expect([...picture.values]).toEqual([0, 0, 0]);
    expect([...(picture.alpha ?? [])]).toEqual([255, 128, 0]);
    const { threshold, light } = inkDefaults(picture);
    const ink = traceInk(picture, { x: 0, y: 0, scale: 1 }, threshold, light, {
      left: 0,
      top: 0,
      right: 3,
      bottom: 1,
    });
    expect([...(ink?.alpha ?? [])]).toEqual([255, 128]);
  });

  it("shrink by colour weighted by alpha", () => {
    const picture = {
      width: 2,
      height: 1,
      values: Uint8ClampedArray.from([100, 200]),
      alpha: Uint8ClampedArray.from([255, 85]),
    };
    expect(shrinkLuminance(picture, 2)).toEqual({
      width: 1,
      height: 1,
      values: Uint8ClampedArray.from([125]),
      alpha: Uint8ClampedArray.from([170]),
    });
  });
});

describe("enlargeFactor", () => {
  const all = { left: 0, top: 0, right: 10000, bottom: 10000 };

  it("samples a picture finer only where it is enlarged", () => {
    expect(enlargeFactor(16, 16, { x: 0, y: 0, scale: 1 }, all)).toBe(1);
    expect(enlargeFactor(16, 16, { x: 0, y: 0, scale: 0.5 }, all)).toBe(1);
    // Enough that a sample is no larger than a document pixel.
    expect(enlargeFactor(16, 16, { x: 0, y: 0, scale: 5.75 }, all)).toBe(6);
    expect(enlargeFactor(16, 16, { x: 0, y: 0, scale: 2 }, all)).toBe(2);
    // None of it in the region.
    expect(
      enlargeFactor(
        16,
        16,
        { x: 0, y: 0, scale: 4 },
        {
          left: 100,
          top: 0,
          right: 200,
          bottom: 10,
        },
      ),
    ).toBe(1);
  });

  it("stays within the preview's pixels and a base layer's sides", () => {
    // 400 × 400 picture pixels twice finer are 640,000 samples; three times
    // finer would be more than the preview's million.
    expect(enlargeFactor(400, 400, { x: 0, y: 0, scale: 4 }, all)).toBe(2);
    expect(enlargeFactor(600, 600, { x: 0, y: 0, scale: 4 }, all)).toBe(1);
    // A long strip, few samples, but too long a side to be twice finer.
    const long = limits.baseSize / 2 + 1;
    expect(enlargeFactor(long, 1, { x: 0, y: 0, scale: 3 }, all)).toBe(1);
    expect(enlargeFactor(long - 1, 1, { x: 0, y: 0, scale: 3 }, all)).toBe(2);
  });

  it("counts only the part in the region", () => {
    // 600 × 600 is too many to enlarge, but only 100 × 100 is in view.
    const place = { x: 0, y: 0, scale: 4 };
    expect(
      enlargeFactor(600, 600, place, {
        left: 0,
        top: 0,
        right: 400,
        bottom: 400,
      }),
    ).toBe(4);
  });
});

describe("enlargedRegion", () => {
  it("is the region's own pixels when one sample is one pixel", () => {
    const picture = {
      width: 3,
      height: 2,
      values: Uint8ClampedArray.from([1, 2, 3, 4, 5, 6]),
    };
    const place = { x: 10, y: 0, scale: 2 };
    const region = { left: 12, top: 0, right: 16, bottom: 4 };
    expect(enlargedRegion(picture, place, region, 1)).toEqual({
      part: regionValues(picture, place, region),
      place,
      edge: thresholdEdge,
    });
  });

  it("samples between pixel centres, the nearest edge pixel past the ends", () => {
    const picture = {
      width: 2,
      height: 1,
      values: Uint8ClampedArray.from([0, 255]),
    };
    // From the second sample on, the picture's right half, four document
    // pixels wide, then only the second pixel's right half.
    const enlarged = enlargedRegion(
      picture,
      { x: 10, y: 0, scale: 4 },
      { left: 14, top: 0, right: 100, bottom: 1 },
      4,
    );
    expect(enlarged).toEqual({
      part: {
        values: Uint8ClampedArray.from([159, 223, 255, 255]),
        width: 4,
        height: 1,
        left: 4,
        top: 0,
      },
      place: { x: 10, y: 0, scale: 1 },
      edge: thresholdEdge,
    });
    const whole = enlargedRegion(
      picture,
      { x: 10, y: 0, scale: 4 },
      { left: 0, top: 0, right: 100, bottom: 1 },
      4,
    );
    expect([...(whole?.part.values ?? [])]).toEqual([
      0, 0, 32, 96, 159, 223, 255, 255,
    ]);
  });

  it("samples between all four pixels around each sample", () => {
    const picture = {
      width: 2,
      height: 2,
      values: Uint8ClampedArray.from([0, 255, 255, 255]),
    };
    const enlarged = enlargedRegion(
      picture,
      { x: 0, y: 0, scale: 2 },
      { left: 0, top: 0, right: 4, bottom: 4 },
      2,
    );
    expect([...(enlarged?.part.values ?? [])]).toEqual([
      0, 64, 191, 255, 64, 112, 207, 255, 191, 207, 239, 255, 255, 255, 255,
      255,
    ]);
  });

  it("weights colours by alpha, so a transparent ground's colour counts for nothing", () => {
    // A white pixel beside a clear black one.
    const picture = {
      width: 2,
      height: 1,
      values: Uint8ClampedArray.from([255, 0]),
      alpha: Uint8ClampedArray.from([255, 0]),
    };
    const enlarged = enlargedRegion(
      picture,
      { x: 0, y: 0, scale: 4 },
      { left: 0, top: 0, right: 8, bottom: 1 },
      4,
    );
    expect([...(enlarged?.part.values ?? [])]).toEqual([
      255, 255, 255, 255, 255, 255, 0, 0,
    ]);
    expect([...(enlarged?.part.alpha ?? [])]).toEqual([
      255, 255, 223, 159, 96, 32, 0, 0,
    ]);
  });

  it("is undefined when no part of the picture is in the region", () => {
    const picture = { width: 2, height: 1, values: new Uint8ClampedArray(2) };
    expect(
      enlargedRegion(
        picture,
        { x: 0, y: 0, scale: 4 },
        { left: 20, top: 0, right: 30, bottom: 4 },
        4,
      ),
    ).toBeUndefined();
  });

  it("makes ink of an enlarged sharp edge with no partly covered pixels", () => {
    // A black pixel beside a white one, six document pixels each.
    const picture = {
      width: 2,
      height: 1,
      values: Uint8ClampedArray.from([0, 255]),
    };
    const place = { x: 0, y: 0, scale: 6 };
    const region = { left: 0, top: 0, right: 12, bottom: 6 };
    const factor = enlargeFactor(2, 1, place, region);
    expect(factor).toBe(6);
    const enlarged = enlargedRegion(picture, place, region, factor);
    if (enlarged === undefined) throw new Error("no part");
    const ink = traceRegion(
      enlarged.part,
      enlarged.place,
      128,
      false,
      enlarged.edge,
    );
    // The black pixel's own six document pixels, every row full ink.
    expect(ink?.x).toBe(0);
    expect(ink?.width).toBe(6);
    expect(ink?.height).toBe(6);
    expect(new Set(ink?.alpha)).toEqual(new Set([255]));
    // Ink at the picture's own resolution, as before, is one pixel to be
    // enlarged six times over, softening its edge across them.
    const coarse = traceInk(picture, place, 128, false, region);
    expect(coarse?.width).toBe(1);
  });

  it("narrows the threshold's ramp to about one sample however enlarged", () => {
    // A black pixel beside a white one, sixteen document pixels each: the
    // full ramp would spread the edge over two samples.
    const picture = {
      width: 2,
      height: 1,
      values: Uint8ClampedArray.from([0, 255]),
    };
    const place = { x: 0, y: 0, scale: 16 };
    const region = { left: 0, top: 0, right: 32, bottom: 1 };
    const enlarged = enlargedRegion(picture, place, region, 16);
    if (enlarged === undefined) throw new Error("no part");
    expect(enlarged.edge).toBeCloseTo(255 / 16);
    const partial = (edge: number) =>
      [
        ...(traceRegion(enlarged.part, enlarged.place, 128, false, edge)
          ?.alpha ?? []),
      ].filter((value) => value > 0 && value < 255);
    // The edge falls between two samples: nearly full and nearly empty, where
    // the full ramp leaves both well short.
    expect(partial(enlarged.edge)).toEqual([248, 8]);
    expect(partial(thresholdEdge)).toEqual([187, 68]);
  });

  it("keeps to the picture pixels in the region, however the division rounds", () => {
    // Picture pixels 70 and 71 lie in the region; dividing its left edge by
    // the finer scale rounds down to a sample of pixel 69.
    const picture = {
      width: 115,
      height: 1,
      values: new Uint8ClampedArray(115),
    };
    const place = { x: 5.6, y: 0, scale: 2.33 };
    const region = {
      left: 5.6 + 70 * 2.33,
      top: 0,
      right: 5.6 + 72 * 2.33,
      bottom: 1,
    };
    expect(regionBounds(115, 1, place, region)).toMatchObject({
      left: 70,
      right: 72,
    });
    const enlarged = enlargedRegion(picture, place, region, 3);
    expect(enlarged?.part.left).toBe(210);
    expect(enlarged?.part.width).toBe(6);
  });
});
