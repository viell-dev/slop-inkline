import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it, vi } from "vitest";
import { insideCode, insideCodeBlock } from "../../../src/notes/code.ts";
import type * as Html from "../../../src/notes/html.ts";
import type * as Inline from "../../../src/notes/inline.ts";
import { codeCases, triggerCases } from "../../support/code-cases.ts";
import { expectLinear } from "../../support/linear.ts";

/**
 * How many characters of text `insideCode` has handed to the readers of raw
 * HTML and inline text in `src/notes/html.ts` and `src/notes/inline.ts`,
 * which read a paragraph's text for code and for tags: the bounds below count
 * them, as a clock cannot tell a reading that reads each level's text again
 * from one that does not on a busy machine (#451). The wrappers only count;
 * each calls the module's own reader.
 */
const handed = vi.hoisted(() => ({ characters: 0 }));

vi.mock("../../../src/notes/html.ts", async (importOriginal) => {
  const html = await importOriginal<typeof Html>();
  return {
    ...html,
    mayChange: (...args: Parameters<typeof html.mayChange>) => {
      handed.characters += args[0].length;
      return html.mayChange(...args);
    },
    readHtml: (...args: Parameters<typeof html.readHtml>) => {
      handed.characters += args[0].length;
      return html.readHtml(...args);
    },
    readHtmlLine: (...args: Parameters<typeof html.readHtmlLine>) => {
      handed.characters += args[0].length;
      return html.readHtmlLine(...args);
    },
  };
});

vi.mock("../../../src/notes/inline.ts", async (importOriginal) => {
  const inline = await importOriginal<typeof Inline>();
  return {
    ...inline,
    insideInlineCode: (...args: Parameters<typeof inline.insideInlineCode>) => {
      handed.characters += args[0].length;
      return inline.insideInlineCode(...args);
    },
    tagsAfter: (...args: Parameters<typeof inline.tagsAfter>) => {
      handed.characters += args[0].length;
      return inline.tagsAfter(...args);
    },
  };
});

/** A note's lines, as `insideCode` reads them. */
function note(text: string): (index: number) => string | undefined {
  const lines = text.split("\n");
  return (index) => lines[index];
}

/** The line and column of `HERE` in `text`. */
function marker(text: string): { line: number; ch: number } {
  const before = text.slice(0, text.indexOf("HERE")).split("\n");
  return { line: before.length - 1, ch: (before.at(-1) ?? "").length };
}

/** Whether `HERE` in `text` lies in code, as `insideCode` finds it. */
function hereInCode(text: string): boolean {
  const { line, ch } = marker(text);
  return insideCode(note(text), line, ch);
}

