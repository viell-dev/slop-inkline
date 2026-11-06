import { describe, expect, it } from "vitest";
import type { Stroke } from "../../../src/format/record.ts";
import { limits } from "../../../src/format/record.ts";
import {
  addedStroke,
  documentSpan,
  fitsFormat,
  moveDocument,
  recordFromDocument,
  toUnits,
  type InkDocument,
} from "../../../src/ink/document.ts";
import { strokeBounds } from "../../../src/ink/outline.ts";

const png = Uint8Array.of(137, 80, 78, 71);

const pen: Stroke = {
  tool: "pen",
  size: 64,
  points: [160, 320, 480, 640],
};
const dot: Stroke = {
  tool: "eraser",
  size: 32,
  points: [-16, 48],
};

describe("toUnits", () => {
  it("rounds to the format's integers", () => {
    expect(toUnits(1.53)).toBe(24);
    expect(toUnits(-0.02)).toBe(-0);
  });
});

describe("moveDocument", () => {
  it("moves strokes and the base layer up or down by whole units", () => {
    const base = {
      x: 16,
      y: 32,
      width: 16,
      height: 16,
      png: new Uint8Array(),
    };
    const moved = moveDocument(
      { strokes: [{ tool: "pen", size: 16, points: [1, 2, 3, 4] }], base },
      0,
      -5,
    );
    expect(moved.strokes[0]?.points).toEqual([1, -3, 3, -1]);
    expect(moved.base).toEqual({ ...base, y: 27 });
    expect(() => moveDocument(moved, 0, 0.5)).toThrow(
      "moves are in whole units",
    );
  });

  it("moves strokes and the base layer by whole pixels", () => {
    const document: InkDocument = {
      strokes: [pen, dot],
      base: { x: 0, y: 32, width: 16, height: 16, png },
    };
    expect(moveDocument(document, -10)).toEqual({
      strokes: [
        { ...pen, points: [0, 320, 320, 640] },
        { ...dot, points: [-176, 48] },
      ],
      base: { x: -160, y: 32, width: 16, height: 16, png },
    });
  });

  it("refuses fractions of a pixel, which would round", () => {
    expect(() => moveDocument({ strokes: [] }, 0.5)).toThrow(
      "moves are in whole pixels",
    );
  });
});

describe("recordFromDocument", () => {
  it("moves a document so that the crop starts at 0, losing nothing", () => {
    const document: InkDocument = {
      strokes: [pen, dot],
      base: { x: 48, y: 0, width: 8, height: 8, png },
    };
    const record = recordFromDocument(document, -30);
    expect(record.strokes[1]?.points).toEqual([464, 48]);
    expect(moveDocument(record, -30)).toEqual(document);
  });
});

describe("fitsFormat", () => {
  it("accepts the limits themselves", () => {
    expect(
      fitsFormat({
        strokes: [
          {
            tool: "pen",
            size: limits.strokeSize,
            points: [limits.coordinate, -limits.coordinate],
          },
          { tool: "pen", points: [0, 0, 1, 1, 2, 0], kind: "fill" },
        ],
        base: {
          x: 0,
          y: 0,
          width: limits.coordinate,
          height: 1,
          png,
        },
      }),
    ).toBe(true);
  });

  it("refuses anything past them", () => {
    const stroke = {
      tool: "pen",
      size: 16,
      points: [0, 0],
    } as const;
    expect(
      fitsFormat({
        strokes: [{ ...stroke, points: [limits.coordinate + 1, 0] }],
      }),
    ).toBe(false);
    expect(
      fitsFormat({ strokes: [{ ...stroke, size: limits.strokeSize + 1 }] }),
    ).toBe(false);
    expect(
      fitsFormat({
        strokes: [],
        base: { x: 0, y: 0, width: limits.coordinate + 1, height: 1, png },
      }),
    ).toBe(false);
    expect(
      fitsFormat({
        strokes: [],
        base: { x: 0, y: 0, width: 1, height: 0, png },
      }),
    ).toBe(false);
  });
});

