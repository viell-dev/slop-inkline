import { describe, expect, it } from "vitest";
import {
  limits,
  parseRecord,
  serializeRecord,
  type InkRecord,
  type ParseResult,
} from "../../../src/format/record.ts";
import { blank, encodePng, header, pixelChunks } from "../../support/png.ts";
import { pngSignature, writeChunks } from "../../../src/format/png.ts";

const record: InkRecord = {
  strokes: [
    { tool: "pen", size: 160, points: [0, 0, 0, -16] },
    { tool: "eraser", size: 32, points: [10, 20] },
  ],
};

const withBase: InkRecord = {
  ...record,
  base: {
    x: -32,
    y: 16,
    width: 24,
    height: 48,
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
  if (result.ok) {
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
    const empty: InkRecord = { strokes: [] };
    expect(parseRecord(serializeRecord(empty))).toEqual({
      ok: true,
      record: empty,
    });
  });

  it("write fields in a fixed order", () => {
    const shuffled: InkRecord = {
      strokes: [{ points: [1, 2], size: 3, tool: "pen" }],
    };
    expect(serializeRecord(shuffled)).toBe(
      '{"strokes":[{"tool":"pen","size":3,"points":[1,2]}]}',
    );
    const placed: InkRecord = {
      strokes: [],
      base: { png: encodePng(blank(1, 1)), height: 4, width: 3, y: 2, x: 1 },
    };
    expect(serializeRecord(placed)).toMatch(
      /^\{"strokes":\[\],"base":\{"x":1,"y":2,"width":3,"height":4,"png":"/,
    );
  });

  it("round-trip strokes cut flat at their ends, writing the start first", () => {
    const cut: InkRecord = {
      strokes: [
        {
          tool: "pen",
          size: 32,
          points: [0, 0, 0, 64],
          cut: { end: "down", start: "up" },
        },
        {
          tool: "eraser",
          size: 32,
          points: [0, 0, 64, 0],
          cut: { end: "up" },
        },
      ],
    };
    const text = serializeRecord(cut);
    expect(text).toContain(
      '"points":[0,0,0,64],"cut":{"start":"up","end":"down"}',
    );
    expect(text).toContain('"cut":{"end":"up"}');
    expect(parseRecord(text)).toEqual({ ok: true, record: cut });
  });

  it("round-trip polygons, writing the kind after the points", () => {
    const polygons: InkRecord = {
      strokes: [
        {
          tool: "pen",
          size: 32,
          points: [0, 0, 160, 0, 160, 160, 0, 0],
          kind: "polygon",
        },
      ],
    };
    const text = serializeRecord(polygons);
    expect(text).toContain(
      '"size":32,"points":[0,0,160,0,160,160,0,0],"kind":"polygon"}',
    );
    expect(parseRecord(text)).toEqual({ ok: true, record: polygons });
    expect(serializeRecord(record)).not.toContain("kind");
  });

  it("round-trip fills, which have no size", () => {
    const filled: InkRecord = {
      strokes: [
        { tool: "pen", points: [0, 0, 160, 0, 160, 160, 0, 0], kind: "fill" },
        { tool: "eraser", points: [0, 0, 64, 0, 64, 64], kind: "fill" },
      ],
    };
    const text = serializeRecord(filled);
    expect(text).toContain('{"tool":"eraser","points":[0,0,64,0,64,64],"kind"');
    expect(text).not.toContain("size");
    expect(parseRecord(text)).toEqual({ ok: true, record: filled });
  });

  it("write no cut for a stroke without one", () => {
    expect(serializeRecord(record)).not.toContain("cut");
  });

  it("ignore fields this version does not know, and do not keep them", () => {
    const text = variant(["future"], { anything: true });
    expect(parseRecord(variant(["strokes", 0, "color"], "red")).ok).toBe(true);
    expect(parseRecord(variant(["base", "note"], "kept?")).ok).toBe(true);
    const parsed = parseRecord(text);
    expect(parsed).toEqual({ ok: true, record: withBase });
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(serializeRecord(parsed.record)).not.toContain("future");
  });

  it("read fields in any order, with white space", () => {
    const text = ` { "base" : null , "strokes" : [ ] } `.replace(
      '"base" : null , ',
      "",
    );
    expect(parseRecord(text)).toEqual({ ok: true, record: { strokes: [] } });
    expect(
      parseRecord('{"strokes":[{"points":[0,0],"size":1,"tool":"pen"}]}'),
    ).toEqual({
      ok: true,
      record: { strokes: [{ tool: "pen", size: 1, points: [0, 0] }] },
    });
  });
});

describe("parseRecord refuses", () => {
  const cases: [string, string, string][] = [
    ["text that is not JSON", "{", "not JSON"],
    ["a list", "[]", "record is not an object"],
    ["a byte order mark", `\uFEFF${serializeRecord(record)}`, "not JSON"],
    [
      "strokes that are not a list",
      variant(["strokes"], {}),
      "strokes is not a list",
    ],
    [
      "a missing list of strokes",
      variant(["strokes"], undefined),
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
      "a missing size",
      variant(["strokes", 1, "size"], undefined),
      "strokes[1].size is not an integer",
    ],
    [
      "no points",
      variant(["strokes", 1, "points"], []),
      "strokes[1].points is not a non-empty list of x, y points",
    ],
    [
      "half a point",
      variant(["strokes", 1, "points"], [1, 2, 3]),
      "strokes[1].points is not a non-empty list of x, y points",
    ],
    [
      "a coordinate out of range",
      variant(["strokes", 1, "points"], [limits.coordinate + 1, 0]),
      "strokes[1].points is not an integer",
    ],
    [
      "a cut in no direction",
      variant(["strokes", 1, "cut"], { end: "out" }),
      'strokes[1].cut.end is not "up", "down", "left", or "right"',
    ],
    [
      "a cut that is not an object",
      variant(["strokes", 1, "cut"], "down"),
      "strokes[1].cut is not an object",
    ],
    [
      "a cut with no ends",
      variant(["strokes", 1, "cut"], {}),
      "strokes[1].cut is empty",
    ],
    [
      "a kind of stroke this version does not know",
      variant(["strokes", 1, "kind"], "spline"),
      'strokes[1].kind is not "polygon" or "fill"',
    ],
    [
      "a cut on a polygon",
      JSON.stringify({
        strokes: [
          {
            tool: "pen",
            size: 1,
            points: [0, 0, 1, 1],
            kind: "polygon",
            cut: { end: "up" },
          },
        ],
      }),
      "strokes[0].cut is on a polygon",
    ],
    [
      "a cut on a fill",
      JSON.stringify({
        strokes: [
          {
            tool: "pen",
            points: [0, 0, 1, 1, 2, 0],
            kind: "fill",
            cut: { end: "up" },
          },
        ],
      }),
      "strokes[0].cut is on a fill",
    ],
    [
      "a size on a fill",
      JSON.stringify({
        strokes: [
          { tool: "pen", size: 1, points: [0, 0, 1, 1, 2, 0], kind: "fill" },
        ],
      }),
      "strokes[0].size is on a fill",
    ],
    [
      "a fill of fewer than three points",
      JSON.stringify({
        strokes: [{ tool: "pen", points: [0, 0, 1, 1], kind: "fill" }],
      }),
      "strokes[0] fills fewer than three points",
    ],
    [
      "a stroke that is null",
      variant(["strokes", 0], null),
      "strokes[0] is not an object",
    ],
    [
      "a base position that is not a number",
      variant(["base", "x"], "0"),
      "base.x is not an integer",
    ],
    [
      "a base with no width",
      variant(["base", "width"], 0),
      "base.width is not an integer",
    ],
    [
      "a base taller than the limit",
      variant(["base", "height"], limits.coordinate + 1),
      "base.height is not an integer",
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
    ["a base that is null", variant(["base"], null), "base is not an object"],
    [
      "a base image that is not a PNG",
      variant(["base", "png"], "R0lGODlh"),
      "base.png is not a valid PNG: not a PNG file",
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
        points: [0, 0],
      })),
    );
    expect(invalid(parseRecord(text))).toBe("more than 10000 strokes");
  });

  it("more points than the limit, across strokes", () => {
    const half = new Array<number>(limits.points).fill(0);
    const stroke = { tool: "pen", size: 1, points: half };
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

describe("parseRecord holds the text to the format's own JSON", () => {
  const stroke = (body: string): string => `{"strokes":[${body}]}`;
  const plain = '{"tool":"pen","size":1,"points":[0,0]}';

  it("refuses a repeated name in any object", () => {
    expect(invalid(parseRecord('{"strokes":[],"strokes":[]}'))).toContain(
      "repeated",
    );
    expect(
      invalid(
        parseRecord(
          stroke('{"tool":"eraser","tool":"pen","size":1,"points":[0,0]}'),
        ),
      ),
    ).toContain('"tool"');
    expect(
      invalid(
        parseRecord(
          stroke('{"tool":"pen","size":1,"points":[0,0],"points":[9,9]}'),
        ),
      ),
    ).toContain('"points"');
    expect(invalid(parseRecord('{"strokes":[],"x":{"a":1,"a":2}}'))).toContain(
      '"a"',
    );
  });

  it("compares names as they decode, however they are spelled", () => {
    expect(invalid(parseRecord('{"strokes":[],"strok\\u0065s":[]}'))).toContain(
      "repeated",
    );
    expect(
      invalid(parseRecord('{"strokes":[],"a\\"":1,"a\\u0022":2}')),
    ).toContain("repeated");
  });

  it("allows the same name in different objects", () => {
    expect(parseRecord(stroke(`${plain},${plain}`)).ok).toBe(true);
    expect(parseRecord('{"strokes":[],"a":{"b":1},"c":{"b":2}}').ok).toBe(true);
  });

  it("does not take a string's contents for structure", () => {
    const text = '{"strokes":[],"note":"[[[[{{{{ 1.5 \\"strokes\\": 1e3 -0"}';
    expect(parseRecord(text).ok).toBe(true);
  });

  it("refuses numbers that are not integers in plain digits, even in unknown fields", () => {
    for (const number of ["1.0", "1e0", "1E0", "1.6e2", "-0", "-0.0", "0.5"]) {
      expect(
        invalid(
          parseRecord(stroke(`{"tool":"pen","size":${number},"points":[0,0]}`)),
        ),
      ).toBe("a number is not an integer in plain digits");
      expect(invalid(parseRecord(`{"strokes":[],"future":${number}}`))).toBe(
        "a number is not an integer in plain digits",
      );
    }
  });

  it("refuses leading zeros", () => {
    expect(invalid(parseRecord('{"strokes":[],"a":01}'))).toBe(
      "a number is not an integer in plain digits",
    );
  });

  it("accepts negative integers and zero", () => {
    expect(
      parseRecord(stroke('{"tool":"pen","size":1,"points":[-16,0]}')).ok,
    ).toBe(true);
  });

  /** A record with an unknown field nested to `depth` in all. */
  const nested = (depth: number): string =>
    `{"strokes":[],"a":${"[".repeat(depth - 1)}${"]".repeat(depth - 1)}}`;

  it("allows the deepest nesting of the limit and refuses one more", () => {
    expect(parseRecord(nested(limits.depth)).ok).toBe(true);
    expect(invalid(parseRecord(nested(limits.depth + 1)))).toBe(
      "nested more than 16 deep",
    );
  });

  it("refuses deep nesting before parsing it", () => {
    expect(invalid(parseRecord(nested(400_000)))).toBe(
      "nested more than 16 deep",
    );
  });
});

describe("parseRecord checks the base image", () => {
  const base64 = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes));
  const chunks = pixelChunks(blank(1, 1));
  const [ihdr, idat, iend] = chunks;
  if (ihdr === undefined || idat === undefined || iend === undefined) {
    throw new Error("no chunks");
  }
  const end = iend;
  const start = ihdr;

  it("refuses a PNG signature alone", () => {
    const text = variant(["base", "png"], base64(pngSignature));
    expect(invalid(parseRecord(text))).toBe(
      "base.png is not a valid PNG: truncated chunk",
    );
  });

  it("refuses an image larger than the limit", () => {
    const huge = writeChunks([header(100_000, 100_000), idat, iend]);
    expect(invalid(parseRecord(variant(["base", "png"], base64(huge))))).toBe(
      "base.png is larger than 4096 pixels a side",
    );
  });

  it("refuses anything but 8-bit RGBA without interlacing", () => {
    const variants: [string, number[]][] = [
      ["grey", [8, 0, 0, 0, 0]],
      ["grey with alpha", [8, 4, 0, 0, 0]],
      ["16-bit", [16, 6, 0, 0, 0]],
      ["interlaced", [8, 6, 0, 0, 1]],
    ];
    for (const [name, fields] of variants) {
      const data = ihdr.data.slice();
      data.set(fields, 8);
      const png = writeChunks([{ type: "IHDR", data }, idat, iend]);
      expect(
        invalid(parseRecord(variant(["base", "png"], base64(png)))),
        name,
      ).toBe("base.png is not 8-bit RGBA without interlacing");
    }
  });

  it("refuses any chunk but the image's own", () => {
    for (const type of ["gAMA", "eXIf", "tEXt", "inKL"]) {
      const png = writeChunks([
        ihdr,
        { type, data: new Uint8Array(4) },
        idat,
        iend,
      ]);
      expect(invalid(parseRecord(variant(["base", "png"], base64(png))))).toBe(
        `base.png holds a ${type} chunk`,
      );
    }
  });

  /** A valid PNG whose image data is padded to make it exactly `size` bytes. */
  function paddedPng(size: number): Uint8Array {
    const used = writeChunks([start, end]).length + 12;
    return writeChunks([
      start,
      { type: "IDAT", data: new Uint8Array(size - used) },
      end,
    ]);
  }

  it("accepts a base image of exactly the size limit and refuses one byte more", () => {
    const encode = (bytes: Uint8Array): string => {
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 0x8000),
        );
      }
      return btoa(binary);
    };
    const exact = paddedPng(limits.baseBytes);
    expect(exact.length).toBe(limits.baseBytes);
    expect(parseRecord(variant(["base", "png"], encode(exact))).ok).toBe(true);
    const over = paddedPng(limits.baseBytes + 1);
    expect(invalid(parseRecord(variant(["base", "png"], encode(over))))).toBe(
      "base.png is too large",
    );
  }, 30_000);
});

