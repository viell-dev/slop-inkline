// Where Make ink starts, measured on synthetic pictures whose ink is known.
// measure-ink.ts prints the same pictures' results against an earlier commit.

import { describe, expect, it } from "vitest";
import * as pixels from "../../../src/ink/pixels.ts";
import { dimH, dimLevels, labelledDimH } from "../../support/dim-picture.ts";
import {
  inkPictures,
  madeInk,
  measureInk,
  randomFrom,
  randomGroups,
  type InkCode,
  type InkPicture,
} from "../../support/ink-pictures.ts";

const { inkDefaults, otsuThreshold } = pixels;

/** Pictures that the defaults are known not to make the ink wanted of. */
const limits = new Set([
  // Too near the strokes to tell from them.
  "Dim H, white block beside the strokes",
  // Its alpha limits the ink, which #96 keeps.
  "Glyph of 50% opacity",
  // The threshold splits the glyph's two tones.
  "Bold glyph of two tones",
  // More than a third of each is shadow, so its transparency is its ground.
  "Dim light ink, corners and a shadow of 28",
  "Dark ink on light, corners and a shadow of 28",
  "Dim dark ink, corners and a shadow of 28",
  // The same picture as a dim outline with a label beside it: the symbol
  // stays whole, and the outline becomes ink too.
  "White symbol at the side of a dim outline",
]);

/** The pictures whose first threshold is Otsu's, as it always was. */
function keepsOtsu(picture: InkPicture): boolean {
  return ["Ordinary pictures", "Noisy backgrounds"].includes(picture.kind);
}

/** Making ink as it was: Otsu's method, on an opaque picture. */
const otsuOnly: InkCode = {
  ...pixels,
  inkDefaults(part) {
    if (part.alpha !== undefined) return inkDefaults(part);
    const threshold = otsuThreshold(part.values);
    return { threshold, light: pixels.lightInk(part.values, threshold) };
  },
};

describe("where Make ink starts", () => {
  for (const picture of inkPictures()) {
    it(`${picture.kind}: ${picture.name}`, () => {
      const result = measureInk(pixels, picture);
      expect(madeInk(result)).toBe(!limits.has(picture.name));
      if (keepsOtsu(picture)) {
        const before = measureInk(otsuOnly, picture);
        expect(result.threshold).toBe(before.threshold);
        expect(result.light).toBe(before.light);
      }
    });
  }

  it("keeps a symbol whole where it takes it for a label", () => {
    const picture = inkPictures().find(
      ({ name }) => name === "White symbol at the side of a dim outline",
    );
    if (picture === undefined) throw new Error("no picture");
    const result = measureInk(pixels, picture);
    expect(result.found).toBe(1);
    expect(result.stray).toBeGreaterThan(0.02);
  });
});

describe("random pictures", () => {
  // Few enough for every run; measure-ink.ts takes as many as are wanted.
  for (const [group, pictures] of randomGroups(15, 20261105)) {
    it(`${group.name}: harms none${group.ambiguous ? " of its ink" : ""}`, () => {
      let harmed = 0;
      let lost = 0;
      for (const picture of pictures()) {
        const before = measureInk(otsuOnly, picture);
        const after = measureInk(pixels, picture);
        if (madeInk(before) && !madeInk(after)) harmed++;
        if (after.found < before.found - 0.02) lost++;
      }
      expect(lost).toBe(0);
      if (!group.ambiguous) expect(harmed).toBe(0);
    }, 30_000);
  }

  it("fixes most pictures of a dim symbol with something bright aside", () => {
    const group = randomGroups(30, 20261105)[0];
    if (group === undefined) throw new Error("no group");
    let failed = 0;
    let fixed = 0;
    for (const picture of group[1]()) {
      if (madeInk(measureInk(otsuOnly, picture))) continue;
      failed++;
      if (madeInk(measureInk(pixels, picture))) fixed++;
    }
    expect(failed).toBeGreaterThan(10);
    expect(fixed / failed).toBeGreaterThan(0.6);
  }, 30_000);
});

describe("a label off to one side", () => {
  const side = 48;

  it("does not draw the threshold from the strokes", () => {
    const values = labelledDimH(side);
    expect(otsuThreshold(values)).toBeGreaterThan(dimLevels.ink);
    const { threshold, light } = inkDefaults({ values, width: side });
    expect(threshold).toBeGreaterThan(dimLevels.ground);
    expect(threshold).toBeLessThan(dimLevels.ink);
    expect(light).toBe(true);
  });

  it("is found the same way among a capture's opaque pixels", () => {
    const values = labelledDimH(side);
    const alpha = new Uint8ClampedArray(values.length).fill(255);
    alpha[0] = 0;
    const { threshold, light } = inkDefaults({ values, width: side, alpha });
    expect(threshold).toBeLessThan(dimLevels.ink);
    expect(light).toBe(true);
  });

  it("is smaller than a sixteenth of the picture", () => {
    // The same corner block, grown past a sixteenth of the picture: still
    // clear of the strokes, it is no longer taken for a label.
    const values = labelledDimH(side);
    const across = 13;
    for (let y = side - across; y < side; y++) {
      values.fill(255, y * side + side - across, (y + 1) * side);
    }
    expect(across * across).toBeGreaterThan((side * side) / 16);
    const { threshold } = inkDefaults({ values, width: side });
    expect(threshold).toBe(otsuThreshold(values));
  });

  it("is not looked for where the rest is only noise", () => {
    // Noise within a flat border, which no strokes or tones make clean, and a
    // bright block in a corner: the noise could pass for thin strokes.
    const values = labelledDimH(side).fill(dimLevels.ground);
    const random = randomFrom(5);
    for (let y = 2; y < side - 2; y++) {
      for (let x = 2; x < side - 2; x++) {
        values[y * side + x] = 20 + Math.round(random() * 30);
      }
    }
    for (let y = side - 2; y < side; y++) {
      values.fill(255, y * side + side - 20, (y + 1) * side);
    }
    const { threshold } = inkDefaults({ values, width: side });
    expect(threshold).toBe(otsuThreshold(values));
  });

  it("is not looked for past strokes that run off the picture", () => {
    // An H as tall as the picture, its stems crossing its border four times:
    // it could be lines behind a small symbol.
    const values = dimH(side);
    for (let y = side - 4; y < side; y++) {
      values.fill(255, y * side + side - 8, (y + 1) * side);
    }
    const { threshold } = inkDefaults({ values, width: side });
    expect(threshold).toBe(otsuThreshold(values));
  });

  it("is not looked for in a picture of one value or two", () => {
    const flat = new Uint8ClampedArray(64).fill(90);
    expect(inkDefaults({ values: flat, width: 8 }).threshold).toBe(128);
    const two = new Uint8ClampedArray(64).fill(10);
    two[0] = 200;
    expect(inkDefaults({ values: two, width: 8 }).threshold).toBe(
      otsuThreshold(two),
    );
  });
});
