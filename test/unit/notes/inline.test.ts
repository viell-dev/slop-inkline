import { describe, expect, it } from "vitest";
import { insideInlineCode } from "../../../src/notes/inline.ts";

describe("insideInlineCode", () => {
  it("knows an index between backticks", () => {
    const line = "a `;;x` b";
    expect(insideInlineCode(line, 3)).toBe(true);
    expect(insideInlineCode(line, 6)).toBe(true);
    expect(insideInlineCode(line, 1)).toBe(false);
    expect(insideInlineCode(line, 8)).toBe(false);
  });

  it("matches runs of the same length, and leaves an unclosed run text", () => {
    expect(insideInlineCode("``a`;;``", 5)).toBe(true);
    expect(insideInlineCode("a ` ;;", 5)).toBe(false);
    // An escaped backtick opens nothing.
    expect(insideInlineCode("\\`;;`", 3)).toBe(false);
  });

  it("leaves an unclosed run's first backtick as text, as Obsidian does", () => {
    expect(insideInlineCode("``a ;;`", 4)).toBe(true);
    expect(insideInlineCode("`a ;;``", 3)).toBe(false);
  });

  it("gives up a long run that nothing closes in linear time", () => {
    // A run of n backticks that nothing closes gives them up one at a time.
    // Counted again for each, it would take n²/2 reads, seconds for these
    // where it takes milliseconds.
    const run = "`".repeat(40_000);
    const start = performance.now();
    expect(insideInlineCode(`x ${run} ;;`, 40_004)).toBe(false);
    // Its last backtick still opens a span that a single one closes.
    expect(insideInlineCode(`x ${run} ;; \``, 40_004)).toBe(true);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("says when text after the index could close a span open before it", () => {
    expect(insideInlineCode("a `b ;;", 5, false)).toBeUndefined();
    expect(insideInlineCode("a `b ;;", 5)).toBe(false);
    expect(insideInlineCode("a `b` ;;", 6, false)).toBe(false);
    expect(insideInlineCode("a `b ;;`", 5, false)).toBe(true);
  });

  it("lets what starts first take a backtick, and reads inside it again", () => {
    // `;;` is at index 8 in each.
    expect(insideInlineCode("[[a`b]] ;;`", 8)).toBe(false);
    expect(insideInlineCode("%% `a %% ;;`", 9)).toBe(false);
    expect(insideInlineCode("**`a**  ;;`", 8)).toBe(false);
    // A span inside strong text closes there.
    expect(insideInlineCode("**`;;` b**", 3)).toBe(true);
    expect(insideInlineCode("**`a** ;;", 7)).toBe(false);
    // Where nothing takes it, the backtick opens a span.
    expect(insideInlineCode("[[ab]] `;;`", 8)).toBe(true);
  });

  it("says when what started before the index may end in text to come", () => {
    // Each could still close on a later line of the paragraph.
    expect(insideInlineCode("**`a ;;`", 6, false)).toBeUndefined();
    expect(insideInlineCode("[`a ;;`", 5, false)).toBeUndefined();
    expect(insideInlineCode("$`a ;;`", 5, false)).toBeUndefined();
    // A comment cannot: it ends with its line. Text after a span that
    // closed waits for nothing.
    expect(insideInlineCode("%%`a ;;`", 6, false)).toBe(true);
    expect(insideInlineCode("a `b` ;;", 6, false)).toBe(false);
  });

  it("reads thousands of constructs that nothing closes in bounded time", () => {
    // Each `[` and `*` looks for its end to the text's end, as Obsidian's
    // own reading does. Past a number of steps for the text's length, the
    // text is read for code spans alone, as it was before these were read.
    for (const repeated of ["[a ", "*a ", "~~a ", "==a ", "<a b=", "$a "]) {
      const text = `${repeated.repeat(20_000)}\`;;\``;
      const start = performance.now();
      expect(insideInlineCode(text, text.length - 3)).toBe(true);
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });
});
