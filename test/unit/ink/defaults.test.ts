// What Make ink makes of synthetic pictures whose ink is known, and of every
// position of its slider. measure-ink.ts prints these against an earlier commit.

import { describe, expect, it } from "vitest";
import * as pixels from "../../../src/ink/pixels.ts";
import {
  inkGrowth,
  inkPictures,
  madeInk,
  measureInk,
  randomGroups,
  sweepInk,
  type InkCode,
  type InkPicture,
} from "../../support/ink-pictures.ts";

const {
  alphaBounds,
  cropAlpha,
  enlargeFactor,
  enlargedRegion,
  pictureLuminance,
  regionValues,
  thresholdAlpha,
  thresholdContrast,
  thresholdEdge,
  traceRegion,
} = pixels;

/** Pictures that the defaults are known not to make the ink wanted of. */
const limits = new Set([
  // A small bright element draws the threshold to it (#147).
  "Dim H, white block of 1.2%",
  "Dim H, label of white letters",
  // Its alpha limits the ink, which #96 keeps.
  "Glyph of 50% opacity",
  // The threshold splits a glyph of two tones, as it always has.
  "Bold glyph of two tones",
  "bold H, two tones",
  "block with a counter, two tones",
  "block with a notch, two tones",
  "octagon, two tones",
  "disc, two tones",
  "Rectangle of two tones, alpha 64 all round",
  // Round, so not a window: its plate stays the ink.
  "Disc with a light mark",
]);

describe("what Make ink makes of known pictures", () => {
  for (const picture of inkPictures()) {
    it(`${picture.kind}: ${picture.name}`, () => {
      expect(madeInk(measureInk(pixels, picture))).toBe(
        !limits.has(picture.name),
      );
    });
  }
});

/** The part of `picture` in view, at `scale`, with what it takes to trace it. */
function inView(
  picture: InkPicture,
  scale: number,
  region = {
    left: 0,
    top: 0,
    right: Math.ceil(picture.width * scale),
    bottom: Math.ceil(picture.height * scale),
  },
) {
  const luma = pictureLuminance(picture);
  const place = { x: 0, y: 0, scale };
  const factor = enlargeFactor(luma.width, luma.height, place, region);
  if (factor > 1) {
    const fine = enlargedRegion(luma, place, region, factor);
    if (fine === undefined) throw new Error("no samples");
    return fine;
  }
  const part = regionValues(luma, place, region);
  if (part === undefined) throw new Error("no part");
  return { part, place, edge: thresholdEdge };
}

/** Ink as a glyph on a transparent ground makes it: its alpha, whole ramp. */
function glyphInk(
  { part, edge }: ReturnType<typeof inView>,
  threshold: number,
  light: boolean,
) {
  const ramp = thresholdAlpha(part.values, threshold, light, edge);
  const alpha = ramp.map((value, index) =>
    Math.round((value * (part.alpha?.[index] ?? 0)) / 255),
  );
  const bounds = alphaBounds(alpha, part.width);
  return bounds && cropAlpha(alpha, part.width, bounds);
}

/** Whether two images hold the same values: quicker than `toEqual` on them. */
function sameValues(
  a: Uint8ClampedArray | undefined,
  b: Uint8ClampedArray | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((value, at) => value === b[at]);
}

/** Checks that `picture` is left as a glyph, at each scale and selection. */
function expectGlyph(picture: InkPicture): void {
  const luma = pictureLuminance(picture);
  expect(luma.ownGround, picture.name).toBeUndefined();
  // Not one pixel of its alpha is changed.
  const alpha = picture.data.filter((_, index) => index % 4 === 3);
  expect(sameValues(luma.alpha, alpha), picture.name).toBe(true);
  const { width, height } = picture;
  for (const scale of [1, 2.4]) {
    const right = Math.ceil(width * scale);
    const bottom = Math.ceil(height * scale);
    for (const region of [
      { left: 0, top: 0, right, bottom },
      { left: 0, top: 0, right: Math.ceil(right / 2), bottom },
      {
        left: Math.floor(right / 4),
        top: Math.floor(bottom / 4),
        right: Math.ceil((right * 3) / 4),
        bottom: Math.ceil((bottom * 3) / 4),
      },
    ]) {
      const shown = inView(picture, scale, region);
      expect(shown.part.ownGround).toBeUndefined();
      for (const [threshold, light] of [
        [64, true],
        [128, false],
      ] as const) {
        const ink = traceRegion(
          shown.part,
          shown.place,
          threshold,
          light,
          shown.edge,
        );
        expect(
          sameValues(ink?.alpha, glyphInk(shown, threshold, light)),
          `${picture.name} at ${String(scale)}`,
        ).toBe(true);
      }
    }
  }
}

