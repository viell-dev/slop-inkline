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
   * Whether Obsidian shows nothing at the place, as in a comment or a tag,
   * where an embed shows nothing either; `code` is then true.
   */
  readonly hidden?: true;
  /**
   * Why the check finds the other answer, where it knowingly does: what it
   * does not read.
   */
  readonly limit?: string;
}

/** Why the check lists nothing in an HTML block, where Obsidian shows text. */
const htmlWithheld =
  "the check lists nothing in an HTML block, where code cannot be told from text by its lines and an embed shows as text";
/** Why the check lists nothing in text that would take too long to read. */
const tooLong =
  "the check lists nothing in a paragraph that would take too long to read with certainty, as of a thousand brackets that nothing closes";
/** Why the check lists nothing after an open `<pre>`, where Obsidian shows text. */
const tagWithheld =
  "the check lists nothing after a <pre> or <code> tag that the note has not closed, which only a browser could tell ends";
/** Why the check lists nothing in an element's text, where Obsidian shows text. */
const rawWithheld =
  "the check lists nothing in the text of a <textarea> or another element that no tag but its own closing tag ends, where an embed shows as text";
/** Why the check closes no `<code>` in a quote deep enough to keep it open. */
const blocksWithheld =
  "the check counts two elements for each quote, as for a callout, and closes no <code> with eight or more between, where a plain quote's one would close it";
/** Why the check lists nothing after raw HTML it cannot read with certainty. */
const unsureWithheld =
  "the check lists nothing after raw HTML that Obsidian's own HTML may end or not, or that it does not read, such as a <script>, an <svg>, or a <math>";
/** Why the check lists in a math block, where Obsidian shows nothing. */
const mathListed =
  "the check lists in a $$ math block, as before, as it does not follow where Obsidian opens one: $$ before some characters starts none";
/** Why the check reads an item numbered 1 to 9 as indented more. */
const itemOne =
  "Obsidian takes a column more from the text of an item numbered 1 to 9 when its marker is an odd number of columns wide; the check does not";
