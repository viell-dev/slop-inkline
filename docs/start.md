# Your first symbol

This walks through drawing a symbol, putting it in a note, and using it again.
It assumes Inkline is [installed](./install.md) and turned on.

## Draw it

1. Open a note in editing view, Live Preview or source mode, and put the cursor
   where the symbol goes, as you would before typing a letter.
2. Open the command palette (Ctrl+P, or Cmd+P on macOS) and run **Inkline:
   Insert symbol**. The editor opens over the note. Nothing is created yet.
3. Draw the symbol in the drawing area with a mouse or a trackpad. The lines
   across it are guides at the text font's ascender, cap height, x-height,
   baseline, and descender, so that you can draw it at the size of the letters
   around it. The line of text under the drawing shows the symbol at its size in
   the text as you draw.
4. Type a name for it in the field at the top, in any script: your current guess
   at its meaning, such as `tower`. Leave it empty, and the symbol takes the
   next free number in its folder, such as `001`.
5. Press **Save**, or Ctrl+Enter (Cmd+Enter on macOS).

Inkline creates the file `tower.ink.png` where Obsidian puts new attachments for
that note, as **Settings → Files and links** says, and inserts its embed where
the cursor was, written as the vault writes links:

```md
The door is marked with ![[tower.ink.png]] which means return.
```

The symbol shows in the line at the text's size and in its colour.

## Copy several in one pass

For an inscription of several symbols, press **Next**, or Ctrl+Shift+Enter
(Cmd+Shift+Enter on macOS), instead of Save. It saves and inserts the symbol,
then opens a blank editor whose symbol goes right after it, with the same tools.
Press Save on the last one.

## Use it again

In any note, type `;;` and the first letters of its name, then press Enter:

```md
The gate shows ;;tow
```

The list that opens shows your symbols with their pictures, the best match
first; Enter puts the chosen symbol's embed in place of what you typed, and Esc
closes the list. **Inkline: Insert existing symbol** opens the same list to
search.

## Change it

Right-click the symbol and choose **Edit symbol**, or put the cursor on its
embed and run **Inkline: Edit symbol**. The editor opens with every stroke as
you drew it. Change the name in its field to rename the symbol: Obsidian updates
the links to it in your notes, as its setting for updating internal links says.

Next: [Drawing in the editor](./drawing.md) describes every tool, and
[Symbols in notes](./notes.md) how symbols behave in your notes.
