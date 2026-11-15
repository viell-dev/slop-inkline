import { describe, expect, it } from "vitest";
import {
  fieldLabel,
  fieldText,
  fittedHeight,
  isBlank,
  isTouched,
  takeFile,
  typedValues,
} from "../../../src/notes/text-fields.ts";

describe("typedValues", () => {
  it("takes a value from each line, without the spaces around it", () => {
    expect(typedValues("  TA\nDA \n")).toEqual(["TA", "DA"]);
  });

  it("drops blank lines, which the format has no way to hold", () => {
    expect(typedValues("\n\nTA\n   \n\nDA\n\n")).toEqual(["TA", "DA"]);
    expect(typedValues("")).toEqual([]);
    expect(typedValues(" \n ")).toEqual([]);
  });

  it("keeps the spaces inside a value", () => {
    expect(typedValues("rice  field")).toEqual(["rice  field"]);
  });

  it("takes pasted text's own breaks as lines", () => {
    expect(
      typedValues(
        `a\r\nb\rc${String.fromCharCode(0x2028)}d${String.fromCharCode(0x2029)}e`,
      ),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("isTouched", () => {
  it("is false for what the field was given", () => {
    expect(isTouched(["TA", "DA"], "TA\nDA")).toBe(false);
    expect(isTouched([], "")).toBe(false);
  });

  it("leaves a value with spaces around it alone until it is changed", () => {
    // Text left as it was would read differently if typed, and must not count.
    expect(isTouched([" TA"], " TA")).toBe(false);
    expect(isTouched([" TA"], " TA\nDA")).toBe(true);
  });

  it("is false for a change that says the same", () => {
    expect(isTouched(["TA"], "TA\n")).toBe(false);
    expect(isTouched(["TA"], " TA ")).toBe(false);
  });

  it("is true for a value added, changed, removed, or moved", () => {
    expect(isTouched(["TA"], "TA\nDA")).toBe(true);
    expect(isTouched(["TA"], "KA")).toBe(true);
    expect(isTouched(["TA"], "")).toBe(true);
    expect(isTouched(["TA", "DA"], "DA\nTA")).toBe(true);
  });
});

describe("takeFile", () => {
  it("follows the file in a field nobody changed", () => {
    expect(takeFile(["TA"], "TA", ["KA"])).toEqual({
      typed: "KA",
      conflict: false,
    });
  });

  it("keeps what was typed when the file's value stayed", () => {
    expect(takeFile(["TA"], "typed", ["TA"])).toEqual({
      typed: "typed",
      conflict: false,
    });
  });

  it("keeps what was typed, in conflict, when the file's value changed too", () => {
    expect(takeFile(["TA"], "typed", ["KA"])).toEqual({
      typed: "typed",
      conflict: true,
    });
    expect(takeFile(["TA"], "typed", [])).toEqual({
      typed: "typed",
      conflict: true,
    });
  });

  it("finds no conflict where the file came to say what was typed", () => {
    expect(takeFile(["TA"], "KA\n", ["KA"]).conflict).toBe(false);
  });
});

describe("fields", () => {
  it("names a field by how many it holds", () => {
    expect(fieldLabel("reading", 1)).toBe("Reading");
    expect(fieldLabel("reading", 2)).toBe("Readings");
    expect(fieldLabel("translation", 1)).toBe("Translation");
    expect(fieldLabel("translation", 0)).toBe("Translations");
  });

  it("shows values one to a line", () => {
    expect(fieldText(["TA", "DA"])).toBe("TA\nDA");
  });

  it("tells a symbol with nothing recorded", () => {
    expect(isBlank({ reading: [], translation: [] })).toBe(true);
    expect(isBlank({ reading: ["TA"], translation: [] })).toBe(false);
    expect(isBlank({ reading: [], translation: ["field"] })).toBe(false);
  });
});

describe("fittedHeight", () => {
  // Obsidian's field: 13 px text at a line height of 1.3, 4 px of padding and
  // 1 px of border above and below, with a height that counts them.
  const field = { padding: 8, border: 2, borderBox: true, line: 16.9 };

  it("fits whole lines, from a scroll height rounded either way", () => {
    // Five lines are 84.5 px of text, which with the padding the browser
    // rounds to 92 or 93.
    for (const scroll of [92, 93]) {
      expect(fittedHeight({ ...field, scroll })).toBeCloseTo(94.5, 6);
    }
    expect(fittedHeight({ ...field, scroll: 42 })).toBeCloseTo(43.8, 6);
  });

  it("fits a line taller than the others, rather than cut it", () => {
    // Five lines and 2 px more, as text in a taller fallback font can be.
    expect(fittedHeight({ ...field, scroll: 95 })).toBeCloseTo(111.4, 6);
  });

  it("gives an empty field a line", () => {
    expect(fittedHeight({ ...field, scroll: 8 })).toBeCloseTo(26.9, 6);
  });

  it("leaves out the padding and border where the height does", () => {
    expect(
      fittedHeight({ ...field, borderBox: false, scroll: 92 }),
    ).toBeCloseTo(84.5, 6);
  });

  it("takes the scroll height as it is without a line height", () => {
    expect(fittedHeight({ ...field, line: Number.NaN, scroll: 92 })).toBe(94);
  });
});
