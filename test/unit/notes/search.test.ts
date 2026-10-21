import { describe, expect, it } from "vitest";
import {
  defaultTrigger,
  rankSymbols,
  triggerQuery,
} from "../../../src/notes/search.ts";

describe("triggerQuery", () => {
  it("finds the name typed after the trigger", () => {
    const line = "The door reads ;;tow";
    expect(triggerQuery(line, line.length, defaultTrigger)).toEqual({
      start: 15,
      query: "tow",
    });
    expect(triggerQuery(";;", 2, defaultTrigger)).toEqual({
      start: 0,
      query: "",
    });
  });

  it("takes the last trigger before the cursor, and only text before it", () => {
    const line = ";;one ;;two and more";
    expect(triggerQuery(line, 11, defaultTrigger)).toEqual({
      start: 6,
      query: "two",
    });
  });

  it("allows spaces in a name, and names in any script", () => {
    const line = "a ;;tower of";
    expect(triggerQuery(line, line.length, defaultTrigger)?.query).toBe(
      "tower of",
    );
    const glyph = "x ;;ᚠᚢ塔";
    expect(triggerQuery(glyph, glyph.length, defaultTrigger)?.query).toBe(
      "ᚠᚢ塔",
    );
  });

  it("finds nothing without a trigger, after a space, or in link syntax", () => {
    expect(triggerQuery("plain text", 10, defaultTrigger)).toBeUndefined();
    expect(triggerQuery(";; tower", 8, defaultTrigger)).toBeUndefined();
    expect(triggerQuery(";;a]]", 5, defaultTrigger)).toBeUndefined();
    expect(triggerQuery(";;a|b", 5, defaultTrigger)).toBeUndefined();
    expect(
      triggerQuery(`;;${"a".repeat(65)}`, 67, defaultTrigger),
    ).toBeUndefined();
    expect(triggerQuery(";;a", 3, "")).toBeUndefined();
  });

  it("takes a trigger of any length", () => {
    expect(triggerQuery("x//ab", 5, "//")).toEqual({ start: 1, query: "ab" });
    expect(triggerQuery("x@ab", 4, "@")).toEqual({ start: 1, query: "ab" });
  });
});

describe("rankSymbols", () => {
  const symbol = (
    name: string,
    score: number,
    uses: number,
    modified: number,
    path = `${name}.ink.png`,
  ) => ({ name, path, score, uses, modified });

  it("ranks by match, then by use in the note, then by recency", () => {
    const ranked = rankSymbols([
      symbol("old", -2, 0, 1),
      symbol("used", -2, 3, 1),
      symbol("new", -2, 0, 9),
      symbol("best", -1, 0, 0),
    ]);
    expect(ranked.map((entry) => entry.name)).toEqual([
      "best",
      "used",
      "new",
      "old",
    ]);
  });

  it("breaks ties by name and then path, whatever the order given", () => {
    const a = symbol("tower", 0, 0, 0, "A/tower.ink.png");
    const b = symbol("tower", 0, 0, 0, "B/tower.ink.png");
    const c = symbol("arch", 0, 0, 0);
    expect(rankSymbols([b, c, a])).toEqual([c, a, b]);
    expect(rankSymbols([a, b, c])).toEqual([c, a, b]);
  });
});
