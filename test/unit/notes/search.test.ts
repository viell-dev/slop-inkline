import { describe, expect, it } from "vitest";
import {
  defaultTrigger,
  holdsTyped,
  insideCodeBlock,
  insideCodeSpan,
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

describe("insideCodeSpan", () => {
  it("knows a column between backticks", () => {
    const line = "a `;;x` b";
    expect(insideCodeSpan(line, 3)).toBe(true);
    expect(insideCodeSpan(line, 6)).toBe(true);
    expect(insideCodeSpan(line, 1)).toBe(false);
    expect(insideCodeSpan(line, 8)).toBe(false);
  });

  it("matches runs of the same length, and leaves an unclosed run text", () => {
    expect(insideCodeSpan("``a`;;``", 5)).toBe(true);
    expect(insideCodeSpan("a ` ;;", 5)).toBe(false);
    // An escaped backtick opens nothing.
    expect(insideCodeSpan("\\`;;`", 3)).toBe(false);
  });
});

describe("holdsTyped", () => {
  it("takes a name holding the words typed, in any case", () => {
    expect(holdsTyped("tower one", "tower o")).toBe(true);
    expect(holdsTyped("The Tower One", "tower o")).toBe(true);
    expect(holdsTyped("tower", "to wer")).toBe(false);
    expect(holdsTyped("tower", "to ")).toBe(false);
  });
});

describe("insideCodeBlock", () => {
  const note = (text: string) => text.split("\n");

  it("knows the lines of a fenced code block, of either mark", () => {
    const lines = note("a\n```js\n;;x\n```\n;;y\n~~~~\n;;z\n~~~~");
    expect(insideCodeBlock(lines, 0)).toBe(false);
    expect(insideCodeBlock(lines, 2)).toBe(true);
    expect(insideCodeBlock(lines, 4)).toBe(false);
    expect(insideCodeBlock(lines, 6)).toBe(true);
  });

  it("closes a fence only with a run of its mark as long, and alone", () => {
    const lines = note("````\n```\n;;a\n~~~~\n```` x\n;;b\n`````\n;;c");
    expect(insideCodeBlock(lines, 2)).toBe(true);
    expect(insideCodeBlock(lines, 5)).toBe(true);
    expect(insideCodeBlock(lines, 7)).toBe(false);
  });

  it("runs an open fence to the end, in quotes and indented too", () => {
    expect(insideCodeBlock(note("> ```\n> ;;a"), 1)).toBe(true);
    expect(insideCodeBlock(note("  ```\n;;a"), 1)).toBe(true);
    // Backticks in the info string make it text.
    expect(insideCodeBlock(note("``` a`b\n;;a"), 1)).toBe(false);
  });

  it("knows the front matter, only when it opens the note and closes", () => {
    const lines = note("---\ntags: ;;a\n---\n;;b");
    expect(insideCodeBlock(lines, 1)).toBe(true);
    expect(insideCodeBlock(lines, 3)).toBe(false);
    expect(insideCodeBlock(note("---\n;;a"), 1)).toBe(false);
    expect(insideCodeBlock(note("a\n---\n;;b\n---"), 2)).toBe(false);
    // A fence after the front matter still counts.
    expect(insideCodeBlock(note("---\n---\n```\n;;a"), 3)).toBe(true);
  });
});
