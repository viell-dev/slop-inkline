import { describe, expect, it } from "vitest";
import { guideNames } from "../../src/editor/guides.ts";
import {
  defaultSettings,
  guideSettings,
  readSettings,
  shownGuides,
  triggerProblem,
  withSetting,
} from "../../src/settings.ts";

/** The number of brush sizes, as the editor has them. */
const sizes = 4;

describe("triggerProblem", () => {
  it("accepts a trigger of one to eight characters, one not a letter or digit", () => {
    for (const trigger of [";;", "::", "/", "a;", "@sym", "👉", "§§§§§§§§"]) {
      expect(triggerProblem(trigger)).toBeUndefined();
    }
  });

  it("refuses an empty trigger, a long one, and one with a space or link syntax", () => {
    expect(triggerProblem("")).toMatch(/at least one/);
    expect(triggerProblem(";".repeat(9))).toMatch(/at most 8/);
    expect(triggerProblem("; ;")).toMatch(/space/);
    expect(triggerProblem(";\t")).toMatch(/space/);
    for (const trigger of ["[[", ";]", "|"]) {
      expect(triggerProblem(trigger)).toMatch(/\[, \], or \|/);
    }
  });

  it("refuses letters and digits alone, in any script, which words would start", () => {
    for (const trigger of [
      "ab",
      "12",
      "塔",
      "é",
      `e${String.fromCharCode(0x301)}`,
    ]) {
      expect(triggerProblem(trigger)).toMatch(/not a letter or a digit/);
    }
  });
});

describe("withSetting", () => {
  it("sets a value its setting can hold", () => {
    expect(withSetting(defaultSettings, "trigger", "::", sizes)).toEqual({
      ...defaultSettings,
      trigger: "::",
    });
    expect(withSetting(defaultSettings, "brushSize", 3, sizes)?.brushSize).toBe(
      3,
    );
    // The dropdown gives its choice as text.
    expect(
      withSetting(defaultSettings, "brushSize", "0", sizes)?.brushSize,
    ).toBe(0);
    expect(
      withSetting(defaultSettings, "symbolFolder", " /Notes/Signs/ ", sizes)
        ?.symbolFolder,
    ).toBe("Notes/Signs");
    expect(
      withSetting(defaultSettings, "symbolFolder", "", sizes)?.symbolFolder,
    ).toBe("");
    expect(withSetting(defaultSettings, "guides", false, sizes)?.guides).toBe(
      false,
    );
    expect(
      withSetting(defaultSettings, "textColor", false, sizes)?.textColor,
    ).toBe(false);
    for (const symbolScale of [50, 75, 100, 150, 200]) {
      expect(
        withSetting(defaultSettings, "symbolScale", symbolScale, sizes)
          ?.symbolScale,
      ).toBe(symbolScale);
    }
  });

  it("refuses a value its setting cannot hold", () => {
    for (const [key, value] of [
      ["trigger", "ab"],
      ["trigger", 3],
      ["brushSize", 4],
      ["brushSize", -1],
      ["brushSize", 1.5],
      ["brushSize", "big"],
      ["brushSize", ""],
      ["brushSize", "  "],
      ["symbolFolder", "../Signs"],
      ["symbolFolder", ".hidden"],
      ["symbolFolder", 3],
      ["guides", 1],
      ["capHeightGuide", "no"],
      ["textColor", "false"],
      ["symbolScale", 0],
      ["symbolScale", 45],
      ["symbolScale", 205],
      ["symbolScale", 113],
      ["symbolScale", 150.5],
      ["symbolScale", "150"],
      ["symbolScale", Number.NaN],
      ["symbolScale", Number.POSITIVE_INFINITY],
    ] as const) {
      expect(withSetting(defaultSettings, key, value, sizes)).toBeUndefined();
    }
  });
});

describe("readSettings", () => {
  it("starts with the defaults", () => {
    for (const data of [undefined, null, "settings", 3, []]) {
      expect(readSettings(data, sizes)).toEqual(defaultSettings);
    }
  });

  it("reads what was stored", () => {
    const stored = {
      trigger: "::",
      symbolFolder: "Notes/Signs",
      brushSize: 2,
      guides: false,
      ascenderGuide: true,
      capHeightGuide: false,
      xHeightGuide: true,
      baselineGuide: true,
      descenderGuide: false,
      symbolScale: 150,
      textColor: false,
    };
    expect(readSettings(stored, sizes)).toEqual(stored);
    // Earlier versions stored a Pen pressure setting, which is gone.
    expect(readSettings({ ...stored, pressure: false }, sizes)).toEqual(stored);
  });

  it("keeps the default for each value it cannot read, and ignores others", () => {
    expect(
      readSettings(
        {
          trigger: "a b",
          brushSize: 9,
          pressure: false,
          size: 2,
          guides: "no",
        },
        sizes,
      ),
    ).toEqual(defaultSettings);
  });
});

describe("shownGuides", () => {
  it("shows every font line by default, and only those turned on", () => {
    expect([...shownGuides(defaultSettings)]).toEqual([...guideNames]);
    expect([
      ...shownGuides({
        ...defaultSettings,
        ascenderGuide: false,
        descenderGuide: false,
      }),
    ]).toEqual(["cap height", "x-height", "baseline"]);
  });

  it("maps each font line to a setting of its own", () => {
    expect(new Set(Object.values(guideSettings)).size).toBe(guideNames.length);
  });
});
