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
      Each symbol is an image in your vault with an ordinary embed, so your
      notes still show it without the plugin, and other apps can show it from a
      standard Markdown link.
  - title: Written again in a few keys
    details:
      Type ;; and a few letters of a symbol's name to write it again in any
      note. Name it with your current guess at what it means, and rename it as
      your reading changes; the notes that use it follow.
  - title: Edit without loss
    details:
      The strokes are kept inside the file, so a symbol opens again exactly as
      drawn, however often you edit it.
---

::: info Prerelease

Inkline is a prerelease for Obsidian 1.13.4 or later, on desktop.
[Install the release ZIP](./install.md), then draw your first symbol.

:::

## What it is for

Inkline is made for games with an invented language, such as Chants of Sennaar,
where working out the language is the game. The symbols of such a language are
in no font, so you cannot type them into your notes. Inkline does two things
about that:

- **Write a symbol down easily.** Draw it where you meet it, or trace it from a
  screenshot, and it sits in the line like a letter.
- **Use it again easily.** Type `;;` and a few letters of its name to write it
  again in any note. Name it with your current guess at its meaning, rename it
  as your reading changes, and find every note that uses it.

It serves anyone else who writes with symbols of their own in the same way:
people creating a constructed language (a conlang) with a script of its own, and
people using a cipher or a personal shorthand.

It is not a whiteboard, a handwriting notebook, a font editor, or a set of
ready-made symbols: it draws small symbols of your own, one at a time, for use
in text.

## What it does now

![An invented inscription in Reading view, with inline symbols and the library's renamed sign linked to both notes that use it.](./screenshots/reading-light.png)

- **Draw** a symbol in an editor sized to one line of text, with a mouse or a
  trackpad, with guides at the text font's lines; trace over a screenshot, or
  turn it into ink, instead of drawing. See
  [Drawing in the editor](./drawing.md).
- **Insert** it where you were writing, or type `;;` and a few letters of a
  symbol you have to insert it again. See [Symbols in notes](./notes.md).
- **Name** and rename it in its editor, and **edit** it again from its menu, a
  command, or the file explorer.
- **Record** how it is read and what it means, apart from its name, and find it
  by either. See
  [Readings and translations](./notes.md#readings-and-translations).
- **Find and reuse** your symbols in the sidebar library, with a filter,
  folders, and the notes that use each. See
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