describe("insideCode", () => {
  for (const [name, { note: text, code, limit }] of Object.entries(codeCases)) {
    it(`finds code where Obsidian renders it: ${name}`, () => {
      // Where the check knowingly differs, it finds the other answer.
      expect(hereInCode(text)).toBe(limit === undefined ? code : !code);
    });
  }

  for (const [name, { note: text, code }] of Object.entries(triggerCases)) {
    it(`finds code where the insert trigger lists nothing: ${name}`, () => {
      expect(hereInCode(text)).toBe(code);
      // With the trigger and a name typed in place of HERE, as the list
      // reads the line.
      const { line, ch } = marker(text);
      expect(insideCode(note(text.replace("HERE", ";;arc")), line, ch)).toBe(
        code,
      );
    });
  }

  it("runs a span from an earlier line, as in #219", () => {
    expect(hereInCode("`first line\nHERE`")).toBe(true);
    expect(hereInCode("`first line\nmore\nHERE and on\nend`")).toBe(true);
    // Text after the span closes.
    expect(hereInCode("`first line\nend` HERE")).toBe(false);
    // A span that never closes is text, on every line.
    expect(hereInCode("`first line\nHERE\nend")).toBe(false);
  });

  it("ends a quote's fence with the quote, as in #220", () => {
    expect(hereInCode("> ```\n> sample\n\nHERE")).toBe(false);
    expect(hereInCode("> > ```\n> > sample\n\n> HERE")).toBe(false);
    // A fence the note opens runs on through blank lines to its end.
    expect(hereInCode("```\nsample\n\n\nHERE")).toBe(true);
  });

  it("knows an indented code block from a list item's indented text", () => {
    expect(hereInCode("Text.\n\n    HERE")).toBe(true);
    expect(hereInCode("- Item.\n\n    HERE")).toBe(false);
    expect(hereInCode("- Item.\n\n      HERE")).toBe(true);
    // A paragraph goes on through an indented line.
    expect(hereInCode("Text.\n    HERE")).toBe(false);
  });

  it("keeps the single-line cases", () => {
    expect(hereInCode("a `HERE` b")).toBe(true);
    expect(hereInCode("a `x` HERE `y`")).toBe(false);
    expect(hereInCode("a ` HERE")).toBe(false);
    expect(hereInCode("\\`HERE`")).toBe(false);
    expect(hereInCode("# A `HERE` heading")).toBe(true);
  });

  it("reads front matter as code, and what follows it as the note", () => {
    expect(hereInCode("---\ntags: HERE\n---")).toBe(true);
    expect(hereInCode("---\n---\n`a\nHERE`")).toBe(true);
    expect(hereInCode("---\n---\n```\nHERE")).toBe(true);
    expect(hereInCode("---\nHERE")).toBe(false);
  });

  it("keeps a <code> or <pre> the note opened open until it closes", () => {
    // Over blank lines and blocks, as the browser keeps a `<code>` open.
    expect(hereInCode("<code>\n\nHERE\n\n</code>")).toBe(true);
    expect(hereInCode("Some <code>a\n\n# h\n\n- b\n\nHERE")).toBe(true);
    expect(hereInCode("Some <code/>a\n\nHERE")).toBe(true);
    expect(hereInCode("Some <pre>a\n\n> b\n\nHERE")).toBe(true);
    // In quotes, callouts, and list items, and out of them.
    expect(hereInCode("> <code>\n>\n> HERE")).toBe(true);
    expect(hereInCode("> [!note]\n> <code>\n\nHERE")).toBe(true);
    expect(hereInCode("- <code>\n\n  HERE")).toBe(true);
    expect(hereInCode("1. a <code>b\n\n   HERE")).toBe(true);
    // In a heading and a callout's title.
    expect(hereInCode("# <code>a\n\nHERE")).toBe(true);
    expect(hereInCode("> [!note] <code>\n\nHERE")).toBe(true);
    // A table's cell closes with itself what it opens, and what it closes
    // stays open, as the browser keeps a `<code>` open over the table.
    expect(hereInCode("| a | <code>b |\n| - | - |\n\nHERE")).toBe(false);
    expect(hereInCode("| a | <code>b |\n| - | - |\n| HERE |")).toBe(false);
    expect(
      hereInCode("Some <code>a\n\n| x |\n| - |\n| </code> |\n\nHERE"),
    ).toBe(true);
    // Until it closes, in a later block too.
    expect(hereInCode("Some <code>a\n\nb</code> HERE")).toBe(false);
    expect(hereInCode("Some <code>a\n\nb</code>\n\nHERE")).toBe(false);
    expect(hereInCode("<pre>\na\n</pre>\n\nHERE")).toBe(false);
    // A tag in code, a code span, a comment, or a wiki link opens nothing.
    expect(hereInCode("```\n<code>\n```\n\nHERE")).toBe(false);
    expect(hereInCode("a\n\n    <code>\n\nHERE")).toBe(false);
    expect(hereInCode("Use the `<code>` tag.\n\nHERE")).toBe(false);
    expect(hereInCode("%%\n<code>\n%%\n\nHERE")).toBe(false);
    expect(hereInCode("See [[<code>]]\n\nHERE")).toBe(false);
    expect(hereInCode("---\nx: <code>\n---\nHERE")).toBe(false);
  });

  it("reads an HTML block's tags as the browser reads them", () => {
    // Text in a comment or an attribute, on one line or over lines.
    for (const tag of [
      "<!-- </code> -->",
      '<span title="</code>">x</span>',
      "<span title='</code>'>x</span>",
      "<!--\n</code>\n-->",
      '<span title="\n</code>\n">x</span>',
    ]) {
      expect(hereInCode(`<div><code>${tag}\n\nHERE\n\n</code>`)).toBe(true);
    }
    // A real closing tag after them closes the `<code>`.
    expect(hereInCode("<div><code><!-- x --></code>\n\nHERE")).toBe(false);
    expect(
      hereInCode('<div><code><span title="x">x</span></code>\n\nHERE'),
    ).toBe(false);
    expect(hereInCode("<div><code><!--\nx\n-->\n</code>\n\nHERE")).toBe(false);
    // What a block of HTML leaves open before Obsidian's own HTML makes the
    // rest uncertain; a later block of HTML that ends a comment goes on.
    expect(hereInCode("<div><!--\n\nHERE\n\n-->")).toBe(true);
    expect(hereInCode('<div title="\n\na\n\nHERE')).toBe(true);
    expect(hereInCode("<div><!--\n\n<div>-->\n\nHERE")).toBe(false);
    // A `<textarea>`'s text, in a block of HTML, a paragraph, or a cell.
    expect(hereInCode("<div><textarea>\n\nHERE")).toBe(true);
    expect(hereInCode("Some <textarea> b\n\nHERE")).toBe(true);
    expect(hereInCode("| a |\n| - |\n| <textarea> |\n\nHERE")).toBe(true);
    expect(hereInCode("<div><textarea>\n\na\n\n</textarea>\n\nHERE")).toBe(
      false,
    );
    // Where the browser closes nothing: in a table, a `<select>`, and with
    // eight elements or more between, as seven quotes and a paragraph make.
    expect(
      hereInCode("<div><code><table><td></code></td></table>\n\nHERE"),
    ).toBe(true);
    expect(hereInCode("<div><code><select></code></select>\n\nHERE")).toBe(
      true,
    );
    expect(hereInCode("<div><code><table></table></code>\n\nHERE")).toBe(false);
    expect(hereInCode(`<div><code>${"<div>".repeat(8)}</code>\n\nHERE`)).toBe(
      true,
    );
    expect(hereInCode(`<div><code>${"<div>".repeat(7)}</code>\n\nHERE`)).toBe(
      false,
    );
    expect(
      hereInCode(`<div><code>\n\n${"> ".repeat(7)}a </code>\n\nHERE`),
    ).toBe(true);
    expect(
      hereInCode(
        "<div><code>\n\n- a\n  - a\n    - a\n      - a </code>\n\nHERE",
      ),
    ).toBe(true);
    expect(
      hereInCode("<div><code>\n\n- a\n  - a\n    - a </code>\n\nHERE"),
    ).toBe(false);
    // A footnote's text, shown at the note's end, and a definition over
    // lines, which shows nothing, close nothing.
    expect(hereInCode("Some <code>a\n\n[^1]: b </code>\n\nHERE")).toBe(true);
    expect(hereInCode("Some [^1] c\n\n[^1]: <code>d\n\nHERE")).toBe(false);
    expect(hereInCode('Some <code>a\n\n[x\ny]: z "</code>"\n\nHERE')).toBe(
      true,
    );
    // Nothing is certain after a `<script>`, an `<svg>`, or a `<math>`.
    for (const tag of ["script", "svg", "math"]) {
      expect(hereInCode(`<div><${tag}></${tag}></div>\n\nHERE`)).toBe(true);
    }
  });

  it("reads lines that end in a carriage return", () => {
    expect(hereInCode("`a\r\nHERE`\r\n")).toBe(true);
    expect(hereInCode("> ```\r\n> a\r\n\r\nHERE\r\n")).toBe(false);
    expect(hereInCode("```\r\na\r\n```\r\nHERE")).toBe(false);
  });

  it("reads titles nested in titles as deep as a line goes", () => {
    // Each title is a callout's title line in turn. Read by recursion, a
    // call for each, these would overflow the stack.
    const line = `${"> [!a] ".repeat(20_000)}\`HERE\``;
    expect(hereInCode(line)).toBe(true);
    expect(insideCodeBlock(note(line), 0)).toBe(false);
  });

  it("reads a long note's lines once each, and no further than needed", () => {
    const lines = Array.from(
      { length: 4000 },
      (_, index) => `Line ${String(index)}, with \`code\` in it.`,
    );
    // Its paragraphs are 100 lines long; the trigger's line is in one.
    for (let index = 99; index < lines.length; index += 100) lines[index] = "";
    const reads = new Map<number, number>();
    const lineAt = (index: number) => {
      reads.set(index, (reads.get(index) ?? 0) + 1);
      return lines[index];
    };
    expect(insideCode(lineAt, 3050, 3)).toBe(false);
    // The lines up to the trigger's, and the next, to see where its
    // paragraph goes; the first twice, to look for front matter.
    expect(Math.max(...reads.keys())).toBe(3051);
    expect(reads.size).toBe(3052);
    expect([...reads.values()].filter((count) => count > 1)).toEqual([2]);
    // A span open before the trigger reads on to its paragraph's end, but
    // not past it.
    for (let index = 3000; index < 3099; index++) {
      lines[index] = `Line ${String(index)}, of plain text.`;
    }
    lines[3010] = "An open `span";
    lines[3090] = "that closes` here.";
    reads.clear();
    expect(insideCode(lineAt, 3050, 3)).toBe(true);
    expect(Math.max(...reads.keys())).toBe(3099);
    // A span that the trigger's line closes needs no more.
    lines[3050] = "Line 3050` closes it.";
    reads.clear();
    expect(insideCode(lineAt, 3050, 3)).toBe(true);
    expect(Math.max(...reads.keys())).toBe(3051);
  });

  // Each item, or footnote, that is read again as a note of its own can hold
  // another read again in turn. Reading the note's lines once for each such
  // text, through the text around it, as #431's first round did, read them
  // twice as often for each level: forty levels would take days.
  describe("reads a note's lines a bounded number of times, however deep", () => {
    /** Whether `HERE` in `lines` lies in code, and how often a line was read. */
    function readsOf(lines: readonly string[]): {
      readonly code: boolean;
      readonly reads: number;
    } {
      let reads = 0;
      const line = lines.findIndex((text) => text.includes("HERE"));
      const code = insideCode(
        (index) => {
          // Stops a reading that has run away at once, rather than after days.
          if (++reads > 50 * lines.length) throw new Error("read too often");
          return lines[index];
        },
        line,
        lines[line]?.indexOf("HERE") ?? 0,
      );
      return { code, reads };
    }

    /**
     * That reading `lines` at `HERE` hands the readers of HTML and inline
     * text less than `times` the note's length in characters, and takes less
     * than three times as long as simple passes over the note repeated once
     * for each of `depth` levels.
     *
     * The count is what tells a reading that reads each level's text again
     * from one that does not; it is the same however busy the machine is.
     * For the footnotes below, the reading hands the readers 1.00 times the
     * note, and with whether raw HTML leaves a tag open read again at each
     * level, as #431's second round did at d3baf83, 21.92 times; for the
     * items in footnotes, 83.35 times and 335.78. The clock alone told them
     * apart by less than a busy machine moves it: the readings took 0.09 to
     * 0.21 times as long as the simple passes, and d3baf83's 0.87 to 1.28,
     * but one took 0.79 with other work on the machine (#451). So the clock
     * stays only as a backstop, at three times, for work that hands nothing
     * to the readers.
     */
    function expectBounded(
      lines: readonly string[],
      depth: number,
      times: number,
    ): void {
      const line = lines.findIndex((text) => text.includes("HERE"));
      const ch = lines[line]?.indexOf("HERE") ?? 0;
      const note = lines.join("\n");
      const read = () => insideCode((index) => lines[index], line, ch);
      handed.characters = 0;
      read();
      const report = `${String(handed.characters)} characters handed to the readers, for a note of ${String(note.length)}`;
      // Something was counted, so that a reading that stopped going through
      // the readers would not pass this unseen.
      expect(handed.characters, report).toBeGreaterThan(0);
      expect(handed.characters / note.length, report).toBeLessThan(times);
      expectLinear(note.repeat(depth), read, 3);
    }

    // The simple passes take most of the time of the two tests with
    // footnotes below: they took 3 to 5 s alone, and up to 15.7 s with ten
    // busy processes on the machine (#451). They promise nothing about speed
    // but what their checks say.
    const slowLimit = 60_000;

    it("in items, each made to lose fewer columns by a line after it", () => {
      const lines: string[] = [];
      for (let depth = 0; depth < 40; depth++) {
        lines.push(`${" ".repeat(2 * depth)}- a`);
      }
      lines.push(`${" ".repeat(80)}HERE`);
      for (let depth = 39; depth >= 0; depth--) {
        lines.push(`${" ".repeat(2 * depth + 1)}b`);
      }
      const { code, reads } = readsOf(lines);
      expect(code).toBe(false);
      expect(reads).toBeLessThan(5 * lines.length);
    });

    it(
      "in footnotes, each in the one before",
      () => {
        const lines = ["a[^1]", ""];
        for (let depth = 0; depth < 100; depth++) {
          const label = `[^${String(depth + 1)}]:`;
          lines.push(`${" ".repeat(4 * depth)}${label} x <code>a</code>`, "");
        }
        lines.push(`${" ".repeat(400)}HERE`);
        const { code, reads } = readsOf(lines);
        expect(code).toBe(false);
        expect(reads).toBeLessThan(5 * lines.length);
        expectBounded(lines, 100, 4);
      },
      slowLimit,
    );

    it(
      "in items in footnotes in items",
      () => {
        const lines = ["a[^1]", ""];
        for (let depth = 0; depth < 60; depth++) {
          lines.push(`${" ".repeat(4 * depth)}[^${String(depth + 1)}]: x`, "");
          lines.push(`${" ".repeat(4 * depth + 4)}- a`, "");
        }
        lines.push(`${" ".repeat(246)}HERE`);
        for (let depth = 59; depth >= 0; depth--) {
          lines.push(`${" ".repeat(4 * depth + 5)}b`);
        }
        const { code, reads } = readsOf(lines);
        expect(code).toBe(true);
        expect(reads).toBeLessThan(5 * lines.length);
        expectBounded(lines, 60, 160);
      },
      slowLimit,
    );
  });
});

