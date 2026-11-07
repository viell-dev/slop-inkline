import { describe, expect, it } from "vitest";
import {
  findText,
  holdsTyped,
  insideCodeBlock,
  insideCodeSpan,
  rankSymbols,
  searchableText,
  textQuery,
  triggerQuery,
  type TextQuery,
} from "../../../src/notes/search.ts";
import { defaultSettings } from "../../../src/settings.ts";

const defaultTrigger = defaultSettings.trigger;

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
    byName = true,
  ) => ({ name, path, score, byName, uses, modified });

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

  it("puts a name before a value that matches as well, whatever its uses", () => {
    const ranked = rankSymbols([
      symbol("value", -1, 9, 9, "value.ink.png", false),
      symbol("name", -1, 0, 0),
    ]);
    expect(ranked.map((entry) => entry.name)).toEqual(["name", "value"]);
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
  /** A note's lines, as `insideCodeBlock` reads them. */
  const note = (text: string) => {
    const lines = text.split("\n");
    return (index: number) => lines[index];
  };

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

  it("counts a fence's own lines, the info string included, as code", () => {
    const lines = note("a\n```![[001.ink.png]]\ntext\n\nmore\n```\nb");
    expect(insideCodeBlock(lines, 1)).toBe(true);
    expect(insideCodeBlock(lines, 5)).toBe(true);
    expect(insideCodeBlock(lines, 6)).toBe(false);
    expect(insideCodeBlock(note("> ~~~ ;;a"), 0)).toBe(true);
    // A run that cannot open a fence is text, on its own line too.
    expect(insideCodeBlock(note("``` a`b"), 0)).toBe(false);
    expect(insideCodeBlock(note("`` ;;a"), 0)).toBe(false);
  });

  it("reads lines that end in a carriage return", () => {
    const lines = note("a\r\n```\r\n;;x\r\n```\r\n;;y");
    expect(insideCodeBlock(lines, 2)).toBe(true);
    expect(insideCodeBlock(lines, 4)).toBe(false);
    expect(insideCodeBlock(note("---\r\nt: ;;a\r\n---\r\n;;b"), 3)).toBe(false);
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

describe("finding a value", () => {
  const text = (
    reading: readonly string[],
    translation: readonly string[] = [],
  ) => searchableText({ reading, translation });

  /** The query for `typed`, which every test types something for. */
  const query = (typed: string): TextQuery => {
    const found = textQuery(typed);
    if (found === undefined) throw new Error("nothing typed");
    return found;
  };

  const found = (
    held: ReturnType<typeof text>,
    typed: string,
  ): string | undefined => findText(held, query(typed))?.value;

  it("has nothing to look for when nothing was typed", () => {
    expect(textQuery("")).toBeUndefined();
    expect(textQuery("   ")).toBeUndefined();
  });

  it("finds a value in any letter case, and gives it as it was written", () => {
    expect(found(text(["TA"]), "ta")).toBe("TA");
    expect(found(text(["ta"]), "TA")).toBe("ta");
    expect(found(text(["Ta"]), "tA")).toBe("Ta");
  });

  it("finds part of a value, in either field, and says which", () => {
    const held = text(["TA"], ["rice field"]);
    expect(findText(held, query("fie"))).toMatchObject({
      field: "translation",
      value: "rice field",
    });
    expect(findText(held, query("ta"))).toMatchObject({
      field: "reading",
      value: "TA",
    });
    expect(found(held, "zz")).toBeUndefined();
  });

  it("prefers a value that is what was typed, then one that starts with it", () => {
    expect(found(text(["data", "tall", "ta"]), "ta")).toBe("ta");
    expect(found(text(["data", "tall"]), "ta")).toBe("tall");
    expect(found(text(["adata", "data"]), "ta")).toBe("adata");
    // In either field, a reading first where they match alike.
    expect(found(text(["data"], ["ta"]), "ta")).toBe("ta");
    expect(found(text(["ta"], ["ta"]), "ta")).toBe("ta");
  });

  it("never matches across two values", () => {
    expect(found(text(["ab", "cd"]), "bc")).toBeUndefined();
    expect(found(text(["ab", "cd"]), "b\nc")).toBeUndefined();
  });

  it("needs no marks to find a value that has them", () => {
    expect(found(text(["šá"]), "sa")).toBe("šá");
    expect(found(text(["ā"]), "a")).toBe("ā");
    // Both ways of writing `á`.
    expect(found(text(["a\u0301"]), "\u00e1")).toBe("a\u0301");
    expect(found(text(["\u00e1"]), "a\u0301")).toBe("\u00e1");
  });

  it("asks for the marks that were typed", () => {
    expect(found(text(["sa"]), "šá")).toBeUndefined();
    expect(found(text(["कि"]), "का")).toBeUndefined();
    expect(found(text(["कि"]), "कि")).toBe("कि");
  });

  it("finds compatibility forms by the plain one", () => {
    expect(found(text(["ﾀ"]), "タ")).toBe("ﾀ");
    expect(found(text(["ＴＡ"]), "ta")).toBe("ＴＡ");
  });

  it("finds right-to-left text, with its controls left in the value", () => {
    const value = `${String.fromCharCode(0x202e)}שלום`;
    expect(found(text([value]), "שלום")).toBe(value);
  });

  it("looks through thousands of values at the format's limit", () => {
    const values = Array.from(
      { length: 1000 },
      (_, index) => `v${String(index)}`,
    );
    expect(found(text(values), "v999")).toBe("v999");
    expect(found(text(values), "w")).toBeUndefined();
  });
});