describe("addedStroke", () => {
  const before: InkDocument = { strokes: [pen] };
  const layer = { x: 0, y: 0, width: 16, height: 16, png };

  it("gives the stroke after the same strokes, of either tool", () => {
    expect(addedStroke(before, { strokes: [pen, dot] })).toBe(dot);
    expect(addedStroke({ strokes: [dot] }, { strokes: [dot, pen] })).toBe(pen);
    expect(addedStroke({ strokes: [] }, { strokes: [pen] })).toBe(pen);
  });

  it("keeps to a base layer that stays", () => {
    expect(
      addedStroke(
        { strokes: [pen], base: layer },
        { strokes: [pen, dot], base: layer },
      ),
    ).toBe(dot);
  });

  it("is undefined when nothing changed or a stroke went", () => {
    expect(addedStroke(before, before)).toBeUndefined();
    expect(addedStroke(before, { strokes: [pen] })).toBeUndefined();
    expect(addedStroke({ strokes: [pen, dot] }, before)).toBeUndefined();
  });

  it("is undefined when more than one stroke came", () => {
    expect(addedStroke(before, { strokes: [pen, dot, dot] })).toBeUndefined();
  });

  it("is undefined when an earlier stroke changed, as undoing and drawing does", () => {
    expect(addedStroke(before, { strokes: [dot, pen] })).toBeUndefined();
    const other = { strokes: [dot, dot] };
    expect(addedStroke(before, other)).toBeUndefined();
  });

  it("is undefined after a move, whose strokes are new ones, even if equal", () => {
    const moved = moveDocument(before, 0, 0);
    expect(moved.strokes[0]).toEqual(pen);
    expect(addedStroke(before, { strokes: [...moved.strokes, dot] })).toBe(
      undefined,
    );
  });

  it("is undefined when the base layer came, went, or moved", () => {
    const placed = { strokes: [pen], base: layer };
    const strokes = [pen, dot];
    expect(addedStroke(before, { strokes, base: layer })).toBeUndefined();
    expect(addedStroke(placed, { strokes })).toBeUndefined();
    expect(
      addedStroke(placed, { strokes, base: { ...layer, x: 16 } }),
    ).toBeUndefined();
  });
});

describe("documentSpan", () => {
  it("reaches across every stroke, widened by its radius, and the base layer", () => {
    const document: InkDocument = {
      strokes: [
        { tool: "pen", size: 64, points: [160, 0, 320, 16] },
        { tool: "eraser", size: 32, points: [-160, 0] },
      ],
      // Drawn 48 pixels wide: from 30 to 78.
      base: { x: 480, y: 0, width: 768, height: 16, png: new Uint8Array(0) },
    };
    expect(documentSpan(document)).toEqual({ left: -11, right: 78 });
    expect(documentSpan({ strokes: document.strokes })).toEqual({
      left: -11,
      right: 22,
    });
    expect(documentSpan({ strokes: [] })).toBeUndefined();
  });

  it("reaches as far as a polygon's sharp corners can", () => {
    // Out 20 px and back to 2 px below the start, 2 px wide: the corner's
    // point is cut 4 px past it, and nearly that far out to the right.
    const sharp: Stroke = {
      tool: "pen",
      size: 32,
      points: [0, 0, 320, 0, 0, 32],
      kind: "polygon",
    };
    const span = documentSpan({ strokes: [sharp] });
    expect(span?.right).toBe(strokeBounds(sharp)?.right);
    expect(span?.right).toBeCloseTo(24, 1);
    // Filled, it reaches its corners and no farther.
    const filled: Stroke = {
      tool: "pen",
      points: sharp.points,
      kind: "fill",
    };
    expect(documentSpan({ strokes: [filled] })).toEqual({ left: 0, right: 20 });
  });
});
