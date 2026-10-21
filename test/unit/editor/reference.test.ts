import { describe, expect, it } from "vitest";
import {
  fitWithin,
  isPicturePath,
  movePicture,
  openLinkPath,
  placePicture,
  scaleLimits,
  scalePicture,
  wheelFactor,
} from "../../../src/editor/reference.ts";

describe("placePicture", () => {
  it("fits the picture's height between the lines, centred", () => {
    // 200 × 100 pixels, between 54 and 144: 0.9 document pixels each.
    expect(placePicture(200, 100, 54, 144, 500)).toEqual({
      x: 410,
      y: 54,
      scale: 0.9,
    });
  });

  it("keeps the scale within its limits", () => {
    expect(placePicture(1, 1, 0, 1000, 0).scale).toBe(scaleLimits.max);
    expect(placePicture(100_000, 100_000, 0, 1, 0).scale).toBe(scaleLimits.min);
  });
});

describe("movePicture", () => {
  it("moves without scaling", () => {
    expect(movePicture({ x: 10, y: 20, scale: 2 }, 5, -3)).toEqual({
      x: 15,
      y: 17,
      scale: 2,
    });
  });
});

describe("scalePicture", () => {
  it("keeps the point under the pointer where it is", () => {
    const before = { x: 100, y: 50, scale: 1 };
    const after = scalePicture(before, 2, 150, 70);
    expect(after).toEqual({ x: 50, y: 30, scale: 2 });
    // The picture pixel under (150, 70) is the same before and after.
    const pixel = (p: typeof before) => [
      (150 - p.x) / p.scale,
      (70 - p.y) / p.scale,
    ];
    expect(pixel(after)).toEqual(pixel(before));
  });

  it("stops at the limits, with the point still in place", () => {
    const after = scalePicture({ x: 0, y: 0, scale: 32 }, 4, 10, 10);
    expect(after.scale).toBe(scaleLimits.max);
    expect(after).toEqual({ x: -10, y: -10, scale: 64 });
  });
});

describe("wheelFactor", () => {
  it("grows for a turn away, shrinks for one towards, and undoes itself", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1, 12);
    expect(wheelFactor(0)).toBe(1);
  });
});

describe("wheelFactor's delta modes", () => {
  it("counts a notch the same in pixels, lines, and pages", () => {
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(100), 12);
    expect(wheelFactor(1, 2)).toBeCloseTo(wheelFactor(800), 12);
  });
});

describe("fitWithin", () => {
  it("keeps a size that fits", () => {
    expect(fitWithin(4096, 10, 4096)).toEqual({ width: 4096, height: 10 });
  });

  it("scales a larger size down to the limit, keeping its proportions", () => {
    expect(fitWithin(8192, 2048, 4096)).toEqual({ width: 4096, height: 1024 });
    expect(fitWithin(3000, 6000, 4096)).toEqual({ width: 2048, height: 4096 });
  });

  it("never makes a side smaller than a pixel", () => {
    expect(fitWithin(100_000, 1, 4096)).toEqual({ width: 4096, height: 1 });
  });
});

describe("isPicturePath", () => {
  it("knows the pictures a browser decodes, in any case", () => {
    for (const path of [
      "a.png",
      "b/c.JPG",
      "d.jpeg",
      "e.gif",
      "f.webp",
      "g.avif",
      "h.bmp",
    ]) {
      expect(isPicturePath(path)).toBe(true);
    }
    for (const path of ["a.svg", "b.md", "png", "c.png.md"]) {
      expect(isPicturePath(path)).toBe(false);
    }
  });
});

describe("openLinkPath", () => {
  it("reads the file of a link to this vault", () => {
    expect(
      openLinkPath(
        "obsidian://open?vault=Notes&file=Glyphs%2Ftower%20one.png",
        "Notes",
      ),
    ).toBe("Glyphs/tower one.png");
  });

  it("takes the first link of a list, past comments", () => {
    expect(
      openLinkPath(
        [
          "# dragged",
          "obsidian://open?vault=Notes&file=a.png",
          "obsidian://open?vault=Notes&file=b.png",
        ].join("\r\n"),
        "Notes",
      ),
    ).toBe("a.png");
  });

  it("refuses another vault, another kind of link, and no link", () => {
    expect(
      openLinkPath("obsidian://open?vault=Other&file=a.png", "Notes"),
    ).toBeUndefined();
    expect(
      openLinkPath("obsidian://search?vault=Notes&query=a", "Notes"),
    ).toBeUndefined();
    expect(openLinkPath("https://example.com/a.png", "Notes")).toBeUndefined();
    expect(
      openLinkPath("obsidian://open?vault=Notes", "Notes"),
    ).toBeUndefined();
    expect(openLinkPath("not a link", "Notes")).toBeUndefined();
    expect(openLinkPath("", "Notes")).toBeUndefined();
  });
});
