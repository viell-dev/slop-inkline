// Synthetic notes, each with HERE where a trigger would be typed, and whether
// Obsidian renders that place as code, as Reading view and MarkdownRenderer
// both showed in Obsidian 1.13.4 and 1.15.0. The unit tests check that
// src/notes/code.ts finds the same, and test/e2e/specs/suggest.e2e.ts that
// Obsidian still renders each case so.

export interface CodeCase {
  /** The note, with `HERE` in it once. */
  readonly note: string;
  /** Whether Obsidian renders the place of `HERE` as code. */
  readonly code: boolean;
  /**
   * Why the check finds the other answer, where it knowingly does: what it
   * does not read.
   */
  readonly limit?: string;
}

/** Why the check finds a code span where Obsidian reads something first. */
const readFirst =
  "Obsidian reads HTML, autolinks, wiki links, comments, math, links, emphasis, strikethrough, and highlights before a code span; the check does not";
const htmlBlock = "the check does not read HTML blocks";

export const codeCases: Readonly<Record<string, CodeCase>> = {
  // A code span runs through the lines of its paragraph.
  "a span on to the next line": { note: "`first\nHERE`", code: true },
  "a span over a blank line": { note: "`first\n\nHERE`", code: false },
  "a span over a line of spaces": { note: "`first\n   \nHERE`", code: false },
  "a span over a line with a tab": { note: "`first\n\t\nHERE`", code: true },
  "a span over spaces and a tab": { note: "`first\n \t \nHERE`", code: true },
  "a span to an indented line": { note: "`first\n    HERE`", code: true },
  "a span to a tab-indented line": { note: "`first\n\tHERE`", code: true },
  "a span after a hard break": { note: "`first  \nHERE`", code: true },
  "a span after a closed one": { note: "`a` `first\nHERE`", code: true },
  "a span over === as text": { note: "`first\nHERE`\n===", code: true },
  "a span ended by a heading": { note: "`first\n# HERE`", code: false },
  "a span ended by ---": { note: "`first\n---\nHERE`", code: false },
  "a span ended by ***": { note: "`first\n***\nHERE`", code: false },
  "a span ended by a bullet": { note: "`first\n* HERE`", code: false },
  "a span ended by a list at 1": { note: "`first\n1. HERE`", code: false },
  "a span not ended by a list at 2": { note: "`first\n2. HERE`", code: true },
  "a span ended by a quote": { note: "`first\n> HERE`", code: false },
  "a span ended by a fence": {
    note: "`first\n~~~\nHERE`\n~~~",
    code: true,
  },
  "an escaped backtick": { note: "\\`first\nHERE`", code: false },
  "runs of two lengths": { note: "``first\nHERE`", code: true },
  // In quotes and lists.
  "a span in a quote": { note: "> `first\n> HERE`", code: true },
  "a span in a callout": { note: "> [!note]\n> `first\n> HERE`", code: true },
  "a span in a quote, lazily": { note: "> `first\nHERE`", code: true },
  "a span out of a nested quote": {
    note: "> > `first\n> HERE`",
    code: true,
  },
  "a span over a quote's blank line": {
    note: "> `first\n>\n> HERE`",
    code: false,
  },
  "a span in a list item": { note: "- `first\n  HERE`", code: true },
  "a span in a list item, lazily": { note: "- `first\nHERE`", code: true },
  "a span to the next item": { note: "- `first\n- HERE`", code: false },
  // Backtick runs on one line.
  "a run of two, closed by one": { note: "x ``a HERE`", code: true },
  "a run of one, closed by two": { note: "x `a HERE``", code: false },
  "a run of three, closed by one": { note: "x ```a HERE`", code: true },
  "a run of three, closed by two": { note: "x ```a HERE``", code: true },
  "a run of two, then a span": { note: "x ``a` HERE`", code: false },
  "a run of two inside a span": { note: "x `a``b HERE`", code: true },
  "an escaped run": { note: "x \\``a HERE`", code: true },
  "an escaped backslash": { note: "x \\\\`a HERE`", code: true },
  "an escape closing a span": { note: "x `a\\` HERE`", code: false },
  // Tables read each cell on its own.
  "a span to the next row": {
    note: "| a | `first |\n| --- | --- |\n| b | HERE` |",
    code: false,
  },
  "a span to the next cell": {
    note: "| a | b |\n| --- | --- |\n| `c | HERE` |",
    code: false,
  },
  "a span over an escaped pipe": {
    note: "| a | b |\n| --- | --- |\n| `c \\| HERE` |",
    code: true,
  },
  "a span in a cell": {
    note: "| a | b |\n| --- | --- |\n| `c` | `d HERE` |",
    code: true,
  },
  "a span in a header's cells": {
    note: "| `a | HERE` |\n| --- | --- |",
    code: false,
  },
  "a span in a quote's table": {
    note: "> | a | b |\n> | --- | --- |\n> | `c | HERE` |",
    code: false,
  },
  "a table without outer pipes": {
    note: "a | b\n--- | ---\n`c | HERE`",
    code: false,
  },
  "a span over a table's rows": {
    note: "| a |\n| --- |\n| `b HERE |\n| c` |",
    code: false,
  },
  "a table after a paragraph's first line": {
    note: "x `first\n| a | b |\n| --- | --- |\n| c | HERE` |",
    code: true,
  },
  "a row without a delimiter row": { note: "| `a\nHERE` |", code: true },
  // A fenced code block in a quote ends with the quote.
  "a quote's fence, then a blank line": {
    note: "> ```\n> sample\n\nHERE",
    code: false,
  },
  "a quote's fence, then a line of spaces": {
    note: "> ```\n> a\n   \nHERE",
    code: false,
  },
  "a quote's fence, then a line with a tab": {
    note: "> ```\n> a\n\t\nHERE",
    code: false,
  },
  "a callout's fence, then a blank line": {
    note: "> [!note]\n> ```\n> a\n\nHERE",
    code: false,
  },
  "a quote's tilde fence, then a blank line": {
    note: "> ~~~\n> a\n\nHERE",
    code: false,
  },
  "a quote's fence, then a new quote": {
    note: "> ```\n> a\n\n> HERE",
    code: false,
  },
  "a quote's fence, closed": { note: "> ```\n> a\n> ```\nHERE", code: false },
  "a quote's fence, its blank line": { note: "> ```\n>\n> HERE", code: true },
  "a quote's fence, without a space": { note: ">```\n>HERE", code: true },
  "an indented quote's fence": { note: "   > ```\n   > HERE", code: true },
  "a quote's fence, lazily": { note: "> ```\n> sample\nHERE", code: true },
  "a quote's fence, lazily, then a quote": {
    note: "> ```\n> a\nb\n> HERE",
    code: true,
  },
  "a quote's fence, lazily, then a blank": {
    note: "> ```\n> a\nb\n\nHERE",
    code: false,
  },
  "a quote's fence, then an indented line": {
    note: "> ```\n> a\n    HERE",
    code: true,
  },
  "a quote's fence, then a list at 2": {
    note: "> ```\n> a\n2. HERE",
    code: true,
  },
  "a quote's fence, then a list at 1": {
    note: "> ```\n> a\n1. HERE",
    code: false,
  },
  "a quote's fence, then a bullet": { note: "> ```\n> a\n- HERE", code: false },
  "a quote's fence, then a heading": {
    note: "> ```\n> a\n# HERE",
    code: false,
  },
  "a quote's fence, then ***": { note: "> ```\n> a\n***\nHERE", code: false },
  "a quote's fence, then a fence": {
    note: "> ```\n> a\n```\nHERE",
    code: true,
  },
  "a quote's fence, then a fence and a quote": {
    note: "> ```\n> a\n```\n> HERE",
    code: true,
  },
  "a quote's fence, then HTML": {
    note: "> ```\n> a\n<div>\nHERE",
    code: false,
    limit: htmlBlock,
  },
  "a nested quote's fence, then the outer quote": {
    note: "> > ```\n> > a\n> HERE",
    code: true,
  },
  "a nested quote's fence, then its blank line": {
    note: "> > ```\n> > a\n>\n> HERE",
    code: false,
  },
  "a nested quote's fence, inside": {
    note: "> > ```\n> > a\n> > HERE",
    code: true,
  },
  "a list's quote's fence, then a blank line": {
    note: "- > ```\n  > a\n\n  HERE",
    code: false,
  },
  "a quote's list's fence, then the quote": {
    note: "> - ```\n>   a\n> HERE",
    code: true,
  },
  "a quote in a fence": { note: "```\n> HERE\n```", code: true },
  // A fenced code block in a list item ends with the item.
  "an item's fence, then a blank line": {
    note: "- ```\n  a\n\nHERE",
    code: false,
  },
  "an item's fence, then a blank line and +": {
    note: "+ ```\n  a\n\nHERE",
    code: false,
  },
  "an item's fence, then a line with a tab": {
    note: "- ```\n  a\n\t\nHERE",
    code: false,
  },
  "an item's fence, over a blank line": {
    note: "- ```\n  a\n\n  HERE",
    code: true,
  },
  "an item's fence, over two blank lines": {
    note: "- ```\n  a\n\n\n  HERE",
    code: true,
  },
  "an item's fence, then too little indent": {
    note: "- ```\n  a\n\n HERE",
    code: false,
  },
  "an item's fence, lazily": { note: "- ```\n  a\nHERE", code: true },
  "an item's fence, lazily, then indented": {
    note: "- ```\n  a\nb\n\n  HERE",
    code: true,
  },
  "an item's fence, then a quote": { note: "- ```\n  a\n> HERE", code: true },
  "an item's fence, then the next item": {
    note: "- ```\n- HERE",
    code: false,
  },
  "an item's fence, then a blank and an item": {
    note: "- ```\n  a\n\n- HERE",
    code: false,
  },
  "an item's fence, then another bullet": {
    note: "- ```\n  a\n* HERE",
    code: false,
  },
  "an item's fence, then a heading": {
    note: "- ```\n  a\n# HERE",
    code: false,
  },
  "an item's fence, then ***": { note: "- ```\n  a\n***\nHERE", code: false },
  "an item's fence, then a fence": {
    note: "- ```\n  a\n```\nHERE",
    code: true,
  },
  "an item's fence, then a fence and a blank": {
    note: "- ```\n  a\n```\n\nHERE",
    code: true,
  },
  "an item's fence, then a fence indented 1": {
    note: "- ```\n  a\n ```\nHERE",
    code: true,
  },
  "a numbered item's fence": { note: "1. ```\n   HERE", code: true },
  "a numbered item's fence, lazily": { note: "1. ```\n  HERE", code: true },
  "a numbered item's fence, then the next": {
    note: "1. ```\n   a\n2. HERE",
    code: false,
  },
  "a nested item's fence, lazily": {
    note: "- a\n  - ```\n    b\n  HERE",
    code: true,
  },
  "a nested item's fence, then the next item": {
    note: "- a\n  - ```\n    b\n- HERE",
    code: false,
  },
  "a nested item's fence, then a blank line": {
    note: "- a\n  - ```\n    b\n\n  HERE",
    code: false,
  },
  "an item's fence, after a paragraph": {
    note: "- a\n\n    ```\n    HERE",
    code: true,
  },
  "an item's fence, indented 3": { note: "- a\n   ```\n   HERE", code: true },
  "an item's fence, by a tab": { note: "- ```\n\tHERE", code: true },
  "a wide item's fence": { note: "-   ```\n    HERE", code: true },
  "a wide item's fence, lazily": { note: "-   ```\n  HERE", code: true },
  "an empty item's fence": { note: "-\n  ```\n  HERE", code: true },
  // Fences elsewhere.
  "a fence open to the end": { note: "```\na\n\nHERE", code: true },
  "a fence indented 2": { note: "  ```\nHERE", code: true },
  "a fence indented 3, after a paragraph": {
    note: "a\n   ```\nHERE",
    code: true,
  },
  "a fence indented 4, after a paragraph": {
    note: "a\n    ```\nHERE",
    code: false,
  },
  "a fence indented 4": { note: "    ```\nHERE", code: false },
  "a fence indented by a tab": { note: "\t```\nHERE", code: false },
  "a fence after a list": { note: "- a\n```\nHERE", code: true },
  // Indented code.
  "an indented line, after a paragraph": {
    note: "a\n    HERE",
    code: false,
  },
  "indented code": { note: "a\n\n    HERE", code: true },
  "indented code, by a tab": { note: "a\n\n\tHERE", code: true },
  "indented code in a list": { note: "- a\n\n      HERE", code: true },
  "an item's indented text": { note: "- a\n\n    HERE", code: false },
  "indented code after a heading": { note: "# a\n    HERE", code: true },
  "indented code after a quote": { note: "> a\n    HERE", code: true },
  // What Obsidian reads before a code span.
  "a backtick in HTML": {
    note: 'a <span title="`">first\nHERE`',
    code: false,
    limit: readFirst,
  },
  "a backtick in an autolink": {
    note: "<http://a.b/`> first\nHERE`",
    code: false,
    limit: readFirst,
  },
  "a backtick in a wiki link": {
    note: "[[a`b]] `first\nHERE`",
    code: true,
    limit: readFirst,
  },
  "a backtick in a comment": {
    note: "%% `first %%\nHERE`",
    code: false,
    limit: readFirst,
  },
  "a backtick in math": {
    note: "$`first$\nHERE`",
    code: false,
    limit: readFirst,
  },
  "a backtick in a link's text": {
    note: "[`first](x)\nHERE`",
    code: false,
    limit: readFirst,
  },
  "a backtick in a link's address": {
    note: "[x](y`) HERE`",
    code: false,
    limit: readFirst,
  },
  "a backtick in emphasis": {
    note: "*`a* HERE`",
    code: false,
    limit: readFirst,
  },
  "a backtick in strong emphasis": {
    note: "**`a** HERE`",
    code: false,
    limit: readFirst,
  },
  "a backtick in strong emphasis, over lines": {
    note: "**`a\nHERE**`",
    code: false,
    limit: readFirst,
  },
  "a backtick in strikethrough": {
    note: "~~`a~~ HERE`",
    code: false,
    limit: readFirst,
  },
  "a backtick in a highlight": {
    note: "==`a== HERE`",
    code: false,
    limit: readFirst,
  },
  "a span in strong emphasis": { note: "**`a HERE` b**", code: true },
  "a span into an HTML block": {
    note: "`first\n<div>\nHERE`",
    code: false,
    limit: htmlBlock,
  },
};
