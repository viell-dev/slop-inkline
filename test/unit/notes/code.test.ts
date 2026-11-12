import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";
import {
  insideCode,
  insideCodeBlock,
  insideCodeSpan,
} from "../../../src/notes/code.ts";
import { codeCases } from "../../support/code-cases.ts";

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

  it("reads lines that end in a carriage return", () => {
    expect(hereInCode("`a\r\nHERE`\r\n")).toBe(true);
    expect(hereInCode("> ```\r\n> a\r\n\r\nHERE\r\n")).toBe(false);
    expect(hereInCode("```\r\na\r\n```\r\nHERE")).toBe(false);
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
});

describe("insideCodeSpan", () => {
  it("knows an index between backticks", () => {
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

  it("leaves an unclosed run's first backtick as text, as Obsidian does", () => {
    expect(insideCodeSpan("``a ;;`", 4)).toBe(true);
    expect(insideCodeSpan("`a ;;``", 3)).toBe(false);
  });

  it("says when text after the index could close a span open before it", () => {
    expect(insideCodeSpan("a `b ;;", 5, false)).toBeUndefined();
    expect(insideCodeSpan("a `b ;;", 5)).toBe(false);
    expect(insideCodeSpan("a `b` ;;", 6, false)).toBe(false);
    expect(insideCodeSpan("a `b ;;`", 5, false)).toBe(true);
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
  // tabs, or runs of backticks but fences, and below, no line that a
  // quote's fence could go on through lazily.
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
   * a line in it, which a quote's fence goes on through in Obsidian: after a
   * line with text, or, once a fence may be open, after a `>` alone.
   */
  const lazy = (note: readonly string[], index: number) => {
    const [a, b] = [depth(note[index - 1] ?? ""), depth(note[index] ?? "")];
    return (
      b.quotes < a.quotes &&
      b.text &&
      (a.text || note.slice(0, index).some((line) => line.includes("```")))
    );
  };

  // This checks what is read, not how fast: the parser takes over a second
  // for its notes, and several beside the other test files, more than
  // Vitest's default.
  it(
    "agrees on every note of up to four such lines",
    { timeout: 30_000 },
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
