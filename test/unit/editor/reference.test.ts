import { describe, expect, it } from "vitest";
import {
  fitWithin,
  isPicturePath,
  isSymbolImage,
  movePicture,
  openLinkPath,
  placePicture,
  placeSymbolImage,
  scaleAboutMiddle,
  scaleLimits,
  scalePicture,
  wheelFactor,
} from "../../../src/editor/reference.ts";
import { recordChunkType } from "../../../src/format/ink-file.ts";
import { writeChunks, type Chunk } from "../../../src/format/png.ts";
import { lineBox } from "../../../src/ink/geometry.ts";

/** A drawing area as a new symbol's surface shows it, 576 × 192 pixels. */
const area = { left: 0, top: 0, right: 576, bottom: 192 };
/** Its middle across, halfway between a cap height of 54 and the baseline. */
const middle = { x: 288, y: 99 };

describe("placePicture", () => {
  it("keeps a picture that fits at its own size, centred on the middle", () => {
    expect(placePicture(40, 20, area, middle)).toEqual({
      x: 268,
      y: 89,
      scale: 1,
    });
    // As large as the area, it fills it.
    expect(placePicture(576, 192, area, middle)).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    });
  });

  it("scales a larger picture down to fit, by the side that is too large", () => {
    // Twice as wide as the area: half the size, centred across.
    expect(placePicture(1152, 100, area, middle)).toEqual({
      x: 0,
      y: 74,
      scale: 0.5,
    });
    // Twice as tall: half the size, as tall as the area.
    expect(placePicture(100, 384, area, middle)).toEqual({
      x: 263,
      y: 0,
      scale: 0.5,
    });
  });

  it("moves it as little as keeps it inside the area", () => {
    // 190 pixels tall about 99 would reach 194: up 2, to the area's bottom.
    expect(placePicture(10, 190, area, middle).y).toBe(2);
    // About a middle near the bottom, it rests on the bottom.
    expect(placePicture(10, 50, area, { x: 288, y: 180 }).y).toBe(142);
    // Across, near either side.
    expect(placePicture(100, 10, area, { x: 10, y: 99 }).x).toBe(0);
    expect(placePicture(100, 10, area, { x: 570, y: 99 }).x).toBe(476);
  });

  it("fits within an area anywhere along the drawing", () => {
    // A zoomed view that shows from 1000 to 1288.
    const zoomed = { left: 1000, top: 0, right: 1288, bottom: 192 };
    expect(placePicture(576, 96, zoomed, { x: 1144, y: 99 })).toEqual({
      x: 1000,
      y: 75,
      scale: 0.5,
    });
  });

  it("keeps the scale within its limits", () => {
    const huge = 100 * 64 * 576;
    expect(placePicture(huge, 1, area, middle).scale).toBe(scaleLimits.min);
  });
});

describe("placeSymbolImage", () => {
  it("puts a symbol's image over its own line, from its left edge", () => {
    expect(placeSymbolImage(lineBox.height)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("shows an image of another height one line tall, as the format says", () => {
    expect(placeSymbolImage(2 * lineBox.height)).toEqual({
      x: 0,
      y: 0,
      scale: 0.5,
    });
  });
});

describe("isSymbolImage", () => {
  /** A 1 × 1 PNG with the chunks `extra` after its header. */
  function png(...extra: Chunk[]): Uint8Array {
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, 1);
    view.setUint32(4, 1);
    header.set([8, 6, 0, 0, 0], 8);
    return writeChunks([
      { type: "IHDR", data: header },
      ...extra,
      // The image data need not decode: only the chunks are read.
      { type: "IDAT", data: new Uint8Array([0]) },
      { type: "IEND", data: new Uint8Array() },
    ]);
  }

  it("knows a PNG with a record chunk, whatever the record holds", () => {
    expect(
      isSymbolImage(png({ type: recordChunkType, data: new Uint8Array(8) })),
    ).toBe(true);
    // Even one this version cannot read.
    expect(
      isSymbolImage(png({ type: recordChunkType, data: new Uint8Array() })),
    ).toBe(true);
  });

  it("takes a PNG with no record chunk, and what is no PNG, for no symbol's", () => {
    expect(
      isSymbolImage(png({ type: "tEXt", data: new Uint8Array([65, 0, 66]) })),
    ).toBe(false);
    expect(isSymbolImage(new TextEncoder().encode("not a picture"))).toBe(
      false,
    );
    expect(isSymbolImage(png().subarray(0, 30))).toBe(false);
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

describe("scaleAboutMiddle", () => {
  it("keeps the picture's middle where it is", () => {
    // 40 × 20 pixels from (100, 50): its middle is at (120, 60).
    const after = scaleAboutMiddle({ x: 100, y: 50, scale: 1 }, 40, 20, 2);
    expect(after).toEqual({ x: 80, y: 40, scale: 2 });
  });

  it("keeps it there at the limits", () => {
    const after = scaleAboutMiddle({ x: 0, y: 0, scale: 32 }, 1, 1, 4);
    expect(after).toEqual({ x: -16, y: -16, scale: 64 });
  });
});

describe("wheelFactor", () => {
  it("grows for a turn away, shrinks for one towards, and undoes itself", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1, 12);
    expect(wheelFactor(0)).toBe(1);
  });

  it("scales by about a twentieth for a notch, so that 14 notches double", () => {
    expect(wheelFactor(-100)).toBeCloseTo(Math.exp(0.05), 12);
    expect(wheelFactor(-100) ** 14).toBeGreaterThan(2);
    expect(wheelFactor(-100) ** 13).toBeLessThan(2);
  });

  it("goes by the pixels turned, however they come", () => {
    // A trackpad's small turns, as one turn of their total.
    expect(wheelFactor(-4) ** 25).toBeCloseTo(wheelFactor(-100), 12);
    expect(wheelFactor(-1) ** 2).toBeCloseTo(wheelFactor(-2), 12);
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
