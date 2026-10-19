import { describe, expect, it } from "vitest";
import type { InkRecord, Stroke } from "../../../src/format/record.ts";
import { limits } from "../../../src/format/record.ts";
import {
  documentFromRecord,
  isWorkable,
  moveDocument,
  recordFromDocument,
  toPressure,
  toUnits,
  workingRange,
  type InkDocument,
} from "../../../src/ink/document.ts";
import { lineBox } from "../../../src/ink/geometry.ts";

const png = Uint8Array.of(137, 80, 78, 71);

const pen: Stroke = {
  tool: "pen",
  size: 64,
  pressure: true,
  points: [160, 320, 200, 480, 640, 100],
};
const dot: Stroke = {
  tool: "eraser",
  size: 32,
  pressure: false,
  points: [-16, 48],
};

describe("toUnits and toPressure", () => {
  it("round to the format's integers", () => {
    expect(toUnits(1.53)).toBe(24);
    expect(toUnits(-0.02)).toBe(-0);
    expect(toPressure(0.5)).toBe(128);
    expect(toPressure(1.7)).toBe(255);
    expect(toPressure(-1)).toBe(0);
  });
});

describe("moveDocument", () => {
  it("moves strokes and the base layer by whole pixels, keeping pressure", () => {
    const document: InkDocument = {
      strokes: [pen, dot],
      base: { x: 0, y: 32, scale: 1, png },
    };
    expect(moveDocument(document, -10)).toEqual({
      strokes: [
        { ...pen, points: [0, 320, 200, 320, 640, 100] },
        { ...dot, points: [-176, 48] },
      ],
      base: { x: -160, y: 32, scale: 1, png },
    });
  });

  it("refuses fractions of a pixel, which would round", () => {
    expect(() => moveDocument({ strokes: [] }, 0.5)).toThrow(
      "moves are in whole pixels",
    );
  });
});

describe("recordFromDocument and documentFromRecord", () => {
  it("round-trip a document cropped at any whole pixel", () => {
    const document: InkDocument = {
      strokes: [pen, dot],
      base: { x: 48, y: 0, scale: 0.5, png },
    };
    const record = recordFromDocument(document, -30, 90);
    expect(record.box).toEqual({ ...lineBox, width: 90 });
    const reopened = documentFromRecord(record);
    if (reopened === undefined) throw new Error("not workable");
    expect(moveDocument(reopened, -30)).toEqual(document);
  });

  it("use a record in the line box exactly", () => {
    const record: InkRecord = {
      box: { ...lineBox, width: 50 },
      strokes: [pen],
    };
    expect(documentFromRecord(record)).toEqual({ strokes: [pen] });
  });

  it("scale a record with another geometry to the line box", () => {
    // 64 px per em with the baseline 10 px above a 96 px box: half scale,
    // and the baseline moves from 86 to 172, so everything moves up 28 px.
    const record: InkRecord = {
      box: { pxPerEm: 64, width: 40, height: 96, baseline: 86 },
      strokes: [
        { tool: "pen", size: 33, pressure: false, points: [160, 1376] },
      ],
      base: { x: 16, y: 0, scale: 1, png },
    };
    expect(documentFromRecord(record)).toEqual({
      strokes: [
        { tool: "pen", size: 66, pressure: false, points: [320, 2304] },
      ],
      base: { x: 32, y: -448, scale: 2, png },
    });
  });
});

describe("isWorkable and documentFromRecord keep documents saveable", () => {
  const box = { pxPerEm: 64, width: 48, height: 192, baseline: 72 };

  it("refuse a conversion that would make a stroke too large", () => {
    const record: InkRecord = {
      box,
      strokes: [
        { tool: "eraser", size: 40_000, pressure: false, points: [0, 0] },
      ],
    };
    expect(documentFromRecord(record)).toBeUndefined();
  });

  it("refuse a conversion that would move a point out of range", () => {
    const record: InkRecord = {
      box,
      strokes: [
        {
          tool: "eraser",
          size: 16,
          pressure: false,
          points: [0, limits.coordinate],
        },
      ],
    };
    expect(documentFromRecord(record)).toBeUndefined();
  });

  it("refuse a conversion that would scale the base layer below the limit", () => {
    const record: InkRecord = {
      box: { pxPerEm: 1024, width: 48, height: 192, baseline: 144 },
      strokes: [],
      base: { x: 0, y: 0, scale: 1 / 64, png },
    };
    expect(documentFromRecord(record)).toBeUndefined();
  });

  it("refuse a record whose points lie beyond the working range", () => {
    const record: InkRecord = {
      box: { ...lineBox, width: 48 },
      strokes: [
        { tool: "pen", size: 16, pressure: false, points: [1600, 1600] },
        {
          tool: "eraser",
          size: 16,
          pressure: false,
          points: [-(workingRange + 1), 1600],
        },
      ],
    };
    expect(documentFromRecord(record)).toBeUndefined();
  });

  it("keep crops within the format's limits for any workable document", () => {
    const document: InkDocument = {
      strokes: [
        {
          tool: "pen",
          size: limits.strokeSize,
          pressure: false,
          points: [workingRange, 0],
        },
        {
          tool: "eraser",
          size: 16,
          pressure: false,
          points: [-workingRange, 0],
        },
      ],
    };
    expect(isWorkable(document)).toBe(true);
    // The furthest a crop can start: the right edge of the far stroke.
    const left = (workingRange + limits.strokeSize) / 16;
    const record = recordFromDocument(document, left, 48);
    for (const stroke of record.strokes) {
      for (const value of stroke.points) {
        expect(Math.abs(value)).toBeLessThanOrEqual(limits.coordinate);
      }
    }
  });

  it("accept pressure values, which are not coordinates", () => {
    expect(
      isWorkable({
        strokes: [
          { tool: "pen", size: 16, pressure: true, points: [0, 0, 255] },
        ],
      }),
    ).toBe(true);
  });
});
