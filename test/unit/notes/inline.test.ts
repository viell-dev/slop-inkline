import { describe, expect, it } from "vitest";
import {
  insideInlineCode,
  noTags,
  tagsAfter,
  tagsAfterHtml,
} from "../../../src/notes/inline.ts";

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
    // place counts as code, whatever the text holds.
    for (const repeated of ["[a ", "*a ", "~~a ", "==a ", "<a b=", "$a "]) {
      const text = `${repeated.repeat(20_000)}\`;;\``;
      const start = performance.now();
      expect(insideInlineCode(text, text.length - 3)).toBe(true);
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });

  it("counts a place as code where reading would take too long", () => {
    // Read for code spans alone, as a fallback once did, the backtick in the
    // wiki link would pair with the span's own, and `;;` would be text.
    const text = `${"[a ".repeat(1000)}See [[odd\`name]] and \`;;\`.`;
    expect(insideInlineCode(text, text.indexOf(";;"))).toBe(true);
    // In plain text too: nothing is certain once reading stops.
    const plain = `${"[a ".repeat(1000)}See ;; here.`;
    expect(insideInlineCode(plain, plain.indexOf(";;"))).toBe(true);
    // A few brackets read in time.
    const few = `${"[a ".repeat(10)}See ;; here.`;
    expect(insideInlineCode(few, few.indexOf(";;"))).toBe(false);
  });

  it("reads inline HTML of any length", () => {
    // Around where a cutoff once ended a tag: a backtick in a long attribute
    // opens no span, and the span after the tag is code.
    for (let length = 4080; length <= 4110; length++) {
      const text = `Text <span title="${"a".repeat(length)}\`">value</span> and \`;;\`.`;
      expect(insideInlineCode(text, text.indexOf(";;"))).toBe(true);
    }
    const after = `Text <span title="${"a".repeat(4200)}">value</span> ;; here.`;
    expect(insideInlineCode(after, after.indexOf(";;"))).toBe(false);
    // A quote that never closes makes no tag, so its backtick opens a span,
    // which the next backtick closes before `;;`.
    const open = `Text <span title="${"a".repeat(4200)}\` and \`;; here.`;
    expect(insideInlineCode(open, open.indexOf(";;"))).toBe(false);
  });

  it("reads what a <code> tag holds as code, to its </code>", () => {
    expect(insideInlineCode("Some <code>a ;; b</code> c.", 13)).toBe(true);
    expect(insideInlineCode("Some <code>a</code> ;; c.", 20)).toBe(false);
    expect(insideInlineCode('Some <code class="x">;;</code>.', 21)).toBe(true);
    // One that never closes holds the rest of the paragraph.
    expect(insideInlineCode("Some <code>a ;; b", 13)).toBe(true);
    // One that strong text leaves open stays open after it, as the browser
    // keeps it.
    expect(insideInlineCode("Some **a <code>b** ;;</code> c.", 19)).toBe(true);
    // Other tags make no code.
    expect(insideInlineCode("Some <kbd>;;</kbd> c.", 10)).toBe(false);
  });

  it("reads <code/> and <pre> as tags that open code, to their closing tag", () => {
    // A slash closes no `<code>` in the browser.
    for (const tag of ["<code/>", "<code />", '<code class="x"/>', "<CODE>"]) {
      const text = `Some ${tag};; here.`;
      expect(insideInlineCode(text, text.indexOf(";;"))).toBe(true);
      const closed = `Some ${tag}a</code> ;; here.`;
      expect(insideInlineCode(closed, closed.indexOf(";;"))).toBe(false);
    }
    expect(insideInlineCode("Some <pre>a ;;", 12)).toBe(true);
    expect(insideInlineCode("Some <pre>a</pre> ;;", 18)).toBe(false);
    // A closing tag of the other kind closes nothing.
    expect(insideInlineCode("Some <code>a</pre> ;;", 19)).toBe(true);
    // Not tags: a name that goes on, and one in a code span.
    expect(insideInlineCode("Some <coder>a ;;", 14)).toBe(false);
    expect(insideInlineCode("Some `<code>` ;;", 14)).toBe(false);
  });

  it("starts with the tags a note left open before the text", () => {
    expect(insideInlineCode("a ;;", 2, true, { code: 1, pre: 0 })).toBe(true);
    expect(insideInlineCode("</code> ;;", 8, true, { code: 1, pre: 0 })).toBe(
      false,
    );
    expect(tagsAfter("a <code>b", noTags)).toEqual({ code: 1, pre: 0 });
    expect(tagsAfter("a</code> b", { code: 1, pre: 0 })).toEqual(noTags);
    expect(tagsAfter("`<code>` [[<pre>]]", noTags)).toEqual(noTags);
    expect(tagsAfterHtml('<div><code class="x">', noTags)).toEqual({
      code: 1,
      pre: 0,
    });
  });
});
