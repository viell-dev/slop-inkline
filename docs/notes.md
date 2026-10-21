# Symbols in notes

A symbol in a note is an ordinary image embed of its file, such as
`![[tower.ink.png]]`, which Inkline shows as a character of the text. Inkline
knows a symbol by its file name, which ends in `.ink.png`.

## How symbols show

In a note, a symbol is as tall as a line of text, 1.5 times the text's size,
which is Obsidian's default line height, and stands on the baseline like a
letter. It takes the colour of the text around it, in light and dark themes, and
grows with headings and zoom. A line set tighter than that, such as a heading,
grows to fit it.

This holds in Live Preview, Reading view, callouts, tables, embedded notes,
hover previews, text cards on a canvas, and popout windows.

- **An explicit size** that Obsidian's embed syntax gives, as in
  `![[tower.ink.png|24]]`, is kept, and the symbol still stands on the baseline.
- **Hovering** a symbol shows its name, or what its embed's alias or alt text
  says; screen readers read it too.
- **A symbol file shown on its own**, in its own tab or as an image on a canvas,
  stays a picture, as do images from outside the vault and every other image.
- In Live Preview, Obsidian's resize handle and image buttons do not cover a
  symbol.

## Insert a new symbol

Run **Inkline: Insert symbol** in a note in editing view, draw the symbol, and
save it, as [Your first symbol](./start.md) shows. The first save creates the
file where Obsidian puts the note's new attachments, under the name you typed or
the next free number in that folder, and inserts the embed, written as your
vault writes links.

The embed goes where the cursor was when you ran the command:

- into the note the editor was started in, even if that note's tab shows another
  note by then or was closed;
- where the text around that place now is, if the note changed while you drew,
  as by sync or another pane; if that place cannot be found, at the end of the
  note, with a notice that says so;
- just after a link, an embed, or a web address the cursor was in, so that no
  link is split. After a bare web address, which only a space ends, a space
  comes first.

## Insert a symbol you have

Type `;;` and a few letters of a symbol's name, in any script, to list the
matching symbols with their pictures:

1. The list puts the best match by name first, then the symbols this note uses
   most, then the most recently changed, and shows up to 50.
2. Enter, or a click, puts the chosen symbol's embed in place of what you typed.
3. Esc closes the list, and what you type after it stays text.

Typed with a space, the name must hold what you typed, so that a sentence typed
on after `;;` stops matching. `;;` in code, inline or fenced, and in front
matter lists nothing: it is the note's own text there.

**Inkline: Insert existing symbol** opens the same list as a search, and inserts
the chosen symbol at the cursor.

## Edit a symbol

**Edit symbol** opens a symbol in the editor again, with every stroke as drawn.
It is offered:

- in a symbol file's menu, in the file explorer and on its tab;
- in Live Preview, in Obsidian's menu for the symbol's picture, on right-click;
- in Reading view, embedded notes, and popout windows, in the menu Inkline shows
  on right-click on a symbol, where Obsidian would open its image viewer;
- in the editor's menu on an embed's text;
- as the command **Inkline: Edit symbol**, with the cursor on a symbol's embed,
  outside code and front matter.

Some of Obsidian's own menus over a symbol have no Edit symbol, as in callouts
and tables in Live Preview; [Known limits](./limits.md) lists them, with a way
around each.

## Names and renames

A symbol's name is its file's name, and a name is the place for your current
reading of it. Rename it in its editor, as
[Drawing in the editor](./drawing.md#the-name) describes, or rename its file in
Obsidian in any way: an open editor follows a rename made elsewhere, and keeps
the name given there, even one Inkline itself would not give.

## Find where a symbol is used

Every use of a symbol is a link to its file, so Obsidian finds them: open the
symbol's file, and Obsidian's backlinks for it list the notes that use it. A
library of your symbols in the sidebar, with how many notes use each, is
planned.