/** Why the check reads a definition as a paragraph. */
const definitionLines =
  "Obsidian reads a definition whose label or title runs on to another line, or whose address comes after a blank line; the check does not";

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
    limit: htmlWithheld,
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
  },
  "a backtick in an autolink": {
    note: "<http://a.b/`> first\nHERE`",
    code: false,
  },
  "a backtick in a wiki link": {
    note: "[[a`b]] `first\nHERE`",
    code: true,
  },
  "a backtick in a comment": {
    note: "%% `first %%\nHERE`",
    code: false,
  },
  "a backtick in math": {
    note: "$`first$\nHERE`",
    code: false,
  },
  "a backtick in a link's text": {
    note: "[`first](x)\nHERE`",
    code: false,
  },
  "a backtick in a link's address": {
    note: "[x](y`) HERE`",
    code: false,
  },
  "a backtick in brackets": {
    note: "[a`b] HERE`",
    code: false,
  },
  "a backtick in emphasis": {
    note: "*`a* HERE`",
    code: false,
  },
  "a backtick in strong emphasis": {
    note: "**`a** HERE`",
    code: false,
  },
  "a backtick in strong emphasis, over lines": {
    note: "**`a\nHERE**`",
    code: false,
  },
  "a backtick in strikethrough": {
    note: "~~`a~~ HERE`",
    code: false,
  },
  "a backtick in a highlight": {
    note: "==`a== HERE`",
    code: false,
  },
  "a backtick in emphasis in a callout's title": {
    note: "> [!note] *`a* HERE`",
    code: false,
  },
  "a span in strong emphasis": { note: "**`a HERE` b**", code: true },
  "a span into an HTML block": {
    note: "`first\n<div>\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  // A quote's lines without their `>`.
  "a lazy line after a quote's heading": {
    note: "> # h\n`a\n> HERE`",
    code: true,
  },
  "a lazy line after a quote's closed fence": {
    note: "> ```\n> x\n> ```\n`a\n> HERE`",
    code: true,
  },
  "a lazy line after a quote's thematic break": {
    note: "> ***\n`a\n> HERE`",
    code: true,
  },
  "a lazy line after a quote's > alone": {
    note: "> a\n>\n`b\n> HERE`",
    code: true,
  },
  "a lazy line after a callout's > alone": {
    note: "> [!note]\n>\n`a\n> HERE`",
    code: true,
  },
  // Tabs after a marker.
  "a tab after >": { note: ">\tHERE", code: true },
  "a tab after > and a space": {
    note: "> \tHERE",
    code: true,
  },
  "a tab after > and two spaces": { note: ">  \tHERE", code: false },
  "a tab before a [!note]": {
    note: ">\t[!note] `a\n> `HERE`",
    code: true,
  },
  "a tab after a bullet and a space": {
    note: "- \tHERE",
    code: true,
  },
  "a tab after a bullet": { note: "-\tHERE", code: false },
  // Tabs after a quote's or a list item's marker, and after spaces.
  "a tab after > and three spaces": { note: ">   \tHERE", code: false },
  "two tabs after >": { note: ">\t\tHERE", code: true },
  "a tab after a nested quote's > and a space": {
    note: "> > \tHERE",
    code: true,
  },
  "a tab after a numbered item's marker and a space": {
    note: "1. \tHERE",
    code: true,
  },
  "a tab right after a numbered item's marker": {
    note: "1.\tHERE",
    code: false,
  },
  "a tab after a bullet and two spaces": { note: "-  \tHERE", code: true },
  "a tab after a bullet and four spaces": { note: "-    \tHERE", code: true },
  "a tab after a numbered item's marker and two spaces": {
    note: "1.  \tHERE",
    code: true,
  },
  "a tab after a number of two digits and a space": {
    note: "10. \tHERE",
    code: true,
  },
  "a tab after 1) and a space": { note: "1) \tHERE", code: true },
  "a tab after an item's quote's >": { note: "- >\tHERE", code: true },
  "a tab after a numbered item's quote's >": { note: "1. >\tHERE", code: true },
  "a tab after a nested quote's >": { note: "> >\tHERE", code: true },
  "a tab after an item's quote's > and a space": {
    note: "- > \tHERE",
    code: true,
  },
  "a tab after a quote's item's marker and a space": {
    note: "> - \tHERE",
    code: true,
  },
  "a tab after a quote's numbered item's marker": {
    note: "> 1. \tHERE",
    code: true,
  },
  "a tab between two >": { note: ">\t>HERE", code: true },
  "a tab between two > and a space": { note: ">\t> HERE", code: true },
  "a tab after a later > and a space": { note: "> \t> \tHERE", code: true },
  "a tab after an indented quote's >": { note: "- a\n\n  >\tHERE", code: true },
  "a tab after > in a paragraph": { note: "> a\n>\tHERE", code: false },
  "a span after indented code from a tab after >": {
    note: ">\t`a\n> HERE`",
    code: false,
  },
  "a tab alone": { note: "\tHERE", code: true },
  "a space and a tab": { note: " \tHERE", code: false },
  "two spaces and a tab": { note: "  \tHERE", code: false },
  "three spaces and a tab": { note: "   \tHERE", code: false },
  "a space and two tabs": { note: " \t\tHERE", code: false },
  "a tab and a space": { note: "\t HERE", code: true },
  "a space and a tab after a paragraph": { note: "a\n\n \tHERE", code: false },
  "two spaces and a tab after a paragraph": {
    note: "a\n\n  \tHERE",
    code: false,
  },
  "a tab and a space after a paragraph": { note: "a\n\n\t HERE", code: true },
  "a tab after a callout's type and two spaces": {
    note: "> [!note]  \tHERE",
    code: false,
  },
  "a tab after a callout's type and a space": {
    note: "> [!note] \tHERE",
    code: true,
  },
  "two tabs after a callout's type": { note: "> [!note]\t\tHERE", code: true },
  "two spaces and a tab in an item": { note: "- a\n\n  \tHERE", code: true },
  "a tab in an item": { note: "- a\n\n\tHERE", code: false },
  "a space and a tab in an item": { note: "- a\n\n \tHERE", code: false },
  "two tabs in an item": { note: "- a\n\n\t\tHERE", code: true },
  "a tab and two spaces in an item": { note: "- a\n\n\t  HERE", code: false },
  "three spaces and a tab in an item": {
    note: "- a\n\n   \tHERE",
    code: false,
  },
  "a tab and four spaces in an item": { note: "- a\n\n\t    HERE", code: true },
  "a tab in a numbered item": { note: "1. a\n\n\tHERE", code: false },
  "two tabs in a numbered item": { note: "1. a\n\n\t\tHERE", code: true },
  "seven spaces in an item at 10": {
    note: "10. a\n\n       HERE",
    code: false,
  },
  "eight spaces in an item at 10": {
    note: "10. a\n\n        HERE",
    code: true,
  },
  "seven spaces in an item at 1)": { note: "1) a\n\n       HERE", code: true },
  "eight spaces in an indented item at 1": {
    note: " 1. a\n\n        HERE",
    code: true,
  },
  "seven spaces in an item at 1 with a line at three": {
    note: "1. a\n   b\n\n       HERE",
    code: true,
  },
  "four spaces in an item at 1": { note: "1. a\n\n    HERE", code: false },
  "eight spaces in an item at 1 and two spaces": {
    note: "1.  a\n\n        HERE",
    code: true,
  },
  "a tab after a quote's paragraph": { note: "> a\n\tHERE", code: true },
  "a space and a tab after a quote's paragraph": {
    note: "> a\n \tHERE",
    code: false,
  },
  "a span over a space and a tab after a quote": {
    note: "> `a\n \tHERE`",
    code: true,
  },
  "a span to a tab after a quote": { note: "> `a\n\tHERE`", code: true },
  "a tab before >": { note: "\t> HERE", code: true },
  "a space and a tab before >": { note: " \t> HERE", code: false },
  "a span after two spaces and a tab before >": {
    note: "  \t> `a\n> HERE`",
    code: true,
  },
  "a span over a quote's line indented four": {
    note: "> a\n    > `b\n> HERE`",
    code: true,
  },
  "a quote's fence over a line indented four": {
    note: "> ```\n    > b\nHERE",
    code: true,
  },
  "a quote's fence over a line indented by a tab": {
    note: "> ```\n\t> b\nHERE",
    code: true,
  },
  "a quote's fence over a line indented five": {
    note: "> ```\n     > HERE",
    code: true,
  },
  "a span in an item after a tab": { note: "-\t`a\n\tHERE`", code: true },
  "a span in a nested item after tabs": {
    note: "- a\n\t- `b\n\t  HERE`",
    code: true,
  },
  "a tab-indented list": { note: "\t- a\n\n\t\tHERE", code: true },
  "a space and a tab in an item's fence": {
    note: "- ```\n \tHERE",
    code: true,
  },
  "a tab in a quote's fence": { note: "> ```\n>\tHERE", code: true },
  "a space and a tab in a quote's fence": {
    note: "> ```\n> \tHERE",
    code: true,
  },
  "a fence after a tab, after a paragraph": {
    note: "a\n\t```\nHERE",
    code: false,
  },
  "a fence after a space and a tab, after a paragraph": {
    note: "a\n \t```\nHERE",
    code: false,
  },
  "a fence after a space and a tab": { note: " \t```\nHERE", code: true },
  "a fence after two spaces and a tab": { note: "  \t```\nHERE", code: true },
  "a fence closed after a space and a tab": {
    note: "```\nx\n \t```\nHERE",
    code: true,
  },
  "a fence closed after a tab": { note: "```\nx\n\t```\nHERE", code: true },
  "an item's fence after a tab": { note: "- a\n\n\t```\n\tHERE", code: true },
  "a fence after a bullet and a tab": { note: "-\t```\n\tHERE", code: true },
  // A quote's lines without their `>`, after any block in it.
  "a lazy line after a quote's heading, then blank": {
    note: "> # h\n\n`a\n> HERE`",
    code: false,
  },
  "a lazy line after a callout's > alone, with a space": {
    note: "> a\n> \n`b\n> HERE`",
    code: true,
  },
  "a lazy line after a quote's table": {
    note: "> | a |\n> | - |\n`b\n> HERE`",
    code: true,
  },
  "a lazy line with a pipe after a quote's table": {
    note: "> | a |\n> | - |\n| `b\n> HERE` |",
    code: true,
  },
  "a lazy line after a quote's item": {
    note: "> - a\n`b\n> HERE`",
    code: true,
  },
  "a heading after a quote's heading": {
    note: "> # h\n# x\n> HERE",
    code: false,
  },
  "an indented line after a quote's heading": {
    note: "> # h\n    `a\n> HERE`",
    code: false,
  },
  "a bullet after a quote's heading": {
    note: "> # h\n- `a\n> HERE`",
    code: false,
  },
  "a list at 2 after a quote's heading": {
    note: "> # h\n2. `a\n> HERE`",
    code: true,
  },
  "a list at 1 after a quote's heading": {
    note: "> # h\n1. `a\n> HERE`",
    code: false,
  },
  "HTML after a quote's heading": {
    note: "> # h\n<div>\n> HERE",
    code: false,
    limit: htmlWithheld,
  },
  "a fence after a quote's heading": { note: "> # h\n```\n> HERE", code: true },
  "a lazy line after a quote's heading, then a nested quote": {
    note: "> # h\n`a\n> > HERE`",
    code: false,
  },
  "a lazy line after a nested quote's heading": {
    note: "> > # h\n`a\n> > HERE`",
    code: true,
  },
  "a lazy line after a nested quote's heading, then the outer": {
    note: "> > # h\n`a\n> HERE`",
    code: true,
  },
  "two lazy lines after a quote's heading": {
    note: "> # h\n`a\nHERE`",
    code: true,
  },
  "a lazy line, then a span, after a quote's heading": {
    note: "> # h\nb\n> `c\n> HERE`",
    code: true,
  },
  "a heading's underline after a quote's heading": {
    note: "> # h\nb\n===\n> HERE",
    code: false,
  },
  "*** after a quote's heading": { note: "> # h\n***\n> HERE", code: false },
  "a fence after a quote's closed fence": {
    note: "> ```\n> x\n> ```\n```\n> HERE",
    code: true,
  },
  "a lazy line after a quote's thematic break, then blank": {
    note: "> ***\n`a\n\n> HERE`",
    code: false,
  },
  "a lazy line under a quote's text and an underline": {
    note: "> | ~~~a\n``` e `f` ***\n===\nb HERE `\n1.~~~# he `f`",
    code: false,
  },
  "a lazy line in a quote's strikethrough": {
    note: "> | ~~~a\n``` e `f` ***\nb HERE `\n1.~~~#",
    code: true,
  },
  // Lines without a list item's indentation, after any block in it.
  "a lazy line after an item's heading": {
    note: "- # h\n`a\n  HERE`",
    code: true,
  },
  "a lazy line after an item's heading, then the next": {
    note: "- # h\n`a\n- HERE`",
    code: false,
  },
  "a lazy line after an item's closed fence": {
    note: "- ```\n  x\n  ```\n`a\n  HERE`",
    code: true,
  },
  "a lazy line after an item's thematic break": {
    note: "- ***\n`a\n  HERE`",
    code: true,
  },
  "a lazy line after an item's thematic break under text": {
    note: "- a\n  ***\n`b\n  HERE`",
    code: true,
  },
  "two lazy lines after an item's heading": {
    note: "- # h\n`a\nHERE`",
    code: true,
  },
  "a quote after an item's heading": {
    note: "- # h\n> `a\n  HERE`",
    code: true,
  },
  "a blank line after an item's heading": {
    note: "- # h\n\n`a\n  HERE`",
    code: true,
  },
  "a heading after an item's heading": {
    note: "- # h\n# `a\n  HERE`",
    code: false,
  },
  "a lazy line after an item's later heading": {
    note: "- a\n  # h\n`b\n  HERE`",
    code: true,
  },
  "a lazy line after an item's heading after a blank": {
    note: "- a\n\n  # h\n`b\n  HERE`",
    code: true,
  },
  "a lazy line after an item's quote's > alone": {
    note: "- > a\n  >\n`b\n  HERE`",
    code: true,
  },
  "a lazy line after an item's table": {
    note: "- | a |\n  | - |\n`b\n  HERE`",
    code: true,
  },
  "a lazy line after a numbered item's heading": {
    note: "1. # h\n`a\n   HERE`",
    code: true,
  },
  "an indented line after an item's heading": {
    note: "- # h\n    `a\n  HERE`",
    code: true,
  },
  "HTML after an item's heading": {
    note: "- # h\n<div>\n  HERE",
    code: false,
    limit: htmlWithheld,
  },
  "a lazy line after an empty item": { note: "-\n`a\n  HERE`", code: true },
  "a lazy line and indented text after an empty item": {
    note: "-\na\n\n    HERE",
    code: false,
  },
  "a lazy line and a line at two after an empty item": {
    note: "-\na\n\n  HERE",
    code: false,
  },
  "a fence a space in, after an empty item, then an item": {
    note: "-\n ~~~\n- HERE",
    code: false,
  },
  "a fence a space in, after an empty item": {
    note: "-\n ~~~\n HERE",
    code: true,
  },
  "a fence two spaces in, after an empty item, then an item": {
    note: "-\n  ~~~\n- HERE",
    code: false,
  },
  "a fence a space in, after an empty item at 1": {
    note: "1.\n ~~~\n2. HERE",
    code: true,
  },
  "a fence two spaces in, after an empty item at 1": {
    note: "1.\n  ~~~\n  HERE",
    code: true,
  },
  "a span a space in, after an empty item": {
    note: "-\n `a\n HERE`",
    code: true,
  },
  "a span after an empty item": { note: "-\n`a\nHERE`", code: true },
  "a span after an empty item and a blank line": {
    note: "-\n\n`a\nHERE`",
    code: true,
  },
  "a fence after an empty item with a space": {
    note: "- \n ~~~\n HERE",
    code: true,
  },
  "a fence after an empty *": { note: "*\n ```\n HERE", code: true },
  "text a space in, then indented text, after an empty item": {
    note: "-\n a\n\n    HERE",
    code: false,
  },
  "text a space in, then five spaces, after an empty item": {
    note: "-\n a\n\n     HERE",
    code: true,
  },
  "a fence in a quote's item, then a list at 2": {
    note: "> - ~~~\n2. HERE",
    code: false,
  },
  "a span in a quote's item, then a list at 2": {
    note: "> - `a\n2. HERE`",
    code: false,
  },
  "a fence in a quote's item, then a *": {
    note: "> - ~~~\n* HERE",
    code: false,
  },
  "a fence in a quote's item, then a lazy line": {
    note: "> - ~~~\nb\n> HERE",
    code: true,
  },
  "a fence in an item's quote, then a list at 2": {
    note: "- > ~~~\n2. HERE",
    code: false,
  },
  "a span in a quote's second item": {
    note: "> - a\n- `b\n> HERE`",
    code: false,
  },
  "a fence in a quote's item at 1, then a list at 2": {
    note: "> 1. ~~~\n2. HERE",
    code: false,
  },
  "a fence in a quote's item, then the next": {
    note: "> - ~~~\n- HERE",
    code: false,
  },
  "a fence in a nested quote, then a lazy line": {
    note: "> > ~~~\nb\n> HERE",
    code: true,
  },
  "a fence in a quote's item, then a heading": {
    note: "> - ```\n# HERE",
    code: false,
  },
  "a fence in an item's quote, then lazy lines": {
    note: "- > ```\nb\nHERE",
    code: true,
  },
  "a span from a lazy line after an item's quote": {
    note: "- > a\n`b\nHERE`",
    code: true,
  },
  "a span from a lazy line after an item's quote's heading": {
    note: "- > # h\n`b\n  > HERE`",
    code: true,
  },
  "a span from a lazy line after a quote's item's heading": {
    note: "> - # h\n`b\n> HERE`",
    code: true,
  },
  "a span from a lazy line to a quote's item's text": {
    note: "> - # h\n`b\n>   HERE`",
    code: true,
  },
  "a span over a quote's line under an item's quote": {
    note: "- a\n  > b\n`c\n  > HERE`",
    code: true,
  },
  "a span after a quote's item and a blank line": {
    note: "> - a\n>\n> `b\nHERE`",
    code: true,
  },
  "an item's fence over two blank lines, then indented": {
    note: "- ```\n\n\n  HERE",
    code: true,
  },
  "a fence in an empty second item": {
    note: "- a\n- \n  ```\n  HERE",
    code: true,
  },
  "a span in a list of another bullet": {
    note: "* a\n- `b\n  HERE`",
    code: true,
  },
  "a span in a list of another number's mark": {
    note: "1. a\n1) `b\n   HERE`",
    code: true,
  },
  "a sibling item after a tab": {
    note: " \t  -\n\t- | HERE ` - |\n",
    code: false,
  },
  "a list of another bullet after a tab": {
    note: "- a\n\t* `HERE`",
    code: true,
  },
  "a thematic break after a tab in an item": {
    note: "- a\n\t- - -\nHERE",
    code: false,
  },
  "a list at 2 after a tab in an item": {
    note: "1. a\n\t2. `b\n   HERE`",
    code: true,
  },
  "a nested item after a tab": { note: "-   a\n\t- `b\n  HERE`", code: true },
  "text a space in, then five spaces, in an item": {
    note: "- a\n b\n\n     HERE",
    code: true,
  },
  "text a space in, then four spaces, in an item": {
    note: "- a\n b\n\n    HERE",
    code: false,
  },
  "what starts as a marker in an item's fence": {
    note: "- ```\n\t- `` \n-|\n\n1.aHERE`",
    code: true,
  },
  "what starts as a marker in an item's fence, unblank": {
    note: "- ```\n\t- x\n-|\n`a\nHERE`",
    code: true,
  },
  "a bullet alone in an item's fence": {
    note: "- ```\n\t-\n-|\n\nHERE",
    code: false,
  },
  "what starts as a marker in a nested item": {
    note: "- a\n\t- b\n-|\n\n`a\nHERE`",
    code: true,
  },
  "an indented lazy line, then a quote, in an item": {
    note: "* a\n* b\n    `x\n> HERE`",
    code: false,
  },
  "indented code after a task's marker": {
    note: "* [a] \t$$ x HERE",
    code: true,
  },
  "a comment after a lazy line in an item": {
    note: "* a \t$$ x\n    %% `x %%\nHERE`",
    code: false,
  },
  "HTML after a task's marker": {
    note: "2. [a] </pre>g`HERE`",
    code: false,
    limit: htmlWithheld,
  },
  // What Obsidian reads before a code span.
  "a backtick in a wiki link, then text": {
    note: "[[a`b]] HERE`",
    code: false,
  },
  "a backtick in a wiki link after a space": {
    note: "x [[a `b]] HERE`",
    code: false,
  },
  "a backtick in an embed": { note: "![[a`b]] `HERE`", code: true },
  "a wiki link over two lines": { note: "[[a`b\n]] HERE`", code: false },
  "a wiki link in a wiki link's text": {
    note: "[[a [[b`]] `HERE`",
    code: true,
  },
  "a backtick in a wiki link's alias": { note: "[[a|b`c]] HERE`", code: false },
  "a span over a wiki link's start": { note: "`a [[b` HERE]]", code: false },
  "a backtick at a wiki link's end": { note: "[[a`]]` HERE`", code: true },
  "a wiki link of a backtick": { note: "[[`]] `HERE`", code: true },
  "a span after a wiki link": { note: "[[a]]`HERE`", code: true },
  "a wiki link's text from a space and a backtick": {
    note: "[[ `a]] HERE`",
    code: false,
  },
  "an empty wiki link": { note: "[[]]` HERE`", code: true },
  "a wiki link and a ]": { note: "[[a]]]`HERE`", code: true },
  "a wiki link of a [": { note: "[[[a`]] HERE`", code: false },
  "a backtick in an embed, then text": { note: "![[a`b]] HERE`", code: false },
  "a backtick in a comment, then a span": { note: "%%`%% `HERE`", code: true },
  "a backtick in a comment after text": {
    note: "a %%b`c%% HERE`",
    code: false,
  },
  "a comment block over two lines": { note: "%%a\nb`%% HERE`", code: false },
  "a comment over two lines": { note: "a %%`\nb%% HERE`", code: true },
  "a comment, then %%": { note: "%%`%%%% `HERE`", code: true },
  "a % in what is not a comment": { note: "%% ` % HERE`", code: true },
  "a span after a comment": { note: "a %% `b %% HERE `c`", code: false },
  "a comment after %": { note: "%%%`%% HERE`", code: false },
  "a backtick in math, then text": { note: "$`a$ HERE`", code: false },
  "a backtick in display math": { note: "$$`a$$ HERE`", code: false },
  "a $ before a space": { note: "$ `a$ HERE`", code: true },
  "a $ after a space": { note: "$`a $ HERE`", code: true },
  "a $ before a digit": { note: "$`a$1 HERE`", code: true },
  "an escaped $": { note: "\\$`a$ HERE`", code: true },
  "math over two lines": { note: "$`a\nb$ HERE`", code: false },
  "a backtick in a link's title": { note: '[x](y "`") HERE`', code: false },
  "a backtick in a link's address in <>": {
    note: "[x](<y`>) HERE`",
    code: false,
  },
  "a link's address with a space": { note: "[x](y `z) HERE`", code: true },
  "a backtick in a link's text, then text": {
    note: "[a`b](c) HERE`",
    code: false,
  },
  "a backtick in an image's text": { note: "![a`b](c) HERE`", code: false },
  "a link's address over two lines": { note: "[x](y`\nz) HERE`", code: true },
  "a backtick in a reference's text": { note: "[a`b][c] HERE`", code: false },
  "a backtick in a collapsed reference's text": {
    note: "[a`b][] HERE`",
    code: false,
  },
  "a backtick in brackets after [": { note: "[a [b`] HERE`", code: false },
  "a backtick in a footnote's label": { note: "[^a`b] HERE`", code: false },
  "a backtick in a footnote that a span leaves open": {
    note: "^[a`b] HERE`",
    code: false,
  },
  "a backtick in brackets over two lines": {
    note: "[a\nb`] HERE`",
    code: false,
  },
  "an escaped bracket": { note: "\\[a`b] HERE`", code: true },
  "a span after brackets": { note: "[a]`b` HERE", code: false },
  "a span after brackets and a space": { note: "[a] `b HERE`", code: true },
  "a backtick in brackets, then a span": { note: "[`a] HERE `b`", code: false },
  "a backtick in a reference's label": { note: "[c][a`b] HERE`", code: false },
  "a backtick in brackets, then a line": { note: "[a`b]\nHERE`", code: false },
  "a span in brackets": { note: "[a `b`] HERE", code: false },
  "a span from brackets": { note: "[a `b] c` HERE", code: false },
  "a backtick in emphasis by _": { note: "_`a_ HERE`", code: false },
  "a backtick in strong emphasis by _": { note: "__`a__ HERE`", code: false },
  "emphasis to the next *": { note: "*`a *b* HERE`", code: false },
  "emphasis from a * and a space": { note: "x * `a* HERE`", code: false },
  "strikethrough from ~~ and a space": { note: "~~ `a~~ HERE`", code: true },
  "strikethrough to a space and ~~": { note: "~~`a ~~ HERE`", code: true },
  "a highlight from == and a space": { note: "== `a== HERE`", code: true },
  "a highlight of ===": { note: "===`a=== HERE`", code: false },
  "emphasis to **": { note: "*`a** HERE`", code: true },
  "emphasis over two lines": { note: "*`a\nb* HERE`", code: false },
  "emphasis by _ in a word": { note: "a_`b_ HERE`", code: false },
  "_ before a letter": { note: "x_`a_b HERE`", code: true },
  "a span from emphasis": { note: "*a `b* c` HERE", code: false },
  "emphasis from a span": { note: "`a *b` HERE*", code: false },
  "strong emphasis before a letter": { note: "**`a**b HERE`", code: false },
  "strikethrough over two lines": { note: "~~`a\nb~~ HERE`", code: false },
  "a highlight over two lines": { note: "==`a\nb== HERE`", code: false },
  "emphasis from a backtick and a space": { note: "*` a* HERE`", code: false },
  "strong emphasis in emphasis": { note: "***`a*** HERE`", code: false },
  "emphasis in strong emphasis": { note: "**a *`b* c** HERE`", code: false },
  "a single ~": { note: "~`a~ HERE`", code: true },
  "a backtick in a link's attribute": {
    note: '<a href="`">x</a> HERE`',
    code: false,
  },
  "a span after a tag": { note: "<br/>`HERE`", code: true },
  "a tag that does not close": { note: "<span `a> HERE`", code: true },
  "< and a backtick": { note: "x <`a> HERE`", code: true },
  "a span after a tag that opens text": { note: "<b>`a</b> HERE`", code: true },
  "a backtick in an email autolink": { note: "<a@b.c`> HERE`", code: false },
  "an autolink with a space": { note: "<http://a.b/ `> HERE`", code: true },
  "a backtick in an address": { note: "http://a.b/`c HERE`", code: false },
  "a backtick in a www. address": { note: "www.a.b/`c HERE`", code: false },
  "a span after an address": { note: "https://a.b `HERE`", code: true },
  "an address in a word": { note: "xhttp://a.b/`c HERE`", code: false },
  "an address in capitals": { note: "HTTP://a.b/`c HERE`", code: false },
  "a www. address after a space": { note: "x www.a.b/`c HERE`", code: false },
  "an address with no dot": { note: "http://a/`c HERE`", code: true },
  "a span after an email address": { note: "a@b.c`d HERE`", code: true },
  "a span after a tag's name": { note: "#a`b HERE`", code: true },
  "a span after a tag's name after a space": {
    note: "x #a`b HERE`",
    code: true,
  },
  "a span after an escaped backslash": { note: "a \\\\`b` HERE", code: false },
  "a backtick in a wiki link in a callout's title": {
    note: "> [!note] [[a`b]] HERE`",
    code: false,
  },
  "a backtick in a wiki link in a header": {
    note: "| [[a`b]] | HERE` |\n| - | - |",
    code: false,
  },
  "a backtick in a wiki link in a cell": {
    note: "| a | b |\n| - | - |\n| [[`]] | `HERE` |",
    code: true,
  },
  "a backtick in a wiki link in a heading": {
    note: "# [[a`b]] HERE`",
    code: false,
  },
  "a backtick in a wiki link in an item": {
    note: "- [[a`b]] `c\n  HERE`",
    code: true,
  },
  // Link reference definitions.
  "a backtick in a definition in a quote": {
    note: "> [x]: `a\n> `HERE`",
    code: true,
  },
  "a backtick in a definition in an item": {
    note: "- [x]: `a\n  `HERE`",
    code: true,
  },
  "a backtick in a definition, then text": {
    note: "[x]: `a\nHERE`",
    code: false,
  },
  "a backtick in a definition of [!note]": {
    note: "[!note]: `a\nHERE`",
    code: false,
  },
  "a backtick in a definition of [!note] in a quote": {
    note: "> [!note]: `a\n> `HERE`",
    code: true,
  },
  "a definition, then a span": { note: "[x]: y\n`HERE`", code: true },
  "a definition's address and more": { note: "[x]: y `a\nHERE`", code: true },
  "a backtick in a definition's address in <>": {
    note: "[x]: <`a>\n`HERE`",
    code: true,
  },
  "a definition indented 3": { note: "   [x]: `a\n`HERE`", code: true },
  "a definition indented 4": { note: "    [x]: `a\n`HERE`", code: true },
  "a definition's title on its next line": {
    note: '[x]: y\n"`a"\n`HERE`',
    code: true,
  },
  "a definition under a paragraph": { note: "a\n[x]: `b\nHERE`", code: true },
  "a backtick in a definition's title": {
    note: '[x]: y "`a"\n`HERE`',
    code: true,
  },
  "a backtick in a definition's title in '": {
    note: "[x]: y '`a'\n`HERE`",
    code: true,
  },
  "a backtick in a definition's title in ()": {
    note: "[x]: y (`a)\n`HERE`",
    code: true,
  },
  "two definitions": { note: "[x]: `a\n[y]: `b\n`HERE`", code: true },
  "a definition's address and a backtick": {
    note: "[x]: y z`\nHERE`",
    code: true,
  },
  "a definition without a space": { note: "[x]:`a\n`HERE`", code: true },
  "a label, a space and a colon": { note: "[x] : `a\n`HERE`", code: false },
  "an empty label": { note: "[]: `a\n`HERE`", code: false },
  "a definition of a span": { note: "[x]: `a`\nHERE", code: false },
  "a definition's address in an unclosed <": {
    note: "[x]: <a`\n`HERE`",
    code: false,
  },
  "a definition after a heading": { note: "# h\n[x]: `a\n`HERE`", code: true },
  "a definition, a blank line, and a span": {
    note: "[x]: `a\n\n`HERE`",
    code: true,
  },
  "a definition after a tab": { note: "\t[x]: `a\n`HERE`", code: true },
  "a definition under a quote's line": {
    note: "> a\n> [x]: `b\n> HERE`",
    code: true,
  },
  "a definition's address of [": { note: "[x]: [`a\nHERE`", code: true },
  "a definition's address and ]": { note: "[x]: `a]\nHERE`", code: true },
  "a definition's title and a backtick": {
    note: '[x]: y "a" `\nHERE`',
    code: true,
  },
  "a definition's address on its next line": {
    note: "[x]:\n<`a>\n`HERE`",
    code: true,
  },
  "a definition's address and title on its next line": {
    note: '[x]:\n`a "t"\n`HERE`',
    code: true,
  },
  "a label, then two words": { note: "[x]:\nb c\n`HERE`", code: true },
  "a definition's title in its own line": {
    note: '[x]: y\n"t"\n`HERE`',
    code: true,
  },
  "a definition's title and a word": {
    note: '[x]: y\n"t" z\n`HERE`',
    code: true,
  },
  "a definition's title that does not close": {
    note: "[x]: y\n'`a\nHERE`",
    code: true,
  },
  "a definition over an underline": {
    note: "[x]: `a\n===\n`HERE`",
    code: true,
  },
  // HTML blocks.
  "a span in an HTML block": {
    note: "<div>\n`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a span after an HTML block and a blank line": {
    note: "<div>\n\n`a\nHERE`",
    code: true,
  },
  "an HTML block over a line of spaces": {
    note: "<div>\n   \n`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "an HTML block over a line with a tab": {
    note: "<div>\n\t\n`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "an HTML block of a tag alone": {
    note: "<span>\n`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a tag and text": { note: "<span> x\n`a\nHERE`", code: true },
  "a tag alone under a paragraph": { note: "a\n<span>\n`b\nHERE`", code: true },
  "a span after an HTML comment": { note: "<!--\n`a\n-->\nHERE`", code: false },
  "a span in a <pre> block": {
    note: "<pre>\n`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a span after a <pre> block": {
    note: "<pre>\n`a\n</pre>\n`HERE`",
    code: true,
  },
  "a fence in an HTML block": {
    note: "<div>\n```\nHERE",
    code: false,
    limit: htmlWithheld,
  },
  "an HTML block indented 2": {
    note: "  <div>\n`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "an HTML block indented 4": { note: "    <div>\n`a\nHERE`", code: true },
  "an HTML block in a quote": {
    note: "> <div>\n> `a\n> HERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a closing tag's HTML block": {
    note: "</div>\n`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "an HTML block in capitals": {
    note: "<DIV>\n`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a span on an HTML block's line": {
    note: "<div>`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a span after a space on an HTML block's line": {
    note: "<div> `a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "an HTML block of an unknown tag": {
    note: "<divx>\n`a\nHERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a style block, then text": {
    note: "<style>\n`b\nHERE`\n</style>\nHERE",
    code: false,
    limit: htmlWithheld,
  },
  "an HTML block in an item": {
    note: "- <div>\n  `a\n  HERE`",
    code: false,
    limit: htmlWithheld,
  },
  "an HTML block after a quote": {
    note: "> a\n<div>\n> `b\n> HERE`",
    code: false,
    limit: htmlWithheld,
  },
  "an HTML block under an item": {
    note: "- a\n<div>\n`b\n  HERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a quote in an HTML block": {
    note: "<div>\n> `a\n> HERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a tag alone in a span": { note: "`a\n<span>\nHERE`", code: true },
  "an HTML block of a link": {
    note: '<a href="x">\n`b\nHERE`',
    code: false,
    limit: htmlWithheld,
  },
  "a heading in an HTML block": {
    note: "<div>\n# `a\n`HERE`",
    code: false,
    limit: htmlWithheld,
  },
  "a span after a table's HTML block": {
    note: "<table>\n\n`a\nHERE`",
    code: true,
  },
  "a blank line after an HTML block's line": {
    note: "<div>\n`a\n\nHERE`",
    code: false,
  },
  "an HTML block under an item, after a blank": {
    note: "- a\n<div>\n\n  `b\n  HERE`",
    code: true,
  },
  "a tag alone in a quote": { note: "> a\n<span>\n> `b\n> HERE`", code: true },
  // Comments and math in blocks, headings by underline, and tables.
  "a comment block over a fence": {
    note: "%%\n```\n%%\n`a\nHERE`",
    code: true,
  },
  "a span after a comment block on its line": {
    note: "%%x\n`a\n%% `HERE`",
    code: true,
  },
  "a comment block in a quote": { note: "> %%\n> `a\n\n`HERE`", code: true },
  "a comment block after a paragraph": {
    note: "a\n%%\n```\n%%\n`HERE`",
    code: true,
  },
  "a span after a math block": { note: "$$\n`a\n$$\n`HERE`", code: true },
  "a span after a math block of a line": {
    note: "$$x\n`a\nb $$\n`HERE`",
    code: true,
  },
  "a fence in a math block": { note: "$$\n```\n$$\nHERE", code: false },
  "a fence in a math block after a paragraph": {
    note: "a\n$$\n```\n$$\nHERE",
    code: false,
  },
  "a span after a heading by =": { note: "`a\n===\nb` HERE`", code: true },
  "a span after a heading by -": { note: "`a\n---\nb` HERE`", code: true },
  "a span after a quote's heading by =": {
    note: "> `a\n> ===\n> b` HERE`",
    code: true,
  },
  "a span after an item's heading by =": {
    note: "- `a\n  ===\n  b` HERE`",
    code: true,
  },
  "an indented =": { note: "`a\n ===\nb` HERE`", code: false },
  "= and a space": { note: "`a\n=== \nb` HERE`", code: false },
  "a heading by a -": { note: "`a\n-\nb` HERE`", code: true },
  "= under a paragraph's second line": {
    note: "x\n`a\n===\nb` HERE`",
    code: false,
  },
  "a heading by = under a tag": {
    note: "<div>\n===\nHERE",
    code: false,
    limit: htmlWithheld,
  },
  "a quote's heading by =": { note: "> a\n===\nb `HERE`", code: true },
  "a table, then a line without |": {
    note: "| a |\n| - |\n| b |\n`c\nHERE`",
    code: true,
  },
  "a table, then a span": { note: "| a |\n| - |\n`b\nHERE`", code: true },
  "a table without outer pipes, then a paragraph": {
    note: "a | b\n- | -\nc\n`d\nHERE`",
    code: true,
  },
  "a table, then a line with | first only": {
    note: "| a |\n| - |\n| b\n`c\nHERE`",
    code: true,
  },
  "a delimiter row with outer pipes under a header without": {
    note: "a | b\n| - | - |\n`c | HERE`",
    code: true,
  },
  "a header after a space": {
    note: " | a |\n| - |\n| `b | HERE` |",
    code: true,
  },
  "a heading with | in a table": {
    note: "| a |\n| - |\n# x | `HERE` |",
    code: true,
  },
  "a delimiter row with | first only": {
    note: "| a |\n|---\n| `b | HERE` |",
    code: true,
  },
  "a delimiter row with an empty cell": {
    note: "| a |\n| - || - |\n| `b | HERE` |",
    code: true,
  },
  "a table, then a line indented 4": {
    note: "| a |\n| - |\n    | `b | HERE` |",
    code: true,
  },
  "a table without outer pipes, then a row with them": {
    note: "a | b\n- | -\n| `c | HERE` |",
    code: true,
  },
  "a table, then a line indented by a tab": {
    note: "| a |\n| - |\n\t| `b | HERE` |",
    code: true,
  },
  // Items numbered 1 to 9, and what lines further on change.
  "three spaces and a tab in a numbered item": {
    note: "1. a\n\n   \tHERE",
    code: false,
    limit: itemOne,
  },
  "seven spaces in a numbered item": {
    note: "1. a\n\n       HERE",
    code: false,
    limit: itemOne,
  },
  "seven spaces in an item at 2": {
    note: "2. a\n\n       HERE",
    code: false,
    limit: itemOne,
  },
  "nine spaces in an indented item at 1": {
    note: "  1. a\n\n         HERE",
    code: false,
    limit: itemOne,
  },
  "seven spaces in an item at 9": {
    note: "9. a\n\n       HERE",
    code: false,
    limit: itemOne,
  },
  "a line indented less after indented code in an item": {
    note: "- a\n\n     HERE\n b",
    code: true,
  },
  "a definition's title over two lines": {
    note: '[x]: y "`a\nb"\n`HERE`',
    code: true,
  },
  "a definition's label over two lines": {
    note: "[x\ny]: `a\n`HERE`",
    code: true,
  },
  "a definition's label over two lines, then text": {
    note: "[x\n[^1]: `\nb HERE`",
    code: false,
    limit: definitionLines,
  },
  "a definition's address after a blank line": {
    note: "[x]:\n\n`a\nHERE`",
    code: false,
    limit: definitionLines,
  },
  // Code in HTML, which the check lists nothing in, as in any HTML block.
  "a span in HTML's code": {
    note: "<pre><code>`HERE`</code></pre>",
    code: true,
  },
  "a span in HTML's code under a heading": {
    note: "# h\n<pre><code>`HERE`</code></pre>",
    code: true,
  },
  "a span in HTML's code in a quote": {
    note: "> <pre><code>`HERE`</code></pre>",
    code: true,
  },
  "a span in HTML's code in a callout": {
    note: "> [!note]\n> <pre><code>`HERE`</code></pre>",
    code: true,
  },
  "a span in HTML's code in an item": {
    note: "- <pre><code>`HERE`</code></pre>",
    code: true,
  },
  "a span in HTML's code in a numbered item": {
    note: "1. <pre><code>`HERE`</code></pre>",
    code: true,
  },
  "a span in HTML's code in a task": {
    note: "- [ ] <pre><code>`HERE`</code></pre>",
    code: true,
  },
  "HTML's code without backticks": {
    note: "<pre><code>HERE</code></pre>",
    code: true,
  },
  "HTML's code over lines": {
    note: "<pre><code>\na\nHERE\n</code></pre>",
    code: true,
  },
  "text in an HTML block": {
    note: "<div>\nsample HERE\n</div>",
    code: false,
    limit: htmlWithheld,
  },
  "text after an HTML block": {
    note: "<div>\nsample\n</div>\n\nHERE",
    code: false,
  },
  // A `<code>` tag in a paragraph makes code to its `</code>`.
  "text in a <code> tag": {
    note: "Some <code>inline HERE</code> text.",
    code: true,
  },
  "text after a <code> tag": {
    note: "Some <code>inline</code> HERE text.",
    code: false,
  },
  "text in a <code> tag with an attribute": {
    note: 'Some <code class="x">HERE</code>.',
    code: true,
  },
  "text in a <code> tag over lines": {
    note: "Some <code>inline\nHERE</code> text.",
    code: true,
  },
  "text in a <code> tag that does not close": {
    note: "Some <code>inline HERE text.",
    code: true,
  },
  "strong text in a <code> tag": {
    note: "Some <code>a **HERE** b</code>.",
    code: true,
  },
  "a <code> tag in strong text": {
    note: "Some **<code>HERE</code>** text.",
    code: true,
  },
  "a <code> tag in strong text, then text": {
    note: "Some **a <code>b** HERE</code> c.",
    code: true,
  },
  "text in a <kbd> tag": { note: "Some <kbd>HERE</kbd> text.", code: false },
  "text in a <b> tag": { note: "Some <b>bold</b> HERE text.", code: false },
  "a <code> tag in a cell": {
    note: "| a | b |\n| - | - |\n| <code>HERE</code> | c |",
    code: true,
  },
  "a <code> tag in a heading": { note: "# A <code>HERE</code>", code: true },
  // Inline HTML of any length.
  "a backtick in a long attribute": {
    note: 'Text <span title="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`">value</span> and `HERE`.',
    code: true,
  },
  "a backtick after a long attribute": {
    note: 'Text <span title="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">value</span> and `HERE`.',
    code: true,
  },
  "a long attribute that does not close": {
    note: 'Text <span title="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` and `HERE`.',
    code: false,
  },
  // Text too long to read in time, which the check lists nothing in.
  "a span after a thousand brackets and a wiki link": {
    note: "[a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a See [[odd`name]] and `HERE`.",
    code: true,
  },
  "text after a thousand brackets": {
    note: "[a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a [a See HERE.",
    code: false,
    limit: tooLong,
  },
  // Definitions over lines, and an item's later lines.
  "a definition's title over two lines, then text": {
    note: '[x]: y "a\nb"\nHERE',
    code: false,
  },
  "a definition's title that opens, then text": {
    note: "[x]: y\n'a\nHERE",
    code: false,
  },
  "a line indented less after text in an item": {
    note: "- a\n\n     HERE\n  b",
    code: false,
  },
  "a line indented less after two blank lines in an item": {
    note: "- a\n\n     HERE\n\n b",
    code: false,
  },
  "a line indented less after an item's paragraph": {
    note: "- a\n\n     b\n     HERE\n b",
    code: true,
  },
  "a line indented less after a heading in an item": {
    note: "- a\n\n     # HERE\n b",
    code: true,
  },
  "a line indented less in a numbered item": {
    note: "1. a\n\n      HERE\n  b",
    code: true,
  },
  "a later item after indented text": {
    note: "- a\n\n     HERE\n- b",
    code: false,
  },
  // An open `<code>` or `<pre>` holds the list closed until it closes, over blank lines and blocks.
  "text over blank lines in an open <code>": {
    note: "<code>\n\nHERE\n\n</code>",
    code: true,
  },
  "text over blank lines in a paragraph's open <code>": {
    note: "Some <code>a\n\nHERE\n\n</code>",
    code: true,
  },
  "text after <code/>": { note: "Some <code/>HERE", code: true },
  "text after <code />": { note: "Some <code />HERE", code: true },
  "text after <code class/>": {
    note: 'Some <code class="x"/>HERE',
    code: true,
  },
  "text a paragraph after <code/>": {
    note: "Some <code/>a\n\nHERE",
    code: true,
  },
  "text after <code/> and its </code>": {
    note: "Some <code/>a</code> HERE",
    code: false,
  },
  "text after a closed <code>": {
    note: "Some <code>a</code>\n\nHERE",
    code: false,
  },
  "text after a closed <code> on its own line": {
    note: "<code>a</code>\n\nHERE",
    code: false,
  },
  "text in a quote after an open <code>": {
    note: "> <code>\n>\n> HERE",
    code: true,
  },
  "text after a quote's open <code>": { note: "> <code>\n\nHERE", code: true },
  "text after a callout's open <code>": {
    note: "> [!note]\n> <code>\n\nHERE",
    code: true,
  },
  "text in an item after an open <code>": {
    note: "- <code>\n\n  HERE",
    code: true,
  },
  "text after an item's open <code>": { note: "- <code>\n\nHERE", code: true },
  "text in a numbered item after an open <code>": {
    note: "1. a <code>b\n\n   HERE",
    code: true,
  },
  "text after a heading's open <code>": {
    note: "# A <code>b\n\nHERE",
    code: true,
  },
  "text after an open <code> in strong text": {
    note: "Some **a <code>b** c\n\nHERE",
    code: true,
  },
  "text after an open <CODE>": { note: "Some <CODE>a\n\nHERE", code: true },
  "text after an open <pre>": {
    note: "Some <pre>a\n\nHERE",
    code: false,
    limit: tagWithheld,
  },
  "text over blank lines in an open <pre>": {
    note: "<pre>\n\nHERE\n\n</pre>",
    code: false,
    limit: htmlWithheld,
  },
  "text after a closed <pre>": {
    note: "Some <pre>a</pre>\n\nHERE",
    code: false,
  },
  "text after <code> in a code span": {
    note: "Use the `<code>` tag.\n\nHERE",
    code: false,
  },
  "text after <code> in a fence": {
    note: "```\n<code>\n```\n\nHERE",
    code: false,
  },
  "text after <code> in indented code": {
    note: "a\n\n    <code>\n\nHERE",
    code: false,
  },
  "text after <code> in a comment block": {
    note: "%%\n<code>\n%%\n\nHERE",
    code: false,
  },
  "text after <code> in a wiki link": {
    note: "See [[<code>]]\n\nHERE",
    code: false,
  },
  "text after <coder>": { note: "Some <coder>a\n\nHERE", code: false },
  "text after </code> alone": { note: "Some </code> a\n\nHERE", code: false },
  // What raw HTML holds as text closes nothing, as the browser reads it.
  "a </code> in a comment": {
    note: "<div><code><!-- </code> -->\n\nHERE\n\n</code>",
    code: true,
  },
  "a </code> in a quoted attribute": {
    note: '<div><code><span title="</code>">x</span>\n\nHERE\n\n</code>',
    code: true,
  },
  "a </code> in a comment over lines": {
    note: "<div><code><!--\n</code>\n-->\n\nHERE\n\n</code>",
    code: true,
  },
  "a </code> in a quoted attribute over lines": {
    note: '<div><code><span title="\n</code>\n">x</span>\n\nHERE\n\n</code>',
    code: true,
  },
  "a </code> in a single-quoted attribute": {
    note: "<div><code><span title='</code>'>x</span>\n\nHERE",
    code: true,
  },
  "text after </code> after a comment": {
    note: "<div><code><!-- x --></code>\n\nHERE\n\n</code>",
    code: false,
  },
  "text after </code> after an attribute": {
    note: '<div><code><span title="x">x</span></code>\n\nHERE\n\n</code>',
    code: false,
  },
  "text after </code> after a comment over lines": {
    note: "<div><code><!--\nx\n-->\n</code>\n\nHERE",
    code: false,
  },
  "text after </code> after an attribute over lines": {
    note: '<div><code><span title="\nx\n">x</span>\n</code>\n\nHERE',
    code: false,
  },
  "text after </code> after a single-quoted attribute": {
    note: "<div><code><span title='x'>x</span></code>\n\nHERE",
    code: false,
  },
  "text after </code> after an unquoted attribute": {
    note: "<div><code><span title=x></code>\n\nHERE",
    code: false,
  },
  "text after </code> after a quote in an attribute's name": {
    note: '<div><code><span "a></code>\n\nHERE',
    code: false,
  },
  "text after </code> after a quote after = alone": {
    note: '<div><code><span ="a></code>\n\nHERE',
    code: false,
  },
  "text after </code> after a quote in an unquoted value": {
    note: '<div><code><span title=a"b></code>\n\nHERE',
    code: false,
  },
  "a </code> in an attribute quoted after a space": {
    note: '<div><code><span a= "></code>">\n\nHERE',
    code: true,
  },
  "text after </code> after <!-->": {
    note: "<div><code><!--></code>\n\nHERE",
    code: false,
  },
  "text after </code> after <!--->": {
    note: "<div><code><!---></code>\n\nHERE",
    code: false,
  },
  "text after </code> after a comment ending --!>": {
    note: "<div><code><!-- a --!></code>\n\nHERE",
    code: false,
  },
  "text after </code> after a comment ending --->": {
    note: "<div><code><!-- a ---></code>\n\nHERE",
    code: false,
  },
  "text after </code> after <!-- in a comment": {
    note: "<div><code><!-- <!--></code>\n\nHERE",
    code: false,
  },
  "a </code> in a comment past -- >": {
    note: "<div><code><!-- a -- ></code> -->\n\nHERE",
    code: true,
  },
  "a </code> in a comment past --!": {
    note: "<div><code><!-- a --!</code> -->\n\nHERE",
    code: true,
  },
  "a </code> in a comment past --!->": {
    note: "<div><code><!-- a --!-></code> -->\n\nHERE",
    code: true,
  },
  "a </code> in <? to its first >": {
    note: "<div><code><? a </code> ?>\n\nHERE",
    code: true,
  },
  "text after </code> after <? to its first >": {
    note: "<div><code><? a > </code>\n\nHERE",
    code: false,
  },
  "text after </code> after a declaration": {
    note: "<div><code><!X a > </code>\n\nHERE",
    code: false,
  },
  "a </code> in a doctype's quotes": {
    note: '<div><code><!DOCTYPE a "</code>">\n\nHERE',
    code: true,
  },
  "a </code> in CDATA to its first >": {
    note: "<div><code><![CDATA[ </code> ]]>\n\nHERE",
    code: true,
  },
  "text after </code> after CDATA to its first >": {
    note: "<div><code><![CDATA[ a > </code> ]]>\n\nHERE",
    code: false,
  },
  "a </code> in </ and a space": {
    note: "<div><code></ </code> >\n\nHERE",
    code: true,
  },
  "a </code> in </ and a digit": {
    note: "<div><code></1</code>\n\nHERE",
    code: true,
  },
  "text after </code> after </>": {
    note: "<div><code></></code>\n\nHERE",
    code: false,
  },
  // Nothing but its own closing tag ends the text of some elements.
  "a </code> in a <textarea>": {
    note: "<div><code><textarea></code></textarea>\n\nHERE",
    code: true,
  },
  "a </code> in a <style>": {
    note: "<div><code><style></code></style>\n\nHERE",
    code: true,
  },
  "a </code> in a <title>": {
    note: "<div><code><title></code></title>\n\nHERE",
    code: true,
  },
  "a </code> in an <xmp>": {
    note: "<div><code><xmp></code></xmp>\n\nHERE",
    code: true,
  },
  "a </code> in an <iframe>": {
    note: "<div><code><iframe></code></iframe>\n\nHERE",
    code: true,
  },
  "a </code> in a <noembed>": {
    note: "<div><code><noembed></code></noembed>\n\nHERE",
    code: true,
  },
  "a </code> in a <noframes>": {
    note: "<div><code><noframes></code></noframes>\n\nHERE",
    code: true,
  },
  "a </code> in a <textarea/>": {
    note: "<div><code><textarea/></code></textarea>\n\nHERE",
    code: true,
  },
  "a </code> in a <textarea> past </textareax>": {
    note: "<div><code><textarea></textareax></code></textarea>\n\nHERE",
    code: true,
  },
  "text after </code> after a closed <textarea>": {
    note: "<div><code><textarea>x</textarea></code>\n\nHERE",
    code: false,
  },
  "text after </code> in a <noscript>": {
    note: "<div><code><noscript></code></noscript>\n\nHERE",
    code: false,
  },
  "text in a <textarea> over blank lines": {
    note: "<div><textarea>\n\nHERE",
    code: false,
    limit: rawWithheld,
  },
  "text after a closed <textarea> over blank lines": {
    note: "<div><textarea>\n\na\n\n</textarea>\n\nHERE",
    code: false,
  },
  "text in a <textarea> from a paragraph": {
    note: "Some <textarea> b\n\nHERE",
    code: false,
    limit: rawWithheld,
  },
  "a </code> in a <textarea> from a paragraph": {
    note: "Some <code>a <textarea> b\n\n<div></code></div>\n\nHERE",
    code: true,
  },
  "text in a <textarea> from a table's cell": {
    note: "| a |\n| - |\n| <textarea> |\n\nHERE",
    code: false,
    limit: rawWithheld,
  },
  // Some elements hold a closing tag that closes nothing.
  "a </code> in a <table>": {
    note: "<div><code><table></code>\n\nHERE",
    code: true,
  },
  "a </code> in a <table>'s cell": {
    note: "<div><code><table><tr><td></code></td></tr></table>\n\nHERE",
    code: true,
  },
  "a </code> in a <caption>": {
    note: "<div><code><table><caption></code></caption></table>\n\nHERE",
    code: true,
  },
  "a </code> in a <select>": {
    note: "<div><code><select></code></select>\n\nHERE",
    code: true,
  },
  "a </code> in a <template>": {
    note: "<div><code><template></code></template>\n\nHERE",
    code: true,
  },
  "a </code> in an <object>": {
    note: "<div><code><object></code></object>\n\nHERE",
    code: true,
  },
  "a </code> in an <applet>": {
    note: "<div><code><applet></code></applet>\n\nHERE",
    code: true,
  },
  "a </code> in a <marquee>": {
    note: "<div><code><marquee></code></marquee>\n\nHERE",
    code: true,
  },
  "text after </code> after a closed <table>": {
    note: "<div><code><table></table></code>\n\nHERE",
    code: false,
  },
  "text after </code> after a closed <select>": {
    note: "<div><code><select></select></code>\n\nHERE",
    code: false,
  },
  "text after </code> in a <table> opened before": {
    note: "<div><table><code>a</code>\n\nHERE",
    code: false,
  },
  "text after </code> in a cell opened before": {
    note: "<div><table><td><code>a</code>\n\nHERE",
    code: false,
  },
  "text after a <table> in an open <code>": {
    note: "<div><code><table>\n\nHERE",
    code: true,
  },
  "a </code> in a Markdown table's cell": {
    note: "Some <code>a\n\n| x |\n| - |\n| </code> |\n\nHERE",
    code: true,
  },
  "a </code> in a Markdown table's header": {
    note: "Some <code>a\n\n| </code> |\n| - |\n| b |\n\nHERE",
    code: true,
  },
  "text after a table whose header opens <code>": {
    note: "| <code>a |\n| - |\n| b |\n\nHERE",
    code: false,
  },
  "text after a table whose cell closes <code>": {
    note: "| a |\n| - |\n| <code>b</code> |\n\nHERE",
    code: false,
  },
  // Eight elements or more keep a copy of a <code> open past its </code>.
  "a </code> past seven <div>": {
    note: "<div><code><div><div><div><div><div><div><div>x</code>\n\nHERE",
    code: false,
  },
  "a </code> past eight <div>": {
    note: "<div><code><div><div><div><div><div><div><div><div>x</code>\n\nHERE",
    code: true,
  },
  "a </code> past eight <blockquote>": {
    note: "<div><code><blockquote><blockquote><blockquote><blockquote><blockquote><blockquote><blockquote><blockquote>x</code>\n\nHERE",
    code: true,
  },
  "a </code> past ten <span>": {
    note: "<div><code><span><span><span><span><span><span><span><span><span><span>x</code>\n\nHERE",
    code: false,
  },
  "a </code> in three quotes": {
    note: "<div><code>\n\n> > > a </code>\n\nHERE",
    code: false,
  },
  "a </code> in six quotes": {
    note: "<div><code>\n\n> > > > > > a </code>\n\nHERE",
    code: false,
    limit: blocksWithheld,
  },
  "a </code> in seven quotes": {
    note: "<div><code>\n\n> > > > > > > a </code>\n\nHERE",
    code: true,
  },
  "a </code> in three list items": {
    note: "<div><code>\n\n- a\n  - a\n    - a </code>\n\nHERE",
    code: false,
  },
  "a </code> in four list items": {
    note: "<div><code>\n\n- a\n  - a\n    - a\n      - a </code>\n\nHERE",
    code: true,
  },
  "a </code> in three numbered items": {
    note: "<div><code>\n\n1. a\n   1. a\n      1. a </code>\n\nHERE",
    code: false,
  },
  "a </code> in four numbered items": {
    note: "<div><code>\n\n1. a\n   1. a\n      1. a\n         1. a </code>\n\nHERE",
    code: true,
  },
  "a </code> in three callouts": {
    note: "<div><code>\n\n> [!note] t\n> > [!note] t\n> > > [!note] t\n> > > a </code>\n\nHERE",
    code: false,
  },
  "a </code> in four callouts": {
    note: "<div><code>\n\n> [!note] t\n> > [!note] t\n> > > [!note] t\n> > > > [!note] t\n> > > > a </code>\n\nHERE",
    code: true,
  },
  "a </code> in a heading": {
    note: "<div><code>\n\n# a </code>\n\nHERE",
    code: false,
  },
  // Footnotes, shown at the note's end, and definitions open and close nothing.
  "a </code> in a footnote": {
    note: "Some <code>a\n\n[^1]: b </code>\n\nHERE",
    code: true,
  },
  "a </code> in a footnote with a reference": {
    note: "Some <code>a\n\nb [^1]\n\n[^1]: c </code>\n\nHERE",
    code: true,
  },
  "text after a footnote that closes </code>": {
    note: "Some <code>a\n\n[^1]: c </code>\n\nd [^1] HERE",
    code: true,
  },
  "a </code> in a footnote in a quote": {
    note: "Some <code>a\n\n> [^1]: b </code>\n\nHERE",
    code: true,
  },
  "a </code> in a footnote in an item": {
    note: "Some <code>a\n\n- [^1]: b </code>\n\nHERE",
    code: true,
  },
  "a </code> in a footnote indented three spaces": {
    note: "Some <code>a\n\n   [^1]: c </code>\n\nHERE",
    code: true,
  },
  "a </code> in a footnote of *": {
    note: "Some <code>a\n\n[^a*b]: c </code>\n\nHERE",
    code: true,
  },
  "a </code> in a footnote of [": {
    note: "Some <code>a\n\n[^a[b]: c </code>\n\nHERE",
    code: true,
  },
  "text after a footnote of an escaped ]": {
    note: "Some <code>a\n\n[^a\\]b]: c </code>\n\nHERE",
    code: false,
  },
  "text after [^a b]:": {
    note: "Some <code>a\n\n[^a b]: c </code>\n\nHERE",
    code: false,
  },
  "text after [^]:": {
    note: "Some <code>a\n\n[^]: c </code>\n\nHERE",
    code: false,
  },
  "text after [^1]: after a paragraph's line": {
    note: "Some <code>a\n\nx\n[^1]: c </code>\n\nHERE",
    code: false,
  },
  "text after a footnote that opens <code>": {
    note: "Some [^1] c\n\n[^1]: <code>d\n\nHERE",
    code: false,
  },
  "a </code> in an inline footnote": {
    note: "Some <code>a ^[b </code>] c\n\nHERE",
    code: true,
  },
  "text after </code> after an inline footnote": {
    note: "Some <code>a ^[b] </code>\n\nHERE",
    code: false,
  },
  "text after an inline footnote that opens <code>": {
    note: "Some ^[b <code>] c\n\nHERE",
    code: false,
  },
  "a </code> in a definition over lines": {
    note: 'Some <code>a\n\n[x\ny]: z "</code>"\n\nHERE',
    code: true,
  },
  "a </code> in an image's text": {
    note: "Some <code>a\n\n![</code>](x.png)\n\nHERE",
    code: true,
  },
  "a </code> in a link's title": {
    note: 'Some <code>a [b](c "</code>")\n\nHERE',
    code: true,
  },
  // Inline HTML is read as the browser reads it.
  "a <code> after <? to its first >": {
    note: "Some <? b > <code> ?>\n\nHERE",
    code: true,
  },
  "a <code> after CDATA to its first >": {
    note: "Some <![CDATA[ > <code> ]]>\n\nHERE",
    code: true,
  },
  "a <code> after a declaration": {
    note: "Some <!X > <code> >\n\nHERE",
    code: true,
  },
  "text after </code> after an inline <?": {
    note: "Some <code>a <? b > </code> ?>\n\nHERE",
    code: false,
  },
  "text after an inline <!-- with --!>": {
    note: "Some <code>a <!-- b --!> </code> -->\n\nHERE",
    code: false,
  },
  "text after an inline <textarea> closed": {
    note: "Some <code>a <textarea>b</textarea> </code>\n\nHERE",
    code: false,
  },
  "a </code> in an inline attribute": {
    note: 'Some <code>a <span title="</code>">b</span>\n\nHERE',
    code: true,
  },
  "a </code> in an inline comment": {
    note: "Some <code>a <!-- </code> -->\n\nHERE",
    code: true,
  },
  // Where Obsidian shows nothing, an embed shows nothing.
  "text in a comment over blank lines": {
    note: "<div><!--\n\nHERE\n\n-->",
    code: true,
    hidden: true,
  },
  "text after an attribute <? leaves open": {
    note: 'Some <? b > <span title=" ?>\n\nHERE',
    code: true,
    hidden: true,
  },
  "text in an inline tag": {
    note: 'Some <span title="HERE">x</span>',
    code: true,
    hidden: true,
  },
  "text in an inline comment": {
    note: "Some <!-- HERE -->",
    code: true,
    hidden: true,
  },
  "text in an inline <?": { note: "Some <? HERE ?>", code: true, hidden: true },
  "text in an inline <b>": { note: "Some <b>HERE</b>", code: false },
  "text after <plaintext>": {
    note: "<div><code><plaintext></code>\n\nHERE",
    code: true,
    hidden: true,
  },
  // Where raw HTML leaves open what Obsidian's own HTML may end, nothing is certain.
  "text after a comment that a paragraph ends": {
    note: "<div><!--\n\na --> b\n\nHERE",
    code: false,
    limit: unsureWithheld,
  },
  "text after an attribute that a paragraph ends": {
    note: '<div title="\n\na " b\n\nHERE',
    code: false,
    limit: unsureWithheld,
  },
  "text after a tag that a paragraph ends": {
    note: "<div title=x\n\nHERE",
    code: false,
    limit: unsureWithheld,
  },
  "text after a comment that HTML ends": {
    note: "<div><!--\n\n<div>-->\n\nHERE",
    code: false,
  },
  "text after </code> after a comment that HTML ends": {
    note: "<div><code><!--\n\nx\n\n<div>--></code>\n\nHERE",
    code: false,
    limit: unsureWithheld,
  },
  "text after a closed <script>": {
    note: "<div><code><script></code></script></code>\n\nHERE",
    code: false,
    limit: unsureWithheld,
  },
  "a </code> in a <script>'s escaped text": {
    note: "<div><code><script><!--<script></script></code>--></script>\n\nHERE",
    code: true,
  },
  "text after an <svg>": {
    note: "<svg>\n\nHERE",
    code: false,
    limit: unsureWithheld,
  },
  "text after </code> in an <svg>": {
    note: "<div><code><svg></code></svg>\n\nHERE",
    code: false,
    limit: unsureWithheld,
  },
  "a </code> in an <svg>'s CDATA": {
    note: "<div><code><svg><![CDATA[ a > </code> ]]></svg>\n\nHERE",
    code: true,
  },
  // In a comment or math, Obsidian shows nothing, and an embed shows nothing;
  // the check lists in a math block, as before.
  "text in a comment block": { note: "%%\nHERE\n%%", code: true, hidden: true },
  "text in a math block": {
    note: "$$\nHERE\n$$",
    code: true,
    hidden: true,
    limit: mathListed,
  },
  "text in a quote's comment block": {
    note: "> %%\n> HERE\n> %%",
    code: true,
    hidden: true,
  },
  "text in an item's math block": {
    note: "- $$\n  HERE\n  $$",
    code: true,
    hidden: true,
    limit: mathListed,
  },
  "text in a math block after its $$": {
    note: "$$ a\nHERE\n$$",
    code: true,
    hidden: true,
    limit: mathListed,
  },
  "text in a comment block's first lines": {
    note: "%% a\nHERE",
    code: true,
    hidden: true,
  },
  "text before a comment block's end": {
    note: "%%\na HERE %%",
    code: true,
    hidden: true,
  },
  "text before a comment block's end and more": {
    note: "%%\na HERE %% b",
    code: true,
    hidden: true,
  },
  "text in a quote before a comment block's end": {
    note: "> %%\n> a HERE %% b",
    code: true,
    hidden: true,
  },
  "text after a comment block's end": { note: "%%\na %% b HERE", code: false },
  "text in an inline comment of %%": {
    note: "a %%HERE%% b",
    code: true,
    hidden: true,
  },
  "text in an inline comment of %% and spaces": {
    note: "a %% x HERE %% b",
    code: true,
    hidden: true,
  },
  "text in inline math": { note: "a $HERE$ b", code: true, hidden: true },
  "text in inline display math": {
    note: "a $$HERE$$ b",
    code: true,
    hidden: true,
  },
  "text after a comment on one line": { note: "%% a %%\nHERE", code: false },
  "text after a math block": { note: "$$\na\n$$\nHERE", code: false },
  "text in math after a footnote that opens <pre>": {
    note: "[^1]: a \t`<pre>\n$$`` -->\n x %%HERE ` ~~\n* a===",
    code: true,
    hidden: true,
    limit: mathListed,
  },
};

/**
 * Notes by name, with HERE where a trigger is typed: in code that started on an
 * earlier line, where the insert trigger lists nothing, and in the text beside
 * it, where it lists. The unit tests check that src/notes/code.ts finds each as
 * `code` says, with the trigger typed in place of HERE too;
 * test/e2e/specs/suggest.e2e.ts that Obsidian renders each so, and types the
 * trigger into some of them.
 */
export const triggerCases: Readonly<Record<string, CodeCase>> = {
  // A code span runs through its paragraph's lines.
  Span: { note: "A `code span\nthat runs on HERE` here.\n", code: true },
  "Span ended": { note: "A `code span\nthat ends` HERE.\n", code: false },
  "Span in a quote": {
    note: "> A `code span\nthat runs on HERE` here.\n",
    code: true,
  },
  "Span over a blank": { note: "A `not code\n\nHERE` here.\n", code: false },
  Escaped: { note: "A \\`not code\nHERE` here.\n", code: false },
  Unmatched: { note: "A `not code\nHERE here.\n", code: false },
  "Unmatched run": { note: "A ``not code\nHERE` here.\n", code: true },
  // A callout's title line is read on its own.
  Callout: {
    note: "> [!note] A `title\n> with `code HERE` here.\n",
    code: true,
  },
  "Callout's text": {
    note: "> [!note] A `title\n> and text HERE` here.\n",
    code: false,
  },
  // A fenced code block in a quote ends with the quote.
  Quote: { note: "> ```\n> sample\n\nHERE\n", code: false },
  "Nested quote": { note: "> > ```\n> > sample\n>\n> HERE\n", code: false },
  "Quote's fence": { note: "> ```\n> sample\n>\n> HERE\n", code: true },
  "Nested fence": { note: "> > ```\n> > sample\n> > HERE\n", code: true },
  // And one in a list item, with the item.
  "Item's fence": { note: "- ```\n  sample\n  HERE\n", code: true },
  List: { note: "- A list item\n  ```\n  sample\n\nHERE\n", code: false },
  // One the note opened runs to its end, through blank lines.
  "Open fence": { note: "```\nsample\n\n\nHERE\n", code: true },
  // An indented code block, told from a list item's indented text.
  Indented: { note: "Some text.\n\n    HERE\n", code: true },
  "Item's text": { note: "- A list item\n\n    HERE\n", code: false },
  // What Obsidian reads before a code span takes its backticks.
  "Wiki link": {
    note: "See [[odd`name]] and `code that\nruns on HERE` here.\n",
    code: true,
  },
  Comment: { note: "%% a `comment %%\nthen HERE` here.\n", code: false },
  Definition: { note: "[ref]: `odd\n`code HERE` here.\n", code: true },
  // A tab after a quote's `>` indents its text as code.
  Tab: { note: ">\tindented HERE\n", code: true },
  // A line without `>` goes on in a quote after any block in it.
  "Quote's heading": {
    note: "> # A heading\n`code that\n> runs on HERE` here.\n",
    code: true,
  },
  // An empty item takes in the line after it.
  "Empty item": { note: "-\n ~~~\n- HERE\n", code: false },
  // An HTML block lists nothing, as its code cannot be told from its text;
  // the text after it lists, and so does ordinary inline HTML.
  "HTML code": { note: "<pre><code>`HERE`</code></pre>\n", code: true },
  "After HTML": { note: "<div>\nsample\n</div>\n\nHERE\n", code: false },
  "Inline HTML": { note: "Some <b>bold</b> HERE text.\n", code: false },
  // A `<code>` tag in a paragraph makes code to its `</code>`.
  "Code tag": { note: "Some <code>inline HERE</code> text.\n", code: true },
  // An open `<code>` stays open over blank lines, as the browser keeps it,
  // and a slash does not close one; a closed one makes no code after it.
  "Open code": { note: "<code>\n\nHERE\n\n</code>\n", code: true },
  "Open code tag": { note: "Some <code>a\n\nHERE\n\n</code>\n", code: true },
  "Code slash": { note: "Some <code/>HERE\n", code: true },
  "Code space slash": { note: "Some <code />HERE\n", code: true },
  "Code attribute slash": { note: 'Some <code class="x"/>HERE\n', code: true },
  "Closed code": { note: "Some <code>a</code>\n\nHERE\n", code: false },
  // A closing tag in a comment or a quoted attribute closes nothing, on one
  // line or over lines; a real one after them closes the `<code>`.
  "Code comment": {
    note: "<div><code><!-- </code> -->\n\nHERE\n\n</code>\n",
    code: true,
  },
  "Code attribute": {
    note: '<div><code><span title="</code>">x</span>\n\nHERE\n\n</code>\n',
    code: true,
  },
  "Code comment lines": {
    note: "<div><code><!--\n</code>\n-->\n\nHERE\n\n</code>\n",
    code: true,
  },
  "Code attribute lines": {
    note: '<div><code><span title="\n</code>\n">x</span>\n\nHERE\n\n</code>\n',
    code: true,
  },
  "Closed comment": {
    note: "<div><code><!-- x --></code>\n\nHERE\n",
    code: false,
  },
  "Closed attribute": {
    note: '<div><code><span title="x">x</span></code>\n\nHERE\n',
    code: false,
  },
};
