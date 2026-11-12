// PROTOTYPE for #167, section 3: how a run of symbols splits into words.
import { describe, expect, it } from "vitest";
import {
  composedReading,
  type Lexicon,
  segment,
  wordKey,
} from "../../../src/render/words.ts";

const lexicon = (words: Record<string, string>): Lexicon => {
  const entries = new Map(
    Object.entries(words).map(([symbols, meaning]) => [
      wordKey(symbols.split(" ")),
      { meaning },
    ]),
  );
  return {
    entries,
    longest: Math.max(...Object.keys(words).map((key) => key.split(" ").length)),
  };
};

const split = (run: string, known: Lexicon) =>
  segment(run.split(" "), known).map((piece) =>
    piece.entry?.meaning ?? `(${run.split(" ").slice(piece.start, piece.end).join(" ")})`,
  );

describe("segment", () => {
  const known = lexicon({
    "ring posts": "river",
    "zig ring posts": "ferry crossing",
    "hook hook": "night",
    zig: "boat",
  });

  it("finds spaced words whole", () => {
    expect(split("ring posts", known)).toEqual(["river"]);
  });

  it("splits a run without spaces into known words, longest first", () => {
    expect(split("zig ring posts hook hook", known)).toEqual([
      "ferry crossing",
      "night",
    ]);
  });

  it("cannot tell 'boat river' from 'ferry crossing'", () => {
    // Both are words of the lexicon; the longest match wins.
    expect(split("zig ring posts", known)).toEqual(["ferry crossing"]);
  });

  it("leaves unknown symbols on their own", () => {
    expect(split("ring zig posts", known)).toEqual([
      "(ring)",
      "boat",
      "(posts)",
    ]);
  });

  it("can split wrongly where a longer word starts inside a shorter one", () => {
    // "ab" + "cd" is meant, but "abc" is also a word: greedy takes it and
    // leaves "d" alone.
    const tricky = lexicon({ "a b": "AB", "c d": "CD", "a b c": "ABC" });
    expect(split("a b c d", tricky)).toEqual(["ABC", "(d)"]);
  });
});

describe("composedReading", () => {
  it("joins the main readings, with ? for a symbol without one", () => {
    expect(composedReading([["ka"], ["ri"]], "")).toBe("kari");
    expect(composedReading([["mu", "bu"], ["mu", "bu"]], "")).toBe("mumu");
    expect(composedReading([["ri"], []], "-")).toBe("ri-?");
  });
});
