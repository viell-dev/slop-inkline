// PROTOTYPE for #167, section 5: how a run of symbols splits when words
// overlap, when a symbol is a word and a syllable, and when a compound means
// something its parts do not; and the lexicon note's columns and rows.
import { describe, expect, it } from "vitest";
import {
  type Lexicon,
  segment,
  segmentGreedy,
  wordKey,
} from "../../../src/render/words.ts";
import {
  changedRow,
  columnsOf,
  newRow,
  rowCells,
} from "../../../src/notes/lexicon-table.ts";

const lexicon = (words: Record<string, string>): Lexicon => ({
  entries: new Map(
    Object.entries(words).map(([symbols, meaning]) => [
      wordKey(symbols.split(" ")),
      { meaning },
    ]),
  ),
  longest: Math.max(...Object.keys(words).map((key) => key.split(" ").length)),
});

const show =
  (split: typeof segment) =>
  (run: string, known: Lexicon): string[] => {
    const symbols = run.split(" ");
    return split(symbols, known).map(
      (piece) =>
        piece.entry?.meaning ??
        `(${symbols.slice(piece.start, piece.end).join(" ")})`,
    );
  };
const whole = show(segment);
const greedy = show(segmentGreedy);

describe("segment, choosing a whole split", () => {
  it("prefers a compound to its parts: the owner's example", () => {
    // Each part is a word too, as a logogram can be.
    const known = lexicon({
      left: "left",
      right: "right",
      adult: "adult",
      "left adult": "father",
      "right adult": "mother",
    });
    expect(whole("left adult", known)).toEqual(["father"]);
    expect(whole("right adult left adult", known)).toEqual([
      "mother",
      "father",
    ]);
    expect(whole("adult left", known)).toEqual(["adult", "left"]);
    expect(whole("left left adult", known)).toEqual(["left", "father"]);
  });

  it("prefers the longer compound that contains a shorter one", () => {
    const known = lexicon({
      big: "big",
      "left adult": "father",
      "big left adult": "grandfather",
    });
    expect(whole("big left adult", known)).toEqual(["grandfather"]);
  });

  it("fixes the greedy split that left a symbol over", () => {
    const tricky = lexicon({ "a b": "AB", "c d": "CD", "a b c": "ABC" });
    expect(greedy("a b c d", tricky)).toEqual(["ABC", "(d)"]);
    expect(whole("a b c d", tricky)).toEqual(["AB", "CD"]);
  });

  it("still cannot tell two splits that both cover everything", () => {
    // "big left" + "adult", or "big" + "left adult": both two words. The
    // longer first word wins; only a break marked in the note can say.
    const known = lexicon({
      big: "big",
      adult: "adult",
      "big left": "elder",
      "left adult": "father",
    });
    expect(whole("big left adult", known)).toEqual(["elder", "adult"]);
  });

  it("leaves the fewest symbols out where overlapping words compete", () => {
    const known = lexicon({ "a b": "AB", "b c": "BC" });
    // Either leaves one out: the longer first word wins the tie.
    expect(whole("a b c", known)).toEqual(["AB", "(c)"]);
    expect(whole("a b c b c", known)).toEqual(["AB", "(c)", "BC"]);
  });

  it("agrees with greedy where greedy was right", () => {
    const known = lexicon({
      "ring posts": "river",
      "zig ring posts": "ferry crossing",
      "hook hook": "night",
      zig: "boat",
    });
    for (const run of [
      "ring posts",
      "zig ring posts hook hook",
      "zig ring posts",
      "ring zig posts",
    ]) {
      expect(whole(run, known)).toEqual(greedy(run, known));
    }
  });

  it("splits a long run quickly", () => {
    const known = lexicon({ "a b": "AB", "b a": "BA", "a b a": "ABA" });
    const run = Array.from({ length: 5000 }, (_, i) => (i % 2 ? "b" : "a"));
    const start = performance.now();
    const pieces = segment(run, known);
    expect(performance.now() - start).toBeLessThan(500);
    expect(pieces.reduce((sum, p) => sum + (p.end - p.start), 0)).toBe(5000);
  });
});

describe("lexicon columns", () => {
  it("finds columns by their names, in any order, with extras", () => {
    expect(
      columnsOf(rowCells("| Meaning | Notes | Word | Parts | Reading |")),
    ).toEqual({ word: 2, reading: 4, meaning: 0, parts: 3 });
  });

  it("reads a table without a word heading by position", () => {
    expect(columnsOf(rowCells("| A | B | C |"))).toEqual({
      word: 0,
      reading: 1,
      meaning: 2,
    });
  });

  it("changes a row's reading and meaning and nothing else", () => {
    const columns = { word: 0, reading: 1, meaning: 2 };
    expect(
      changedRow(
        "| ![[a.ink.png]]![[b.ink.png]] | | river | kept |",
        columns,
        "kari",
        "stream | brook",
      ),
    ).toBe(
      "| ![[a.ink.png]]![[b.ink.png]] | kari | stream \\| brook | kept |",
    );
  });

  it("makes a row for a table's columns", () => {
    expect(
      newRow({ word: 1, meaning: 0 }, 3, "![[a.ink.png]]", "x", "one"),
    ).toBe("| one | ![[a.ink.png]] |  |");
  });
});