describe("parseRecord bounds the text", () => {
  it("refuses text longer than the limit before parsing it", () => {
    expect(invalid(parseRecord(" ".repeat(limits.text + 1)))).toBe(
      "record text is too long",
    );
  });

  /** An empty record with an ignored field holding `filler`. */
  const padded = (filler: string): string =>
    serializeRecord({ strokes: [] }).replace(/}$/, `,"extra":"${filler}"}`);

  it("counts the limit in UTF-8 bytes, not characters", () => {
    // Three bytes each in UTF-8, one code unit each in JavaScript.
    const over = padded("ࠀ".repeat(6 * 1024 * 1024));
    expect(over.length).toBeLessThan(limits.text);
    expect(invalid(parseRecord(over))).toBe("record text is too long");
    expect(parseRecord(padded("ࠀ".repeat(5 * 1024 * 1024))).ok).toBe(true);
  });

  it("counts a surrogate pair as four bytes", () => {
    // Two code units and four bytes each.
    const pairs = Math.floor(limits.text / 4);
    const over = padded("😀".repeat(pairs));
    expect(new TextEncoder().encode(over).length).toBeGreaterThan(limits.text);
    expect(invalid(parseRecord(over))).toBe("record text is too long");
    expect(parseRecord(padded("😀".repeat(pairs - 64))).ok).toBe(true);
  });
});
