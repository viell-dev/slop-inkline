import { isOpen, noTags, readHtml } from "../../../src/notes/html.ts";
import { describe, expect, it } from "vitest";
import { insideInlineCode, tagsAfter } from "../../../src/notes/inline.ts";
import { expectLinear as expectLinearReading } from "../../support/linear.ts";

/**
 * How many times as long as `simplePasses` in `test/support/linear.ts` a
 * reading of a long text below may take. On Windows 11 with the CPU busy with
 * other work, in two sessions' measurements, the readings took 0.5 to 7.8 times
 * as long; with their bound on steps taken out, so that each construct looks
 * for its end to the text's end, 225 to 790 times; and with a run of backticks
 * counted again for each backtick, 527 to 1,207 times. Limits by the clock
 * alone, one second and half a second, failed under load, for readings that
 * take tens of milliseconds (#403).
 */
const linearTimes = 40;

/** That reading `text` at `at` takes the time of a linear reading. */
function expectLinear(text: string, at: number): void {
  expectLinearReading(text, () => insideInlineCode(text, at), linearTimes);
}

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
    expect(insideInlineCode(`x ${run} ;;`, 40_004)).toBe(false);
    // Its last backtick still opens a span that a single one closes.
    expect(insideInlineCode(`x ${run} ;; \``, 40_004)).toBe(true);
    expectLinear(`x ${run} ;;`, 40_004);
    expectLinear(`x ${run} ;; \``, 40_004);
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
      expect(insideInlineCode(text, text.length - 3)).toBe(true);
      expectLinear(text, text.length - 3);
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

  it("starts with what the note left open before the text", () => {
    const open = readHtml("<code>", noTags);
    expect(insideInlineCode("a ;;", 2, true, open)).toBe(true);
    expect(insideInlineCode("</code> ;;", 8, true, open)).toBe(false);
    expect(isOpen(tagsAfter("a <code>b", noTags))).toBe(true);
    expect(isOpen(tagsAfter("a</code> b", open))).toBe(false);
    expect(tagsAfter("`<code>` [[<pre>]]", noTags)).toBe(noTags);
  });

  it("reads inline HTML as the browser reads it", () => {
    const open = readHtml("<code>", noTags);
    // Text in an attribute or a comment closes nothing.
    expect(isOpen(tagsAfter('a <span title="</code>">b</span>', open))).toBe(
      true,
    );
    expect(isOpen(tagsAfter("a <!-- </code> -->", open))).toBe(true);
    // A `<?` and CDATA end at their first `>`, and what follows is read.
    expect(isOpen(tagsAfter("Some <? b > <code> ?>", noTags))).toBe(true);
    expect(isOpen(tagsAfter("Some <![CDATA[ > <code> ]]>", noTags))).toBe(true);
    expect(isOpen(tagsAfter("Some <? b > </code> ?>", open))).toBe(false);
    // What one leaves open, Obsidian's own HTML may end or not.
    expect(tagsAfter('Some <? b > <span title=" ?>', noTags).unsure).toBe(true);
    // A footnote's text, shown at the note's end, opens and closes nothing.
    expect(isOpen(tagsAfter("Some ^[b <code>] c", noTags))).toBe(false);
    expect(isOpen(tagsAfter("a ^[b </code>] c", open))).toBe(true);
    // Strong text closes nothing opened before it, as the safe reading.
    expect(isOpen(tagsAfter("a **b</code>** c", open))).toBe(true);
    // A `<textarea>`'s text is text, to its own closing tag.
    expect(isOpen(tagsAfter("a <textarea> b", noTags))).toBe(true);
    expect(
      isOpen(tagsAfter("a <textarea>b</code></textarea> </code>", open)),
    ).toBe(false);
  });

  it("counts a place in inline HTML, math, or a comment as code", () => {
    // An embed there shows nothing.
    expect(insideInlineCode('Some <span title=";;">a</span>', 18)).toBe(true);
    expect(insideInlineCode("Some <!-- ;; -->", 10)).toBe(true);
    expect(insideInlineCode("Some <? ;; ?>", 8)).toBe(true);
    expect(insideInlineCode("Some $a ;;$ b", 8)).toBe(true);
    expect(insideInlineCode("Some $$;;$$ b", 7)).toBe(true);
    expect(insideInlineCode("Some %% ;; %% b", 8)).toBe(true);
    // Text around them, and in an element's text, shows.
    expect(insideInlineCode("Some <b>;;</b>", 8)).toBe(false);
    expect(insideInlineCode("Some $a$ ;;", 9)).toBe(false);
    expect(insideInlineCode("Some %%a%% ;;", 11)).toBe(false);
  });
});
