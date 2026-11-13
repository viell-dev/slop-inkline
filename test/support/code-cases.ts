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
/** Why the check ends a quote where Obsidian keeps it. */
const lazyQuote =
  "Obsidian goes on in a quote at a line without its > after any block but a blank line; the check only after a paragraph, a fence, or a callout's title";
/** Why the check finds text where a tab makes indented code. */
const tabIndent =
  "Obsidian keeps a tab after a quote's > or a space, or after a list item's marker and a space, as indentation of its own; the check does not";

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
  "a span ended by an empty bullet": { note: "`HERE\n- \n`", code: false },
  "a span ended by an empty *": { note: "`HERE\n*\n`", code: false },
  "a span ended by an empty +": { note: "`HERE\n+\n`", code: false },
  "a span ended by an empty list at 1": { note: "`HERE\n1.\n`", code: false },
  "a span ended by an empty list at 1)": { note: "`HERE\n1)\n`", code: false },
  "a span not ended by an empty list at 2": {
    note: "`HERE\n2. \n`",
    code: true,
  },
  "a span ended by a - underline": { note: "`HERE\n-\n`", code: false },
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
  "a span over a quote's tab line, lazily": {
    note: "> `a\n>\t\nHERE`",
    code: true,
  },
  "a span over a quote's space and tab, lazily": {
    note: "> `a\n> \t\nHERE`",
    code: true,
  },
  "a span over a nested quote's tab line, lazily": {
    note: "> > `a\n> >\t\nHERE`",
    code: true,
  },
  "a span in a quote, ended by an empty item": {
    note: "> ``HERE\n> 1. \n> `a",
    code: false,
  },
  "a span in a quote, then an empty bullet": {
    note: "> `a\n- \nHERE`",
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
  "a quote's fence, its blank line, then lazily": {
    note: "> ```\n>\nHERE",
    code: true,
  },
  "a quote's fence, its blank line and a space, lazily": {
    note: "> ```\n> \nHERE",
    code: true,
  },
  "a quote's fence, a line and a blank one, lazily": {
    note: "> ```\n> a\n>\nHERE",
    code: true,
  },
  "a quote's fence, its tab line, then lazily": {
    note: "> ```\n>\t\nHERE",
    code: true,
  },
  "a quote's fence, its blank line, lazily, then a blank": {
    note: "> ```\n>\nb\n\nHERE",
    code: false,
  },
  "a nested quote's fence, its blank line, lazily": {
    note: "> > ```\n> >\nHERE",
    code: true,
  },
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
  "a quote's fence, then an empty bullet": {
    note: "> ```\n> a\n-\nHERE",
    code: false,
  },
  "a quote's fence, then an empty list at 1": {
    note: "> ```\n> a\n1.\nHERE",
    code: false,
  },
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
  "an item's fence, then quote lines": {
    note: "- ```\n  a\n> b\n> HERE",
    code: true,
  },
  "an item's fence, then a quote's fence": {
    note: "- ```\n  a\n> ```\n> HERE",
    code: true,
  },
  // A quote right under a list item, without the item's indentation, is in
  // the item, and its later lines go on in that quote.
  "a span in a quote under an item": {
    note: "- a\n> `b\n> HERE`",
    code: true,
  },
  "a span in a callout under an item": {
    note: "- a\n> [!note]\n> `b\n> HERE`",
    code: true,
  },
  "a span in a quote under a numbered item": {
    note: "1. a\n> `b\n> HERE`",
    code: true,
  },
  "a span in a quote under a nested item": {
    note: "- a\n  - b\n> `c\n> HERE`",
    code: true,
  },
  "a span in a quote under a quote's item": {
    note: "> - a\n> > `b\n> > HERE`",
    code: true,
  },
  "a span in a quote under an item, over a lazy line": {
    note: "- a\n> b\nc `d\n> HERE`",
    code: true,
  },
  "a closed fence in a quote under an item": {
    note: "- a\n> ```\n> x\n> ```\n> HERE",
    code: false,
  },
  "a closed fence in a quote under an item, lazily": {
    note: "- a\n> ```\n> x\n> ```\nHERE",
    code: false,
  },
  "a table in a quote under an item": {
    note: "- a\n> | x | y |\n> | - | - |\n> | `b | HERE` |",
    code: false,
  },
  "a span in a quote under an item, from its second line": {
    note: "- a\n> b\n> `c\n> HERE`",
    code: true,
  },
  "a span in a quote under an item, to its third line": {
    note: "- a\n> `b\n> c\n> HERE`",
    code: true,
  },
  "a span in a quote under an item's second line": {
    note: "- a\n  b\n> `c\n> HERE`",
    code: true,
  },
  "a span in a quote under an item, over a lazy line in it": {
    note: "- a\n> `b\nc\n> HERE`",
    code: true,
  },
  "a span in a quote under an item, to a lazy line": {
    note: "- a\n> `b\n> c\nHERE`",
    code: true,
  },
  "a span in a quote under a second item": {
    note: "- a\n- b\n> c\n> `d\n> HERE`",
    code: true,
  },
  "a span in a quote under an item after a quote": {
    note: "> q\n- a\n> `b\n> HERE`",
    code: true,
  },
  "a span in a nested quote under an item": {
    note: "- a\n> > `b\n> > HERE`",
    code: true,
  },
  "a span in a quote under a quote's item, from its second line": {
    note: "> - a\n> > `b\n> > c\n> > HERE`",
    code: true,
  },
  "a span in a quote under an item's indented quote": {
    note: "- a\n  > b\n> `c\n> HERE`",
    code: true,
  },
  "a span in a quote under a nested item, indented": {
    note: "- a\n  - b\n  > `c\n  > HERE`",
    code: true,
  },
  "a closed fence in a callout under an item": {
    note: "- a\n> [!note]\n> ```\n> x\n> ```\n> HERE",
    code: false,
  },
  "a closed fence in a quote under a numbered item": {
    note: "1. a\n> ```\n> x\n> ```\n> HERE",
    code: false,
  },
  "a table in a quote under a nested item": {
    note: "- a\n  - b\n> | x | y |\n> | - | - |\n> | `c | HERE` |",
    code: false,
  },
  "a table in a quote under a quote's item": {
    note: "> - a\n> > | x | y |\n> > | - | - |\n> > | `b | HERE` |",
    code: false,
  },
  "a quote under an item, then its text": {
    note: "- a\n> b\n> HERE",
    code: false,
  },
  "a span from an item into a quote under it": {
    note: "- `a\n> HERE`",
    code: false,
  },
  "a span over a blank line in a quote under an item": {
    note: "- a\n> `b\n>\n> HERE`",
    code: false,
  },
  "a span in a quote under an item, then an item in it": {
    note: "- a\n> `b\n> - HERE`",
    code: false,
  },
  "a span in an item in a quote under an item": {
    note: "- a\n> - `b\n>   HERE`",
    code: true,
  },
  "a fence in a quote under an item, over a blank quote line": {
    note: "- a\n> ```\n> x\n>\n> HERE",
    code: true,
  },
  "a span after a closed fence in a quote under an item": {
    note: "- a\n> ```\n> x\n> ```\n> `y\n> HERE`",
    code: true,
  },
  "a fence in a quote under an item, then the next item": {
    note: "- a\n> ```\n> x\n- HERE",
    code: false,
  },
  "a fence in a quote under an item, its blank line, lazily": {
    note: "- a\n> ```\n>\nHERE",
    code: true,
  },
  "a fence in a quote under an item, its blank line, an item": {
    note: "- a\n> ```\n>\n- HERE",
    code: false,
  },
  "a fence in an item's quote, its blank line, lazily": {
    note: "- a\n  > ```\n  >\nHERE",
    code: true,
  },
  "a fence in a quote under an item, lazily": {
    note: "- a\n> ```\n> x\n  HERE",
    code: true,
  },
  "a span in a quote under an item, over a tab line": {
    note: "- a\n> `b\n>\t\nHERE`",
    code: true,
  },
  "a span in a quote under an item, then indented": {
    note: "- a\n> `b\n  > HERE`",
    code: true,
  },
  "a span in a quote's item's quote, lazily": {
    note: "> - a\n> > `b\n> HERE`",
    code: true,
  },
  "a span in a quote under a wide numbered item": {
    note: "1.  a\n  > `b\n> HERE`",
    code: true,
  },
  "a quote under an empty item": { note: "-\n> b\n\n    HERE", code: false },
  "a quote under an item, over its blank line": {
    note: "- a\n> b\n>\n> c\n\n    HERE",
    code: false,
  },
  "a quote under a nested item, over its blank line": {
    note: "- a\n  - b\n  >\n> c\n\n      HERE",
    code: false,
  },
  "a quote under an item's later paragraph": {
    note: "- a\n\n  b\n> c\n\n    HERE",
    code: false,
  },
  "a quote after an item's blank line": {
    note: "- a\n\n> b\n\n    HERE",
    code: true,
  },
  "a quote under an item, then a blank and a quote": {
    note: "- a\n> b\n\n> c\n\n    HERE",
    code: true,
  },
  "an item's fence, a blank line, then a quote": {
    note: "- ```\n  a\n\n> HERE",
    code: false,
  },
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
  // A callout's title line is read on its own, and its content from the next
  // line, which goes on in the quote without its `>`.
  "a span from a callout's title": {
    note: "> [!note] `a\n> `HERE`",
    code: true,
  },
  "a span after text, from a callout's title": {
    note: "> [!note] `a\n> b `HERE`",
    code: true,
  },
  "a span from the title of a callout under an item": {
    note: "- a\n> [!note] `b\n> `HERE`",
    code: true,
  },
  "a span after a closed one in a callout's title": {
    note: "> [!note] `a` `b\n> `HERE`",
    code: true,
  },
  "a span from a foldable callout's title": {
    note: "> [!note]+ `a\n> `HERE`",
    code: true,
  },
  "a span from a folded callout's title": {
    note: "> [!note]- `a\n> `HERE`",
    code: true,
  },
  "a span from an unknown callout's title": {
    note: "> [!xyz] `a\n> `HERE`",
    code: true,
  },
  "a span from a callout's title, lazily": {
    note: "> [!note] `a\n`HERE`",
    code: true,
  },
  "a callout's title, then its text": {
    note: "> [!note] `a\n> HERE`",
    code: false,
  },
  "a callout's title, then a span after its text": {
    note: "> [!note] `a\n> HERE `b`",
    code: false,
  },
  "a callout's title, then a lazy line": {
    note: "> [!note] `a\nHERE`",
    code: false,
  },
  "a span in a callout with no title": {
    note: "> [!note]\n> `HERE`",
    code: true,
  },
  "a span in a callout with no title, from its first line": {
    note: "> [!note]\n> `a\n> HERE`",
    code: true,
  },
  "a span in a callout with a title of spaces": {
    note: "> [!note]   \n> `a\n> HERE`",
    code: true,
  },
  "a callout's title, by CRLF": {
    note: "> [!note] `a\r\n> `HERE`\r\n",
    code: true,
  },
  // What makes a callout's title line.
  "a [!note] after a quote's first line": {
    note: "> x\n> [!note] `a\n> `HERE`",
    code: false,
  },
  "a [!note] after a quote's empty first line": {
    note: ">\n> [!note] `a\n> `HERE`",
    code: false,
  },
  "a [!note] after a quote's lazy line": {
    note: "> a\nb\n> [!note] `c\n> `HERE`",
    code: false,
  },
  "a [!note] after a quote's closed fence": {
    note: "> ```\n> x\n> ```\n> [!note] `a\n> `HERE`",
    code: false,
  },
  "a [!note] in a quote's fence": {
    note: "> ```\n> [!note] `a\n> `HERE`",
    code: true,
  },
  "a [!note] two spaces after >": {
    note: ">  [!note] `a\n> `HERE`",
    code: false,
  },
  "a [!note] three spaces after >": {
    note: ">   [!note] `a\n> `HERE`",
    code: false,
  },
  "a callout right after >": { note: ">[!note] `a\n> `HERE`", code: true },
  "an indented callout": { note: "   > [!note] `a\n> `HERE`", code: true },
  "a callout's text right after >": {
    note: "> [!note] `a\n>`HERE`",
    code: true,
  },
  "a callout after a blank line": {
    note: "> x\n\n> [!note] `a\n> `HERE`",
    code: true,
  },
  "a callout under a paragraph": {
    note: "a\n> [!note] `b\n> `HERE`",
    code: true,
  },
  "a callout under a heading": {
    note: "# h\n> [!note] `a\n> `HERE`",
    code: true,
  },
  "a callout after front matter": {
    note: "---\nx: y\n---\n> [!note] `a\n> `HERE`",
    code: true,
  },
  "a callout's type in capitals": {
    note: "> [!NOTE] `a\n> `HERE`",
    code: true,
  },
  "a callout's type with a space": {
    note: "> [!no te] `a\n> `HERE`",
    code: true,
  },
  "a callout's type of a space": { note: "> [! ] `a\n> `HERE`", code: true },
  "a callout's type with a [": { note: "> [!a[b] `a\n> `HERE`", code: true },
  "a callout's type with its metadata": {
    note: "> [!a|b] `a\n> `HERE`",
    code: true,
  },
  "a callout's type with a backtick": {
    note: "> [!a`b] c\n> HERE`",
    code: false,
  },
  "a callout's type, then a tab": {
    note: "> [!note]\t`a\n> `HERE`",
    code: true,
  },
  "a callout's type, then a no-break space": {
    note: "> [!note]\u00a0`a\n> `HERE`",
    code: true,
  },
  "a callout's type, then two spaces": {
    note: "> [!note]  `a\n> `HERE`",
    code: true,
  },
  "a [!note] with no space after it": {
    note: "> [!note]x `a\n> `HERE`",
    code: false,
  },
  "a [!note] with a zero-width space after it": {
    note: "> [!note]\u200b`a\n> `HERE`",
    code: false,
  },
  "a [!note]+ with no space after it": {
    note: "> [!note]+`a\n> `HERE`",
    code: false,
  },
  "a [!note] with two fold signs": {
    note: "> [!note]+- `a\n> `HERE`",
    code: false,
  },
  "a [!note] with another ]": {
    note: "> [!note]] `a\n> `HERE`",
    code: false,
  },
  "an empty [!]": { note: "> [!] `a\n> `HERE`", code: false },
  "an unclosed [!note": { note: "> [!note `a\n> `HERE`", code: false },
  "a [ !note]": { note: "> [ !note] `a\n> `HERE`", code: false },
  // Callouts in list items and in other quotes and callouts.
  "a callout on an item's line": {
    note: "- > [!note] `a\n  > `HERE`",
    code: true,
  },
  "a callout on a numbered item's line": {
    note: "1. > [!note] `a\n   > `HERE`",
    code: true,
  },
  "a callout on an item's line, then a line under the item": {
    note: "- > [!note] `a\n> `HERE`",
    code: true,
  },
  "a callout in an item's indented quote": {
    note: "- a\n  > [!note] `b\n  > `HERE`",
    code: true,
  },
  "a callout on the line of a quote's item": {
    note: "> - > [!note] `a\n>   > `HERE`",
    code: true,
  },
  "a callout in a second item": {
    note: "- a\n- > [!note] `b\n  > `HERE`",
    code: true,
  },
  "a callout in a quote under a quote's item": {
    note: "> - a\n> > [!note] `b\n> > `HERE`",
    code: true,
  },
  "a callout on an item's line after a quote": {
    note: "> x\n- > [!note] `a\n  > `HERE`",
    code: true,
  },
  "a callout under an item, then a span": {
    note: "- a\n> [!note] `b\n> `c\n> HERE`",
    code: true,
  },
  "a callout's title under an item, then its text": {
    note: "- a\n> [!note] `b\n> HERE`",
    code: false,
  },
  "a callout's title under an item, then a lazy line": {
    note: "- a\n> [!note] `b\n`HERE`",
    code: true,
  },
  "a [!note] in an item": { note: "- [!note] `a\n  `HERE`", code: false },
  "a [!note] in a quote's item": {
    note: "> - [!note] `a\n>   `HERE`",
    code: false,
  },
  "a callout in a quote": {
    note: "> > [!note] `a\n> > `HERE`",
    code: true,
  },
  "a callout in a quote's second line": {
    note: "> x\n> > [!note] `a\n> > `HERE`",
    code: true,
  },
  "a [!note] on a nested quote's second line": {
    note: "> > x\n> > [!note] `a\n> > `HERE`",
    code: false,
  },
  "a callout in a callout": {
    note: "> [!outer]\n> > [!inner] `a\n> > `HERE`",
    code: true,
  },
  "a nested callout's title, then the outer quote's line": {
    note: "> > [!note] `a\n> `HERE`",
    code: true,
  },
  "a span in the title of a callout in a callout's title": {
    note: "> [!a] > [!b] `HERE`",
    code: true,
  },
  "a callout in a callout's title": {
    note: "> [!note] > [!inner] `a\n> `HERE`",
    code: true,
  },
  // The line after a title, without its `>`, starts the callout's content.
  "a span from a lazy line after a callout's title": {
    note: "> [!note] x\n`a\n> HERE`",
    code: true,
  },
  "a span from a lazy line after a callout with no title": {
    note: "> [!note]\n`a\n> HERE`",
    code: true,
  },
  "a span after text on a lazy line after a callout's title": {
    note: "> [!note] `x\na `b\n> HERE`",
    code: true,
  },
  "a lazy line after the title of a callout on an item's line": {
    note: "- > [!note] x\n`a\n  > HERE`",
    code: true,
  },
  "a lazy line after a nested callout's title": {
    note: "> > [!note] x\n`a\n> > HERE`",
    code: true,
  },
  "a lazy list at 2 after a callout's title": {
    note: "> [!note] x\n2. `a\n> HERE`",
    code: true,
  },
  "a lazy table after a callout's title": {
    note: "> [!note] x\n| a |\n> | - |\n> | HERE` |",
    code: false,
  },
  "a lazy line after a callout's title, then a nested quote": {
    note: "> [!note] x\n`a\n> > HERE`",
    code: false,
  },
  "a lazy indented line after a callout's title": {
    note: "> [!note] x\n    `a\n> HERE`",
    code: false,
  },
  "a heading after a callout's title": {
    note: "> [!note] x\n# h\n> HERE",
    code: false,
  },
  "a blank line after a callout's title": {
    note: "> [!note]\n\n`a\n> HERE`",
    code: false,
  },
  "a callout's title with pipes, then a delimiter row": {
    note: "> [!note] | a |\n> | - | - |\n> | `c | HERE` |",
    code: true,
  },
  "a table in a callout": {
    note: "> [!note]\n> | a | b |\n> | - | - |\n> | `c | HERE` |",
    code: false,
  },
  "a table under a callout's title": {
    note: "> [!note] Title\n> | a | b |\n> | - | - |\n> | `c | HERE` |",
    code: false,
  },
  "a table in a callout under an item": {
    note: "- a\n> [!note]\n> | a | b |\n> | - | - |\n> | `c | HERE` |",
    code: false,
  },
  "a span in a cell of a callout's table": {
    note: "> [!note]\n> | a | b |\n> | - | - |\n> | c | `HERE` |",
    code: true,
  },
  // A callout's title is a note of one line.
  "a span in a callout's title": { note: "> [!note] `HERE`", code: true },
  "text between spans in a callout's title": {
    note: "> [!note] `a` HERE `b`",
    code: false,
  },
  "a span from a callout's title, unclosed": {
    note: "> [!note] a `HERE\n> b`",
    code: false,
  },
  "a span in a callout's title, after a backtick in its type": {
    note: "> [!a`b] `HERE`",
    code: true,
  },
  "text in a callout's title, after a backtick in its type": {
    note: "> [!no`te] HERE `x`",
    code: false,
  },
  "a heading in a callout's title": {
    note: "> [!note] # `HERE`",
    code: true,
  },
  "indented code in a callout's title": {
    note: "> [!note]     HERE",
    code: true,
  },
  "indented code in a callout's title, after a tab": {
    note: "> [!note]\t    HERE",
    code: true,
  },
  "a callout's title after four spaces": {
    note: "> [!note]    HERE",
    code: false,
  },
  "a fence in a callout's title": {
    note: "> [!note] ```\n> HERE\n> ```",
    code: false,
  },
  "a [!type] on a callout's second line": {
    note: "> [!note] `a\n> [!other] `HERE`",
    code: true,
  },
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
  "a backtick in brackets": {
    note: "[a`b] HERE`",
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
  "a backtick in emphasis in a callout's title": {
    note: "> [!note] *`a* HERE`",
    code: false,
    limit: readFirst,
  },
  "a span in strong emphasis": { note: "**`a HERE` b**", code: true },
  "a span into an HTML block": {
    note: "`first\n<div>\nHERE`",
    code: false,
    limit: htmlBlock,
  },
  // A quote's lines without their `>`.
  "a lazy line after a quote's heading": {
    note: "> # h\n`a\n> HERE`",
    code: true,
    limit: lazyQuote,
  },
  "a lazy line after a quote's closed fence": {
    note: "> ```\n> x\n> ```\n`a\n> HERE`",
    code: true,
    limit: lazyQuote,
  },
  "a lazy line after a quote's thematic break": {
    note: "> ***\n`a\n> HERE`",
    code: true,
    limit: lazyQuote,
  },
  "a lazy line after a quote's > alone": {
    note: "> a\n>\n`b\n> HERE`",
    code: true,
    limit: lazyQuote,
  },
  "a lazy line after a callout's > alone": {
    note: "> [!note]\n>\n`a\n> HERE`",
    code: true,
    limit: lazyQuote,
  },
  // Tabs after a marker.
  "a tab after >": { note: ">\tHERE", code: true, limit: tabIndent },
  "a tab after > and a space": {
    note: "> \tHERE",
    code: true,
    limit: tabIndent,
  },
  "a tab after > and two spaces": { note: ">  \tHERE", code: false },
  "a tab before a [!note]": {
    note: ">\t[!note] `a\n> `HERE`",
    code: true,
    limit: tabIndent,
  },
  "a tab after a bullet and a space": {
    note: "- \tHERE",
    code: true,
    limit: tabIndent,
  },
  "a tab after a bullet": { note: "-\tHERE", code: false },
};