describe("glyphs are not taken for captures", () => {
  const dense = inkPictures().filter(({ kind }) =>
    ["Dense glyphs, tightly cropped", "Transparent grounds"].includes(kind),
  );
  for (const picture of dense) {
    it(`keeps its alpha at each size and selection: ${picture.name}`, () => {
      expectGlyph(picture);
    });
  }

  for (const [group, pictures] of randomGroups(6, 20261106)) {
    if (!group.glyphs) continue;
    it(`keeps its alpha at each size and selection: ${group.name}`, () => {
      for (const picture of pictures()) expectGlyph(picture);
    });
  }

  // From the independent review of #161, which found them cut away.
  it("keeps the edges of a dense bar at its own pixels", () => {
    const bar = inkPictures().find(
      ({ name }) => name === "White bar of 10, alpha 64 at each side",
    );
    if (bar === undefined) throw new Error("no bar");
    const { part, place, edge } = inView(bar, 1);
    const { threshold, light } = pixels.inkDefaults(part);
    const ink = traceRegion(part, place, threshold, light, edge);
    expect([ink?.width, ink?.height]).toEqual([10, 10]);
    expect(ink?.alpha.subarray(0, 10)).toEqual(
      Uint8ClampedArray.from([64, ...new Array<number>(8).fill(255), 64]),
    );
  });

  it("keeps the edges of a dense bar enlarged", () => {
    const bar = inkPictures().find(
      ({ name }) => name === "White bar of 100, alpha 64 at each side",
    );
    if (bar === undefined) throw new Error("no bar");
    const { part, place, edge } = inView(bar, 2.4);
    const { threshold, light } = pixels.inkDefaults(part);
    const ink = traceRegion(part, place, threshold, light, edge);
    expect(ink?.width).toBe(part.width);
    expect(ink?.alpha[0]).toBe(64);
  });

  it("keeps the edge of a dense bar when part of it is selected", () => {
    const bar = inkPictures().find(
      ({ name }) => name === "White bar of 100, alpha 64 at each side",
    );
    if (bar === undefined) throw new Error("no bar");
    const region = { left: 0, top: 20, right: 40, bottom: 60 };
    const { part, place, edge } = inView(bar, 1, region);
    const { threshold, light } = pixels.inkDefaults(part);
    const ink = traceRegion(part, place, threshold, light, edge);
    expect([ink?.width, ink?.height]).toEqual([40, 40]);
    expect(ink?.alpha[0]).toBe(64);
  });
});

/** Making ink with the ramp every threshold's contrast alone would give it. */
const ownRamps: InkCode = {
  ...pixels,
  traceRegion(part, place, threshold, light, edge = thresholdEdge) {
    const tones =
      part.alpha === undefined || part.ownGround === true
        ? (part.tones ?? part.values)
        : undefined;
    const ramp =
      tones === undefined
        ? edge
        : (edge * thresholdContrast(tones, threshold)) / 255;
    const alpha = thresholdAlpha(part.values, threshold, light, ramp).map(
      (value, index) =>
        part.alpha === undefined
          ? value
          : Math.round((value * (part.alpha[index] ?? 0)) / 255),
    );
    const bounds = alphaBounds(alpha, part.width);
    if (bounds === undefined) return undefined;
    return {
      alpha: cropAlpha(alpha, part.width, bounds),
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
      x: place.x + (part.left + bounds.left) * place.scale,
      y: place.y + (part.top + bounds.top) * place.scale,
    };
  },
};

describe("every position of the slider", () => {
  const listed = inkPictures().filter(({ kind }) =>
    ["A small bright element", "Ordinary pictures", "Captures"].includes(kind),
  );

  it("shows what it guards against: a threshold's own ramp makes ink grow", () => {
    const grown = listed.some(
      (picture) => inkGrowth(sweepInk(ownRamps, picture, true).ink, true) > 100,
    );
    expect(grown).toBe(true);
  });

  for (const picture of listed.filter((_, index) => index % 4 === 0)) {
    it(`only fades ink as it moves away: ${picture.name}`, () => {
      for (const light of [true, false]) {
        expect(inkGrowth(sweepInk(pixels, picture, light).ink, light)).toBe(0);
      }
    });
  }

  for (const [group, pictures] of randomGroups(2, 20261106)) {
    it(`only fades ink, and softens no edge: ${group.name}`, () => {
      for (const picture of pictures()) {
        for (const light of [true, false]) {
          const sweep = sweepInk(pixels, picture, light);
          expect(inkGrowth(sweep.ink, light)).toBe(0);
          const own = sweepInk(ownRamps, picture, light);
          const softer = sweep.partial.filter(
            (partial, at) => partial > (own.partial[at] ?? 0),
          );
          expect(softer).toEqual([]);
        }
      }
    }, 30_000);
  }
});
