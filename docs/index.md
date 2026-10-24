---
layout: home
hero:
  name: Inkline
  text: Symbols you draw, written like letters
  tagline:
    An Obsidian plugin for drawing symbols that no font has, which sit in the
    line of text like characters, at the text's size and in its colour.
  actions:
    - theme: brand
      text: Draw your first symbol
      link: /start
    - theme: alt
      text: Install
      link: /install
features:
  - title: In the line, like a character
    details:
      A symbol stands on the text's baseline, grows with headings and zoom, and
      takes the colour of the text around it, in light and dark themes.
  - title: A plain PNG file
    details:
      Each symbol is an image in your vault with an ordinary embed, so notes
      still show it without the plugin, and in other Markdown apps.
  - title: Name it by its meaning
    details:
      Name a symbol in any script with your current guess at what it means, and
      rename it as your reading changes; the notes that use it follow.
  - title: Edit without loss
    details:
      The strokes are kept inside the file, so a symbol opens again exactly as
      drawn, however often you edit it.
---

::: warning No release yet

Inkline is under development and has no release. This site describes the
development version on `main`, which you can
[build and install yourself](./install.md). Its first release will need Obsidian
1.13.4 or later, on desktop.

:::

## What it is for

Inkline is made for working out invented scripts, such as the languages of
puzzle games like Chants of Sennaar: draw a symbol where you meet it, name it
with your current guess at its meaning, rename it as your reading changes, and
find every note that uses it. Conlang glyphs, ciphers, game marks, and personal
shorthand work the same way.

It is not a whiteboard, a handwriting notebook, a font editor, or a set of
ready-made symbols: it draws small symbols of your own, one at a time, for use
in text.

## What it does now

- **Draw** a symbol in an editor sized to one line of text, with a mouse, pen,
  or finger, with guides at the text font's lines; trace over a screenshot, or
  turn it into ink, instead of drawing. See
  [Drawing in the editor](./drawing.md).
- **Insert** it where you were writing, or type `;;` and a few letters of a
  symbol you have to insert it again. See [Symbols in notes](./notes.md).
- **Name** and rename it in its editor, and **edit** it again from its menu, a
  command, or the file explorer.
- **Find and reuse** your symbols in the sidebar library, with filters by name
  and folder, and the notes that use each. See
  [Find where a symbol is used](./notes.md#find-where-a-symbol-is-used).
- **Keep your work**: the editor asks before closing unsaved work, keeps unsaved
  strokes as a draft after a crash, and never saves over a file it cannot read.
  See [Saving and recovery](./recovery.md).

[Settings](./settings.md) describes size, colour, insertion, and drawing
preferences; [Known limits](./limits.md) lists what else is missing.

## Who maintains it

Inkline is written and maintained by AI agents, and no person reviews the code.
Its source, issues, and change history are on
[GitHub](https://github.com/viell-dev/slop-inkline).
