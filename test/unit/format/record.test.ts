import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  baseImageProblem,
  limits,
  parseRecord,
  parseRecordSliced,
  readBasePng,
  recordProblem,
  serializeRecord,
  serializedBytes,
  toBase64,
  toBase64Sliced,
  type InkRecord,
  type ParseResult,
} from "../../../src/format/record.ts";
import { blank, encodePng, header, pixelChunks } from "../../support/png.ts";
import {
  pngSignature,
  readChunks,
  writeChunks,
} from "../../../src/format/png.ts";
import { noise, paused, sameBytes } from "../../support/slices.ts";

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
          points: [64, 64, 64, 0],
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
      'strokes[1].cut.end is not "up" or "down"',
    ],
    [
      "a cut along a column at a stroke's start",
      variant(["strokes", 1, "cut"], { start: "left" }),
      'strokes[1].cut.start is not "up" or "down"',
    ],
    [
      "a cut along a column at a stroke's end",
      variant(["strokes", 1, "cut"], { end: "right" }),
      'strokes[1].cut.end is not "up" or "down"',
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
      "base64 with a padding bit set before two equals signs",
      variant(["base", "png"], "QR=="),
      "base.png has padding bits set",
    ],
    [
      "base64 with a padding bit set before one equals sign",
      variant(["base", "png"], "QUF="),
      "base.png has padding bits set",
    ],
    [
      "base64 without its padding bits set, which is not a PNG either",
      variant(["base", "png"], "QQ=="),
      "base.png is not a valid PNG: not a PNG file",
    ],
    [
      "the same before one equals sign",
      variant(["base", "png"], "QUE="),
      "base.png is not a valid PNG: not a PNG file",
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
    ).toBe("more than 250000 points");
  });

  it("a base image with bytes after its end", () => {
    const png = encodePng(blank(1, 1));
    const longer = new Uint8Array(png.length + 3);
    longer.set(png);
    expect(
      invalid(
        parseRecord(
          variant(["base", "png"], btoa(String.fromCharCode(...longer))),
        ),
      ),
    ).toBe("base.png holds bytes after its end");
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

  it("refuses half of a surrogate pair, in a name or a value", () => {
    for (const text of [
      '{"strokes":[],"extra":"\\ud83d"}',
      '{"strokes":[],"extra":"a\\ude00b"}',
      '{"strokes":[],"\\ud83d":1}',
    ]) {
      expect(invalid(parseRecord(text))).toBe("a string is not valid Unicode");
    }
    expect(parseRecord('{"strokes":[],"extra":"\\ud83d\\ude00"}').ok).toBe(
      true,
    );
    expect(parseRecord('{"strokes":[],"extra":"😀"}').ok).toBe(true);
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

  it("refuses a number no reader can hold exactly, even in unknown fields", () => {
    const largest = "9007199254740991";
    for (const number of [largest, `-${largest}`]) {
      expect(parseRecord(`{"strokes":[],"note":${number}}`).ok).toBe(true);
    }
    for (const number of [
      "9007199254740992",
      "-9007199254740992",
      "123456789012345678901234567890",
    ]) {
      expect(invalid(parseRecord(`{"strokes":[],"note":${number}}`))).toBe(
        "a number is too large",
      );
    }
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

describe("toBase64", () => {
  const plain = (bytes: Uint8Array): string =>
    Buffer.from(bytes).toString("base64");

  it("spells bytes as base64 does, at every length around a group", () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = noise(length);
      expect(toBase64(bytes)).toBe(plain(bytes));
    }
  });

  it("gets every value of a byte in every place of a group right", () => {
    for (let value = 0; value < 256; value++) {
      for (const bytes of [
        Uint8Array.of(value),
        Uint8Array.of(0, value),
        Uint8Array.of(value, 0),
        Uint8Array.of(0, 0, value),
        Uint8Array.of(value, 255, value),
      ]) {
        expect(toBase64(bytes)).toBe(plain(bytes));
      }
    }
  });

  it("reads a view into a larger buffer from where it starts", () => {
    const bytes = noise(100);
    expect(toBase64(bytes.subarray(7, 50))).toBe(plain(bytes.subarray(7, 50)));
  });

  it("gives the same text in slices, on and around a slice's end", async () => {
    const slice = 3 * 16 * 1024;
    for (const length of [0, 1, 2, 3, slice - 1, slice, slice + 1, 2 * slice]) {
      const bytes = noise(length);
      const { result } = await paused((pause) =>
        toBase64Sliced(bytes, { pause }),
      );
      expect(result).toBe(plain(bytes));
    }
  });
});

/**
 * How reading took a base layer's base64 before it went through a table, the
 * rule that table must keep: what it refused and why, and the bytes otherwise.
 */
function ruledBase64(text: string): string | Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    return "base.png is not base64";
  }
  if (/(?:[^AQgw]==|[^AEIMQUYcgkosw048=]=)$/.test(text.slice(-3))) {
    return "base.png has padding bits set";
  }
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/** What reading makes of `text` as a base layer's `png`, up to its PNG check. */
function readBase64(text: string): string {
  const result = parseRecord(
    JSON.stringify({
      strokes: [],
      base: { x: 0, y: 0, width: 16, height: 16, png: text },
    }),
  );
  return result.ok ? "a PNG" : result.detail;
}

describe("a base layer's base64", () => {
  const png = encodePng({ width: 40, height: 30, data: noise(40 * 30 * 4) });

  it("reads back every byte of a PNG, whatever its length", () => {
    for (let trailing = 0; trailing < 3; trailing++) {
      const text = toBase64(png);
      expect(readBasePng(text)).toEqual(png);
      expect(readBasePng(text.slice(0, -4 - trailing))).toBeUndefined();
    }
  });

  it("decodes as the plain rule does at every length", () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = noise(length);
      const text = toBase64(bytes);
      expect(ruledBase64(text)).toEqual(bytes);
      // Not a PNG, which says that the base64 was read, and read to these bytes.
      expect(readBase64(text)).toMatch(/not a valid PNG|too large/);
    }
  });

  it("refuses what the plain rule refuses, for the same reason", () => {
    // Every string of four of these, which take in each kind of character, in
    // each place, and whatever padding can do.
    const letters = [
      "A",
      "B",
      "Q",
      "w",
      "/",
      "+",
      "9",
      "=",
      "-",
      " ",
      "é",
      "\n",
    ];
    for (const a of letters) {
      for (const b of letters) {
        for (const c of letters) {
          for (const d of letters) {
            const text = `${a}${b}${c}${d}`;
            const expected = ruledBase64(text);
            const found = readBase64(text);
            if (typeof expected === "string") expect(found).toBe(expected);
            else expect(found).toContain("not a valid PNG");
          }
        }
      }
    }
  });

  it("refuses a bad character in any group, in the middle of a long text", () => {
    const text = toBase64(noise(3 * 70_000));
    for (const at of [0, 1, 2, 3, 65_536, 131_071, text.length - 5]) {
      for (const bad of ["=", "-", "\u00e9", "\u4e00", "\n"]) {
        const broken = `${text.slice(0, at)}${bad}${text.slice(at + 1)}`;
        expect(readBase64(broken)).toBe("base.png is not base64");
      }
    }
  });

  it("refuses text that is not a whole number of groups", () => {
    expect(readBase64("AAAAA")).toBe("base.png is not base64");
    expect(readBase64("A")).toBe("base.png is not base64");
    expect(readBase64("=")).toBe("base.png is not base64");
    expect(readBase64("====")).toBe("base.png is not base64");
  });

  it("reads a view of no more than the PNG's own bytes", () => {
    const read = readBasePng(toBase64(png));
    expect(read?.byteOffset).toBe(0);
    expect(read?.buffer.byteLength).toBe(png.length);
  });
});

/** Every way a record's text can be refused, and some it cannot. */
const texts: readonly (readonly [string, string])[] = [
  ["a record", serializeRecord(record)],
  ["a base layer", serializeRecord(withBase)],
  ["no JSON", "{"],
  ["no object", "[]"],
  ["no strokes", "{}"],
  ["strokes that are no list", '{"strokes":1}'],
  ["a repeated name", '{"strokes":[],"strokes":[]}'],
  ["a repeated name by an escape", '{"strokes":[],"\\u0073trokes":[]}'],
  ["a number with a fraction", '{"strokes":[],"a":1.5}'],
  ["half of a surrogate pair", '{"strokes":[],"a":"\\ud800"}'],
  ["nesting too deep", `{"strokes":[],"a":${"[".repeat(20)}${"]".repeat(20)}}`],
  ["a stroke that is no object", '{"strokes":[1]}'],
  ["an unknown tool", variant(["strokes", 0, "tool"], "brush")],
  ["an odd list of points", variant(["strokes", 0, "points"], [1])],
  ["a base that is no object", variant(["base"], 1)],
  ["a place past the limit", variant(["base", "x"], limits.coordinate + 1)],
  ["a PNG that is no string", variant(["base", "png"], 1)],
  ["a PNG that is no PNG", variant(["base", "png"], "AAAA")],
  ["a PNG with a bad letter", variant(["base", "png"], "AA-A")],
  ["padding bits", variant(["base", "png"], "AB==")],
];

describe("parseRecordSliced", () => {
  it.each(texts)("finds what parseRecord finds: %s", async (_, text) => {
    expect(await parseRecordSliced(text)).toEqual(parseRecord(text));
    const { result } = await paused((pause) =>
      parseRecordSliced(text, { pause }),
    );
    expect(result).toEqual(parseRecord(text));
  });

  it("names a bad CRC ahead of bytes after the end, as it always did", async () => {
    const png = encodePng(blank(3, 3));
    const damaged = new Uint8Array(png.length + 1);
    damaged.set(png);
    const [, chunk] = readChunks(png);
    if (chunk === undefined) throw new Error("no IDAT");
    const at = chunk.data.byteOffset;
    damaged[at] = (damaged[at] ?? 0) ^ 1;
    const text = variant(["base", "png"], toBase64(damaged));
    const found = parseRecord(text);
    expect(found).toEqual({
      ok: false,
      detail: "base.png has a bad CRC in IDAT",
    });
    expect(await parseRecordSliced(text)).toEqual(found);
  });

  it("pauses all through a large base layer, to the same record", async () => {
    const large = encodePng({
      width: 400,
      height: 400,
      data: noise(400 * 400 * 4),
    });
    const text = serializeRecord({
      ...record,
      base: { x: 0, y: 0, width: 16, height: 16, png: large },
    });
    const { result, pauses } = await paused((pause) =>
      parseRecordSliced(text, { pause }),
    );
    if (!result.ok) throw new Error(result.detail);
    const png = result.record.base?.png;
    if (png === undefined) throw new Error("no base layer");
    expect(sameBytes(png, large)).toBe(true);
    expect(result.record.strokes).toEqual(record.strokes);
    // Its text's length, its check, its base64, and its CRCs.
    expect(pauses).toBeGreaterThanOrEqual(large.length / (48 * 1024) + 40);
  });

  it("pauses all through many strokes and a long text", async () => {
    const many = {
      strokes: Array.from({ length: 3000 }, () => ({
        tool: "pen",
        size: 16,
        points: [1, 2, 3, 4],
      })),
      other: " ".repeat(300_000),
    };
    const text = JSON.stringify(many);
    const { result, pauses } = await paused((pause) =>
      parseRecordSliced(text, { pause }),
    );
    expect(result).toEqual(parseRecord(text));
    expect(result.ok).toBe(true);
    // A pause for each stroke, and more for the text.
    expect(pauses).toBeGreaterThanOrEqual(3000 + 2 * 5);
  });

  it("finds what lies past the first slice of the text", async () => {
    const padding = " ".repeat(200_000);
    const repeated = `{"strokes":[],${padding}"a":1,"a":2}`;
    const refused = await paused((pause) =>
      parseRecordSliced(repeated, { pause }),
    );
    expect(refused.result).toEqual({
      ok: false,
      detail: 'the name "a" is repeated',
    });
    const nested = `{"strokes":[],${padding}"a":${"[".repeat(20)}${"]".repeat(20)}}`;
    expect(parseRecord(nested)).toEqual({
      ok: false,
      detail: `nested more than ${String(limits.depth)} deep`,
    });
  });
});

describe("serializedBytes", () => {
  const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
  const stroke = { tool: "pen", size: 16, points: [16, 32] } as const;

  it("is the text of a record without a base layer", async () => {
    expect(text(await serializedBytes(record))).toBe(serializeRecord(record));
    const none: InkRecord = { strokes: [] };
    expect(text(await serializedBytes(none))).toBe(serializeRecord(none));
  });

  it("is the text of a record with one, at every length around a group", async () => {
    for (let length = 0; length <= 7; length++) {
      const base = { x: -5, y: 3, width: 16, height: 32, png: noise(length) };
      const each: InkRecord = { strokes: [stroke], base };
      expect(text(await serializedBytes(each))).toBe(serializeRecord(each));
    }
  });

  it("is the same in slices, across several of them", async () => {
    const base = { x: 0, y: 0, width: 16, height: 16, png: noise(200_000) };
    const large: InkRecord = { strokes: [stroke, stroke], base };
    const { result, pauses } = await paused((pause) =>
      serializedBytes(large, { pause }),
    );
    expect(text(result)).toBe(serializeRecord(large));
    expect(pauses).toBeGreaterThanOrEqual(4);
  });
});

describe("recordProblem", () => {
  const png = encodePng(blank(3, 2));
  const place = { x: 0, y: 0, width: 48, height: 32 };
  const strokes = [{ tool: "pen", size: 16, points: [16, 32] }] as const;
  /** The PNG with a chunk's data changed, its CRC left as it was. */
  const damagedData = (type: string): Uint8Array => {
    const bytes = png.slice();
    const found = readChunks(bytes).find((chunk) => chunk.type === type);
    if (found === undefined) throw new Error(`no ${type}`);
    const at = found.data.byteOffset - bytes.byteOffset;
    bytes[at] = (bytes[at] ?? 0) ^ 0xff;
    return bytes;
  };
  const [ihdr, idat, iend] = pixelChunks(blank(3, 2));
  if (ihdr === undefined || idat === undefined || iend === undefined) {
    throw new Error("no chunks");
  }

  /** What a whole record's text being read back finds, as it did before. */
  const readingBack = async (each: InkRecord): Promise<string | undefined> => {
    const parsed = parseRecord(serializeRecord(each));
    if (!parsed.ok) return parsed.detail;
    return each.base === undefined
      ? undefined
      : baseImageProblem(each.base.png);
  };

  const cases: readonly (readonly [string, InkRecord])[] = [
    ["no strokes", { strokes: [] }],
    ["a stroke", { strokes }],
    ["a base layer", { strokes, base: { ...place, png } }],
    ["a stroke too thin", { strokes: [{ ...strokes[0], size: 0 }] }],
    [
      "a stroke and base layer both wrong",
      {
        strokes: [{ ...strokes[0], size: 0 }],
        base: { ...place, png: pngSignature },
      },
    ],
    [
      "a base layer out of reach",
      { strokes, base: { ...place, x: limits.coordinate + 1, png } },
    ],
    [
      "a base layer with no width",
      { strokes, base: { ...place, width: 0, png } },
    ],
    [
      "a base layer's PNG too large",
      {
        strokes,
        base: { ...place, png: new Uint8Array(limits.baseBytes + 1) },
      },
    ],
    ["bytes that are no PNG", { strokes, base: { ...place, png: noise(40) } }],
    ["no bytes", { strokes, base: { ...place, png: new Uint8Array(0) } }],
    ["a PNG cut short", { strokes, base: { ...place, png: png.slice(0, 40) } }],
    [
      "a damaged header",
      { strokes, base: { ...place, png: damagedData("IHDR") } },
    ],
    [
      "damaged image data",
      { strokes, base: { ...place, png: damagedData("IDAT") } },
    ],
    [
      "a chunk a base layer cannot hold",
      {
        strokes,
        base: {
          ...place,
          png: writeChunks([
            ihdr,
            { type: "tEXt", data: Uint8Array.of(97, 0, 98) },
            idat,
            iend,
          ]),
        },
      },
    ],
    [
      "an image larger than a base layer can be",
      {
        strokes,
        base: {
          ...place,
          png: writeChunks([header(5000, 2), idat, iend]),
        },
      },
    ],
    [
      "an image that is not RGBA",
      {
        strokes,
        base: {
          ...place,
          png: writeChunks([
            {
              type: "IHDR",
              data: Uint8Array.of(0, 0, 0, 3, 0, 0, 0, 2, 8, 0, 0, 0, 0),
            },
            idat,
            iend,
          ]),
        },
      },
    ],
    [
      "image data that stops short",
      {
        strokes,
        base: {
          ...place,
          png: writeChunks([header(30, 20), idat, iend]),
        },
      },
    ],
  ];

  it.each(cases)("finds what reading back finds: %s", async (_, each) => {
    expect(await recordProblem(each)).toBe(await readingBack(each));
  });

  it("finds it in slices too", async () => {
    for (const [, each] of cases) {
      const { result } = await paused((pause) =>
        recordProblem(each, { pause }),
      );
      expect(result).toBe(await readingBack(each));
    }
  });

  it("refuses what comes after the end of a PNG", async () => {
    const trailing = new Uint8Array(png.length + 1);
    trailing.set(png);
    const each = { strokes, base: { ...place, png: trailing } };
    expect(await recordProblem(each)).toBe(await readingBack(each));
    expect(await recordProblem(each)).toBe(
      "base.png holds bytes after its end",
    );
  });

  it("passes a large PNG, pausing all through it", async () => {
    const data = noise(400 * 400 * 4);
    const large = encodePng({ width: 400, height: 400, data });
    const each = { strokes, base: { ...place, png: large } };
    const { result, pauses } = await paused((pause) =>
      recordProblem(each, { pause }),
    );
    expect(result).toBeUndefined();
    expect(pauses).toBeGreaterThanOrEqual(large.length / 1024);
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
  /** A record of exactly `bytes` of UTF-8, `filler` making up its last value. */
  function recordOf(
    bytes: number,
    filler: string,
    fillerBytes: number,
  ): string {
    const start = '{"strokes":[],"a":"';
    const end = '"}';
    const count = (bytes - start.length - end.length) / fillerBytes;
    if (!Number.isInteger(count)) throw new Error("that does not divide");
    return `${start}${filler.repeat(count)}${end}`;
  }

  it("counts a character of each width, across the places it can pause", () => {
    // Each has a character across the end of a slice of 65,536 code units, or
    // would if the count went wrong, as the opening of these records is 19 long.
    for (const [filler, width] of [
      ["a", 1],
      ["\u00e9", 2],
      ["\u4e00", 3],
      ["\u{1f600}", 4],
    ] as const) {
      const size = limits.text - ((limits.text - 21) % width);
      const atLimit = recordOf(size, filler, width);
      expect(new TextEncoder().encode(atLimit).length).toBe(size);
      expect(parseRecord(atLimit).ok).toBe(true);
      const past = `${recordOf(size, filler, width).slice(0, -2)}${"a".repeat(limits.text - size + 1)}"}`;
      expect(parseRecord(past)).toEqual({
        ok: false,
        detail: "record text is too long",
      });
    }
  });

  it("counts half of a surrogate pair as what encoding would write", () => {
    // Which the check of its text then refuses, once the length passes it.
    const lone = "\ud83d";
    const start = '{"strokes":[],"a":"';
    const filler = "a".repeat(limits.text - start.length - 2 - 3);
    const text = `${start}${filler}${lone}"}`;
    expect(new TextEncoder().encode(text).length).toBe(limits.text);
    expect(parseRecord(text)).toEqual({
      ok: false,
      detail: "a string is not valid Unicode",
    });
    expect(parseRecord(`${start}a${filler}${lone}"}`)).toEqual({
      ok: false,
      detail: "record text is too long",
    });
  });

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
