# Without Inkline

A symbol is an ordinary PNG file with an ordinary embed, so Obsidian keeps
showing it in your notes when Inkline is turned off or uninstalled. A note holds
no syntax of Inkline's own. Other Markdown apps, and sites such as GitHub, can
show the picture too, from a link they read, as [In other apps](#in-other-apps)
describes.

## What you see

Without Inkline, a symbol shows as the picture it is: the symbol in a mid grey,
`#7e7e7e`, on a transparent background, which stays legible on light and dark
backgrounds alike. It is not in the text's colour, and it shows at its file's
own size rather than at the text's: 192 pixels tall, with the width its ink
needs, so it stands out of the line as a picture would.

To keep it near text size without Inkline, give the embed a size as Obsidian
reads it, which Inkline also keeps:

```md
The door is marked with ![[tower.ink.png|24]] which means return.
```

With Inkline on again, symbols show as characters at once, and an editor that
was open when it was turned off offers its unsaved strokes back as a draft.

## In other apps

Obsidian's embed, `![[tower.ink.png]]`, is its own syntax, which GitHub and many
other apps show as text. They show a symbol as the picture it is when:

- the note links it as a standard Markdown image, `![](path)`;
- the path leads from the note's own folder to the symbol's file, as GitHub
  reads it;
- the symbol's file goes with the note, at that place, as when the whole vault
  is copied or pushed.

Obsidian writes such links for the symbols Inkline inserts when **Use
\[\[Wikilinks\]\]** is off and **New link format** is **Relative path to file**,
under **Settings → Files and links**. A note `Notes/Door.md` then embeds the
symbol `Symbols/tower.ink.png` as:

```md
The door is marked with ![](../Symbols/tower.ink.png) which means return.
```

Inkline shows such a link as a character, as it shows any other. The settings
change only the links Obsidian writes from then on, not those already in your
notes. Where Obsidian's own link would lead elsewhere, as it can for a name with
an unbalanced parenthesis, Inkline links the symbol by its path in the vault
instead, as [Known limits](./limits.md#links-obsidian-writes) says. Other apps
read that path from the note's folder, so they show such a symbol only in a note
at the vault's root. A size after `|` is Obsidian's own: other apps show a
symbol at its file's size, as [What you see](#what-you-see) describes.

## Editing them elsewhere

Any image viewer or editor opens a symbol, and notes show what its pixels hold.
Inkline's editor, though, draws a symbol from the strokes it keeps in a chunk
inside the PNG, which is marked as depending on the image. A program that
changes the image drops that chunk, as PNG's rules ask, and so do many image
editors, and some optimisers that recompress a file, even when it looks the
same. That leaves a picture that Inkline opens as pixels you can draw on and
erase, as [Saving and recovery](./recovery.md#pictures-without-strokes)
describes. The symbol looks as the program left it, and its strokes are gone. A
program that keeps the chunk while changing how the image shows, as by adding an
orientation to its metadata, leaves strokes that no longer match it; Inkline's
editor shows the strokes, and saving there replaces the image.

A symbol's readings and translations are in PNG text chunks, which many programs
keep, and any PNG tool can read. A program that drops them leaves the rest of
the file as it was, and they are gone, as they are held nowhere else.

The [file format](./file-format.md) specifies the pixels, the chunk, and the
text a file can hold about its symbol, for anyone writing a tool that reads or
writes symbols.
