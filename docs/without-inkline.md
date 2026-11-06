# Without Inkline

A symbol is an ordinary PNG file with an ordinary embed, so your notes keep
showing it when Inkline is turned off or uninstalled, in other Markdown apps,
and on sites such as GitHub. Nothing about a note depends on the plugin.

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

## Editing them elsewhere

Any image viewer or editor opens a symbol, and notes show what its pixels hold.
Inkline's editor, though, draws a symbol from the strokes it keeps in a chunk
inside the PNG, which is marked as depending on the image. A program that
changes the image drops that chunk, as PNG's rules ask, and so do many image
editors, and optimisers that recompress a file, even when it looks the same.
That leaves a picture that Inkline opens as pixels you can draw on and erase, as
[Saving and recovery](./recovery.md#pictures-without-strokes) describes. The
symbol looks as the program left it, and its strokes are gone. A program that
breaks those rules and keeps the chunk leaves strokes that no longer match the
image; Inkline's editor shows the strokes, and saving there replaces the image.

The [file format](./file-format.md) specifies the pixels and the chunk, for
anyone writing a tool that reads or writes symbols.
