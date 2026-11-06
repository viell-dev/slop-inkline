// That ink only fades as Make ink's slider moves away from it (#160), and that
// no edge is softer for that.

import { describe, expect, it } from "vitest";
import {
  enlargedRegion,
  thresholdAlpha,
  thresholdContrast,
  thresholdEdge,
  thresholdRamp,
  thresholdRange,
  traceRegion,
  type PicturePlace,
  type Region,
} from "../../../src/ink/pixels.ts";
import { dimH } from "../../support/dim-picture.ts";

const side = 96;

/** Every position of the slider, from the low end up. */
const thresholds = Array.from(
  { length: thresholdRange.max - thresholdRange.min + 1 },
  (_, step) => thresholdRange.min + step,
);

/** A dim H with a white block in a corner, as #160 reports. */
function labelled(): Uint8ClampedArray {
  const values = dimH(side);
  for (let y = side - 8; y < side; y++) {
    values.fill(255, y * side + side - 12, (y + 1) * side);
  }
  return values;
}

/** An H of `ground` and `ink`, with `noise` levels of noise each way. */
function noisy(
  ground: number,
  ink: number,
  noise: number,
  seed: number,
): Uint8ClampedArray {
  let state = seed;
  return dimH(side, { ground, ink }).map((value) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return value + (state % (2 * noise + 1)) - noise;
  });
}

const pictures: readonly (readonly [string, Uint8ClampedArray])[] = [
  ["a dim H", dimH(side)],
  ["a dim H with a label", labelled()],
  ["black on white", dimH(side, { ground: 255, ink: 0 })],
  ["white on black", dimH(side, { ground: 0, ink: 255 })],
  ["grey on white", dimH(side, { ground: 255, ink: 128 })],
  ["dim dark on light", dimH(side, { ground: 50, ink: 8 })],
  ["noisy, on light", noisy(235, 20, 12, 3)],
  ["noisy, dim", noisy(8, 50, 6, 4)],
];

/**
 * The most that any one pixel gains in a step, as the slider moves away from
 * the ink: up for light ink, down for dark. `alphaAt` gives a threshold's ink.
 */
function growth(
  light: boolean,
  alphaAt: (threshold: number) => Uint8ClampedArray,
): number {
  let most = 0;
  let before = alphaAt(thresholds[light ? 0 : thresholds.length - 1] ?? 0);
  for (const threshold of light ? thresholds : thresholds.toReversed()) {
    const alpha = alphaAt(threshold);
    for (let at = 0; at < alpha.length; at++) {
      most = Math.max(most, (alpha[at] ?? 0) - (before[at] ?? 0));
    }
    before = alpha;
  }
  return most;
}

/** How many pixels of `alpha` are partly covered. */
function partial(alpha: Uint8ClampedArray): number {
  return alpha.filter((value) => value > 0 && value < 255).length;
}

const contrastAlone = (values: Uint8ClampedArray) => (threshold: number) =>
  (thresholdEdge * thresholdContrast(values, threshold)) / 255;

const ramped = (values: Uint8ClampedArray) => (threshold: number) =>
  thresholdRamp(values, threshold, thresholdEdge);

