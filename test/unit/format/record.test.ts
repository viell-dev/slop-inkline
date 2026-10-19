import { describe, expect, it } from "vitest";
import {
  limits,
  parseRecord,
  serializeRecord,
  type InkRecord,
  type ParseResult,
} from "../../../src/format/record.ts";
import { blank, encodePng } from "../../support/png.ts";

const record: InkRecord = {
  box: { pxPerEm: 128, width: 64, height: 192, baseline: 144 },
  strokes: [
    { tool: "pen", size: 160, pressure: true, points: [0, 0, 0, -16, 32, 255] },
    { tool: "eraser", size: 32, pressure: false, points: [10, 20] },
  ],
};

const withBase: InkRecord = {
  ...record,
  base: {
    x: -32,
    y: 16,
    scale: 1.5,
    png: encodePng(blank(1, 1)),
  },
};

/** The record as JSON, with one field replaced by a path of keys. */
function variant(path: readonly (string | number)[], value: unknown): string {
  const json: unknown = JSON.parse(serializeRecord(withBase));
  let target = json as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    target = target[key] as Record<string | number, unknown>;
  }
  const last = path.at(-1);
  if (last === undefined) throw new Error("empty path");
  if (value === undefined) {
    // Removing the field is the point of the variant.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test helper
    delete target[last];
  } else {
    target[last] = value;
  }
  return JSON.stringify(json);
}

function invalid(result: ParseResult): string {
  if (result.ok || result.reason !== "invalid") {
    throw new Error(
      `expected an invalid record, got ${JSON.stringify(result)}`,
    );
  }
  return result.detail;
}

describe("serializeRecord and parseRecord", () => {
  it("round-trip a record with and without a base layer", () => {
    for (const value of [record, withBase]) {
      expect(parseRecord(serializeRecord(value))).toEqual({
        ok: true,
        record: value,
      });
    }
  });

  it("round-trip an empty drawing", () => {
    const empty: InkRecord = { box: record.box, strokes: [] };
    expect(parseRecord(serializeRecord(empty))).toEqual({
      ok: true,
      record: empty,
    });
  });

  it("write fields in a fixed order", () => {
    const shuffled: InkRecord = {
      strokes: [{ points: [1, 2], pressure: false, size: 3, tool: "pen" }],
      box: { baseline: 1, height: 2, width: 3, pxPerEm: 128 },
    };
    expect(serializeRecord(shuffled)).toBe(
      '{"format":"inkline","version":1,"box":{"pxPerEm":128,"width":3,"height":2,"baseline":1},"strokes":[{"tool":"pen","size":3,"pressure":false,"points":[1,2]}]}',
    );
  });

  it("ignore fields this version does not know", () => {
    const text = variant(["future"], { anything: true });
    expect(parseRecord(variant(["strokes", 0, "color"], "red")).ok).toBe(true);
    expect(parseRecord(text)).toEqual({ ok: true, record: withBase });
  });

  it("report a record from a later version", () => {
    expect(parseRecord(variant(["version"], 2))).toEqual({
      ok: false,
      reason: "newer-version",
      detail: "version 2 is newer than 1",
    });
  });
});

