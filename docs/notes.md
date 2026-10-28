# Symbols in notes

A symbol in a note is an ordinary image embed of its file, such as
`![[tower.ink.png]]`, which Inkline shows as a character of the text. Inkline
knows a symbol by its file name, which ends in `.ink.png`.

## How symbols show

By default, a symbol is as tall as a line of text, 1.5 times the text's size,
which is Obsidian's default line height, and stands on the baseline like a
letter. It takes the colour of the text around it, in light and dark themes, and
grows with headings and zoom. A line set tighter than that, such as a heading,
grows to fit it.

[Settings](./settings.md) changes the size relative to the text and chooses
whether ink takes the text's colour or shows its stored grey pixels.

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
file in the [symbol folder](./settings.md), or where Obsidian puts the note's
new attachments, under the name you typed or the next free number in that
folder, and inserts the embed, written as your vault writes links.

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
- in a symbol's menu in the library;
- as the command **Inkline: Edit symbol**, with the cursor on a symbol's embed,
  outside code and front matter.

Some of Obsidian's own menus over a symbol have no Edit symbol, as in callouts
and tables in Live Preview; [Known limits](./limits.md) lists them, with a way
around each.

Saving the edited symbol changes it in every note that shows it. When your notes
use it more than once, the first save of a changed drawing asks first whether to
replace it everywhere;
[Saving and recovery](./recovery.md#changing-a-symbol-used-elsewhere) describes
the question, and how to make a variant instead.

## Names and renames

A symbol's name is its file's name, and a name is the place for your current
reading of it. Rename it directly in the library, in its editor, as
[Drawing in the editor](./drawing.md#the-name) describes, or rename its file in
Obsidian in any way: an open editor follows a rename made elsewhere, and keeps
the name given there, even one Inkline itself would not give.

## Find where a symbol is used

Run **Inkline: Show symbol library** to open **Symbols** in the right sidebar.
It lists every symbol with its picture, name, folder, and how many notes link to
it. Each note counts once, however often it uses the symbol. Symbols are ordered
by folder, the top folder first, then by name, with numbers in order.

- Type part of a name in **Filter by name**, in any letter case or script, and
  choose a folder to narrow the list.
- Click a symbol to insert it at the cursor in the note you were last in. The
  cursor moves after it and the library keeps the focus, so successive clicks
  write successive symbols. A selection's text is kept; a cursor inside a link
  or embed puts the symbol just after it. Open a note in editing view first; a
  note in Reading view cannot take an insertion.
- Click **1 note**, or **2 notes**, to list the notes that use a symbol, then
  click a note to open it. Ctrl-click, or Cmd-click on macOS, opens a new tab.
- Right-click a symbol for its file's menu, including **Edit symbol**.
- Choose **Rename** beside a symbol to edit its name in that row. Enter or
  **Save** renames it through Obsidian, so links follow according to Obsidian's
  link settings. Esc or **Cancel** keeps the old name. An empty name also keeps
  the old name. The same name rules apply as in the drawing editor.

If a name is refused or a rename fails, the entered name stays for correction or
retry. Save or cancel it before filtering again; the list then catches up with
any files and links that changed while you typed. Renaming changes the file's
name, leaving its drawing's bytes as they are. A symbol deleted and replaced
while its name is being edited cannot rename the replacement.

The list follows files and their links as they change. Obsidian's backlinks for
the symbol file also list the notes that link to it.

Keep the library in a sidebar to insert into a note. If its tab is dragged into
the main area, return it to a sidebar before inserting.

## Export a note to PDF

Run Obsidian's **Export to PDF** command while the note is open, choose its
export options, and save the PDF. Symbols keep their size, baseline, and colour
preference, including explicit embed sizes. Obsidian uses its light print theme
for the exported note, even when you read it in a dark theme.

Physical printer output has not been checked; the automated checks cover native
PDF export on Linux and the resulting document's pixels and layout.