describe("thresholdRamp", () => {
  it("is the threshold's share of the contrast, away from a jump", () => {
    const values = dimH(side);
    expect(thresholdRamp(values, 29, thresholdEdge)).toBeCloseTo(
      contrastAlone(values)(29),
      10,
    );
  });

  it("leaves a picture of black and white the whole ramp, up to its end", () => {
    const values = Uint8ClampedArray.from([0, 0, 255, 255, 255]);
    // Past white, nothing is on the light side, and the ramp narrows towards
    // that from half of a whole ramp short of it.
    for (let threshold = 1; threshold <= 240; threshold++) {
      expect(thresholdRamp(values, threshold, thresholdEdge)).toBe(
        thresholdEdge,
      );
    }
  });

  it("changes by at most two levels from one threshold to the next", () => {
    const values = labelled();
    // The contrast alone jumps, past the strokes' brightest level.
    expect(thresholdContrast(values, 52)).toBeGreaterThan(
      thresholdContrast(values, 51) + 100,
    );
    for (const threshold of thresholds.slice(1)) {
      const before = thresholdRamp(values, threshold - 1, thresholdEdge);
      const here = thresholdRamp(values, threshold, thresholdEdge);
      expect(Math.abs(here - before)).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it("holds at the narrower ramps of finer samples", () => {
    const values = labelled();
    for (const threshold of thresholds) {
      const here = thresholdRamp(values, threshold, 8);
      expect(here).toBeLessThanOrEqual(
        (8 * contrastAlone(values)(threshold)) / 32,
      );
      const next = thresholdRamp(values, threshold + 1, 8);
      expect(Math.abs(next - here)).toBeLessThanOrEqual(2 + 1e-9);
    }
  });
});

describe("every position of the slider", () => {
  it("would give some pixels ink back, by the contrast alone", () => {
    const grown = pictures.filter(
      ([, values]) =>
        growth(true, (threshold) =>
          thresholdAlpha(
            values,
            threshold,
            true,
            contrastAlone(values)(threshold),
          ),
        ) > 0,
    );
    expect(grown.length).toBeGreaterThanOrEqual(4);
  });

  for (const [name, values] of pictures) {
    it(`only fades each pixel as it moves away, in ${name}`, () => {
      for (const light of [true, false]) {
        const alphaAt = (threshold: number) =>
          thresholdAlpha(values, threshold, light, ramped(values)(threshold));
        expect(growth(light, alphaAt)).toBe(0);
      }
    });

    it(`softens no edge, in ${name}`, () => {
      for (const light of [true, false]) {
        const softer = thresholds.filter((threshold) => {
          const ramp = ramped(values)(threshold);
          const own = contrastAlone(values)(threshold);
          return (
            partial(thresholdAlpha(values, threshold, light, ramp)) >
            partial(thresholdAlpha(values, threshold, light, own))
          );
        });
        expect(softer).toEqual([]);
      }
    });
  }

  /** What `traceRegion` makes of `part`, in place, at `threshold`. */
  function traced(
    part: Region,
    place: PicturePlace,
    light: boolean,
    edge: number,
  ) {
    const scale = 1 / place.scale;
    return (threshold: number) => {
      const whole = new Uint8ClampedArray(part.width * part.height);
      const ink = traceRegion(part, place, threshold, light, edge);
      if (ink === undefined) return whole;
      const left = Math.round((ink.x - place.x) * scale) - part.left;
      const top = Math.round((ink.y - place.y) * scale) - part.top;
      for (let y = 0; y < ink.height; y++) {
        whole.set(
          ink.alpha.subarray(y * ink.width, (y + 1) * ink.width),
          (y + top) * part.width + left,
        );
      }
      return whole;
    };
  }

  it("only fades each pixel it traces, past strokes beside a label", () => {
    // From #160: a trace of the strokes came back past their brightest level.
    const part = {
      values: labelled(),
      width: side,
      height: side,
      left: 0,
      top: 0,
    };
    const own = { x: 0, y: 0, scale: 1 };
    for (const light of [true, false]) {
      expect(growth(light, traced(part, own, light, thresholdEdge))).toBe(0);
    }
  });

  it("only fades each pixel among finer samples too", () => {
    const picture = { width: side, height: side, values: labelled() };
    const place = { x: 0, y: 0, scale: 5 };
    const region = { left: 0, top: 0, right: 200, bottom: 200 };
    const enlarged = enlargedRegion(picture, place, region, 5);
    if (enlarged === undefined) throw new Error("no part");
    const { part, place: fine, edge } = enlarged;
    for (const light of [true, false]) {
      expect(growth(light, traced(part, fine, light, edge))).toBe(0);
    }
  });
});