describe("parseRecord refuses", () => {
  const cases: [string, string, string][] = [
    ["text that is not JSON", "{", "not JSON"],
    ["a list", "[]", "record is not an object"],
    ["another format", variant(["format"], "other"), "format is not inkline"],
    [
      "a missing version",
      variant(["version"], undefined),
      "version is not an integer",
    ],
    ["version 0", variant(["version"], 0), "version is not an integer"],
    [
      "a fractional version",
      variant(["version"], 1.5),
      "version is not an integer",
    ],
    ["a missing box", variant(["box"], undefined), "box is not an object"],
    [
      "a tiny em",
      variant(["box", "pxPerEm"], 15),
      "box.pxPerEm is not an integer",
    ],
    [
      "a zero width",
      variant(["box", "width"], 0),
      "box.width is not an integer",
    ],
    [
      "a huge height",
      variant(["box", "height"], 8193),
      "box.height is not an integer",
    ],
    [
      "a baseline below the box",
      variant(["box", "baseline"], 193),
      "box.baseline is not an integer",
    ],
    [
      "a string size",
      variant(["box", "width"], "64"),
      "box.width is not an integer",
    ],
    [
      "strokes that are not a list",
      variant(["strokes"], {}),
      "strokes is not a list",
    ],
    [
      "an unknown tool",
      variant(["strokes", 0, "tool"], "brush"),
      'strokes[0].tool is not "pen" or "eraser"',
    ],
    [
      "a zero size",
      variant(["strokes", 0, "size"], 0),
      "strokes[0].size is not an integer",
    ],
    [
      "a huge size",
      variant(["strokes", 0, "size"], limits.strokeSize + 1),
      "strokes[0].size is not an integer",
    ],
    [
      "a missing pressure flag",
      variant(["strokes", 1, "pressure"], undefined),
      "strokes[1].pressure is not a boolean",
    ],
    [
      "no points",
      variant(["strokes", 1, "points"], []),
      "strokes[1].points is not a non-empty list of 2-number points",
    ],
    [
      "a point without pressure",
      variant(["strokes", 0, "points"], [1, 2]),
      "strokes[0].points is not a non-empty list of 3-number points",
    ],
    [
      "half a point",
      variant(["strokes", 1, "points"], [1, 2, 3]),
      "strokes[1].points is not a non-empty list of 2-number points",
    ],
    [
      "a fractional coordinate",
      variant(["strokes", 1, "points"], [1.5, 2]),
      "strokes[1].points is not an integer",
    ],
    [
      "a coordinate out of range",
      variant(["strokes", 1, "points"], [limits.coordinate + 1, 0]),
      "strokes[1].points is not an integer",
    ],
    [
      "pressure above the maximum",
      variant(["strokes", 0, "points"], [0, 0, 256]),
      "strokes[0].points is not an integer from 0 to 255",
    ],
    [
      "negative pressure",
      variant(["strokes", 0, "points"], [0, 0, -1]),
      "strokes[0].points is not an integer from 0 to 255",
    ],
    [
      "a stroke that is null",
      variant(["strokes", 0], null),
      "strokes[0] is not an object",
    ],
    [
      "a fractional base position",
      variant(["base", "x"], 0.5),
      "base.x is not an integer",
    ],
    [
      "a zero base scale",
      variant(["base", "scale"], 0),
      "base.scale is out of range",
    ],
    [
      "an infinite base scale",
      variant(["base", "scale"], "Infinity"),
      "base.scale is out of range",
    ],
    [
      "a base image that is not text",
      variant(["base", "png"], 5),
      "base.png is not a string",
    ],
    [
      "a base image that is not base64",
      variant(["base", "png"], "a!b="),
      "base.png is not base64",
    ],
    [
      "base64 with a wrong length",
      variant(["base", "png"], "abc"),
      "base.png is not base64",
    ],
    [
      "a base that is not an object",
      variant(["base"], "png"),
      "base is not an object",
    ],
    [
      "a base image that is not a PNG",
      variant(["base", "png"], "R0lGODlh"),
      "base.png is not a PNG",
    ],
  ];

  for (const [name, text, detail] of cases) {
    it(name, () => {
      expect(invalid(parseRecord(text))).toContain(detail);
    });
  }

  it("more strokes than the limit", () => {
    const text = variant(
      ["strokes"],
      Array.from({ length: limits.strokes + 1 }, () => ({
        tool: "pen",
        size: 1,
        pressure: false,
        points: [0, 0],
      })),
    );
    expect(invalid(parseRecord(text))).toBe("more than 10000 strokes");
  });

  it("more points than the limit, across strokes", () => {
    const half = new Array<number>(limits.points).fill(0);
    const stroke = { tool: "pen", size: 1, pressure: false, points: half };
    expect(parseRecord(variant(["strokes"], [stroke])).ok).toBe(true);
    expect(
      invalid(parseRecord(variant(["strokes"], [stroke, stroke, stroke]))),
    ).toBe("more than 1000000 points");
  });

  it("a base image beyond the size limit", () => {
    const text = variant(
      ["base", "png"],
      "A".repeat((limits.baseBytes / 3) * 4 + 4),
    );
    expect(invalid(parseRecord(text))).toBe("base.png is too large");
  });
});