describe("insideCodeBlock", () => {
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

  it("reads a callout's title as a note of one line", () => {
    // A title that opens a fence or is indented as code is a code block,
    // which ends with the title line.
    const fenced = note("> [!note] ```\n> ![[a.ink.png]]");
    expect(insideCodeBlock(fenced, 0)).toBe(true);
    expect(insideCodeBlock(fenced, 1)).toBe(false);
    expect(insideCodeBlock(note("> [!note]     ![[a.ink.png]]"), 0)).toBe(true);
    expect(insideCodeBlock(note("> [!note] ![[a.ink.png]]"), 0)).toBe(false);
  });

  it("ends a fence in a quote or list item with it", () => {
    expect(insideCodeBlock(note("> ```\n> a\n\n;;b"), 3)).toBe(false);
    expect(insideCodeBlock(note("- ```\n  a\n\n;;b"), 3)).toBe(false);
    expect(insideCodeBlock(note("> - ```\n>   a\n>\n> ;;b"), 3)).toBe(false);
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

/** A node of a Markdown syntax tree, as mdast-util-from-markdown makes it. */
interface Tree {
  readonly type: string;
  readonly position?:
    | {
        readonly start: { readonly offset?: number | undefined };
        readonly end: { readonly offset?: number | undefined };
      }
    | undefined;
  readonly children?: readonly Tree[];
}

/** Whether CommonMark puts index `at` of `text` in code. */
function commonMarkCode(text: string, at: number): boolean {
  let node: Tree = fromMarkdown(text);
  for (;;) {
    if (node.type === "code" || node.type === "inlineCode") return true;
    const child: Tree | undefined = node.children?.find(
      ({ position }) =>
        (position?.start.offset ?? Infinity) <= at &&
        at < (position?.end.offset ?? -Infinity),
    );
    if (child === undefined) return false;
    node = child;
  }
}

describe("insideCode beside CommonMark", () => {
  // Lines whose notes Obsidian reads as CommonMark does: no lists, tables,
  // tabs, or runs of backticks but fences, and below, no line that goes on
  // in a quote lazily where CommonMark would end it.
  const lines = [
    "",
    "a`b",
    "c",
    "> d`",
    "> e",
    ">",
    "> ```",
    "> > `f",
    "```",
    "# g`",
    "\\`h",
    "***",
  ];
  const markers = ["HERE", "`HERE", "> HERE`", "> > HERE"];
  /** How many quotes a line is in, and whether it holds more than them. */
  const depth = (line: string) => {
    const quotes = /^(?:> ?)*/.exec(line)?.[0] ?? "";
    return {
      quotes: quotes.split(">").length - 1,
      text: line.length > quotes.length,
    };
  };
  /**
   * Whether line `index` of `note` holds text and leaves a quote right after
   * a line in it, which goes on in the quote in Obsidian after any block,
   * a `>` alone or a fence included, where CommonMark goes on only in a
   * paragraph.
   */
  const lazy = (note: readonly string[], index: number) => {
    const [a, b] = [depth(note[index - 1] ?? ""), depth(note[index] ?? "")];
    return b.quotes < a.quotes && b.text;
  };

  // This checks what is read, not how fast: the parser took 8 seconds for its
  // notes alone, and up to 35.4 under load, past 30 (#362). The limit is at
  // least twice that.
  it(
    "agrees on every note of up to four such lines",
    { timeout: 120_000 },
    () => {
      const notes: string[][] = [[]];
      for (let length = 1; length <= 3; length++) {
        for (const start of notes.filter(
          (lines) => lines.length === length - 1,
        ))
          for (const line of lines) notes.push([...start, line]);
      }
      let compared = 0;
      const differ: string[] = [];
      for (const start of notes) {
        for (const here of markers) {
          for (let at = 0; at <= start.length; at++) {
            const all = [...start.slice(0, at), here, ...start.slice(at)];
            if (all.some((_, index) => index > 0 && lazy(all, index))) continue;
            const text = all.join("\n");
            compared++;
            if (hereInCode(text) !== commonMarkCode(text, text.indexOf("HERE")))
              differ.push(text);
          }
        }
      }
      expect(differ).toEqual([]);
      expect(compared).toBeGreaterThan(10_000);
    },
  );
});
