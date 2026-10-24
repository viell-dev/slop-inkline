# Changelog

Notable changes to Inkline, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers are
plain dotted numbers, and versions below 1.0.0 are prereleases. Each release's
section is also its
[GitHub release](https://github.com/viell-dev/slop-inkline/releases)'s notes.

## Unreleased

### Added

- **Rename** in the symbol library edits a symbol's name directly in its row,
  using the same name rules as its drawing editor and Obsidian's link updates.
  Enter or Save applies it; Esc or Cancel keeps the old name. Errors keep the
  entered name for correction or retry. Renaming leaves the PNG bytes as they
  are and refuses a file deleted and replaced while its name is being edited.

- **Insert symbol**, a command that opens the editor for a new symbol. Draw it
  with a mouse, pen, or finger, and save it with Mod+Enter: Inkline creates the
  file in Obsidian's attachment location and inserts it where the cursor was.
  Nothing is created until the first save.
- **Next**, or Mod+Shift+Enter, in the editor for a new symbol, saves and
  inserts it, then opens a blank editor whose symbol goes right after it, with
  the same tools, so that an inscription of several symbols is copied in one
  pass.
- **Copy from**, or V, in the editor for a new symbol, starts it from a copy of
  another symbol's strokes and base layer, chosen from the vault's symbols, for
  scripts whose symbols share parts. Undo takes the copy back.
- **Tracing** in the editor: paste or drop a picture, such as a screenshot of a
  symbol in a game, and it shows faintly under the drawing, as tall as a capital
  letter, to draw over. It is never saved or kept in drafts. **Move**, or M,
  drags it and scales it with the wheel; the arrow keys and + and − do the same
  from the keyboard. Next takes it on to the next symbol where it was, so that
  an inscription is traced from one screenshot, and **Remove picture** takes it
  away.
- **Make ink**, or I, in the editor, turns the picture being traced into the
  symbol's ink, as its base layer, by a threshold that a slider sets and the
  surface previews; **Light ink** takes a light symbol on a dark or transparent
  ground. Only what the surface shows, across and within the line box's height,
  becomes ink, so that the other symbols of a screenshot stay out. The ink takes
  the place of any base layer the drawing had, and Undo takes it back. Saving,
  or closing and saving, while the preview shows makes that ink first. Copying a
  symbol you can see then needs no drawing at all.
- Symbols show in notes as characters: 1.5 em tall, the default line height,
  standing on the baseline, and in the text's colour, in light and dark themes,
  in Live Preview, Reading view, callouts, tables, embedded notes, hover
  previews, canvas cards, and popout windows. A heading or another line set
  tighter than 1.5 grows to fit. An explicit size, as `![[x.ink.png|24]]` gives,
  is kept and stays on the baseline. A symbol file shown on its own, in its tab
  or as a canvas's image, stays a picture; images from outside the vault and
  other images are left as they are; and with Inkline disabled, symbols show as
  the plain images they are. Hovering a symbol shows its name, or what its
  embed's alias or alt text says, which screen readers read as well; and in Live
  Preview, Obsidian's resize handle and image buttons no longer cover it. A
  plugin's own view of a note shows them as text with the `inkline-text` class,
  as [docs/rendering.md](docs/rendering.md) describes for theme and plugin
  authors.
- **Type to insert:** in a note, type `;;` and a few letters of a symbol's name,
  in any script, to choose it from a list with its picture: the best match
  first, then those the note uses most, then the most recently changed. Enter
  puts its embed in place of what was typed; Esc closes the list, and what you
  type after it stays text. Code and front matter show no list. **Insert
  existing symbol**, a command, opens the same list to search.
- **Symbol library:** **Show symbol library**, a command, opens a view of every
  symbol in the vault in the right sidebar, with its picture, its name and
  folder, and how many notes use it, which lists them to open. A filter by name,
  in any letter case, and a choice of folder narrow it. A click inserts a symbol
  at the cursor of the note you were last in, never inside a link or embed, and
  puts the cursor after it, so that symbols clicked in turn follow one another;
  a symbol's menu holds **Edit symbol**, with what Obsidian offers for a link to
  the file.
- **Edit symbol** opens a symbol in the editor again with every stroke, so that
  nothing is lost by editing. It is in a symbol file's menu, in the symbol
  library's menu for a symbol, and in a note: in Live Preview's menu for a
  symbol's picture, except in callouts and tables; in the menu a right-click on
  a symbol shows in Reading view, embedded notes, and popout windows, where
  Obsidian opened its image viewer instead; in the editor's menu on an embed's
  text; and as a command with the cursor on a symbol's embed, outside inline
  code, fenced code, and front matter.
- **Names:** the editor's title is the symbol's name, in any script, which you
  can type when you draw it and change whenever your reading of it changes.
  Characters a file name cannot hold on some system, or that would break a link,
  are left out, as are invisible spaces and the controls that reorder text; the
  joiners and marks that scripts and emoji need stay. A new symbol left unnamed
  takes the next free number in its folder when first saved. A changed name
  renames the file through Obsidian, so that the links to it follow as
  Obsidian's settings say, and the embed just inserted follows too; if the
  rename fails, the drawing is saved and the editor stays open with the name,
  for the next save to try. A name its folder already has, in any letter case,
  one Windows keeps for itself, or one too long for a file name, is refused with
  a notice, and the editor stays open. A symbol keeps a name it was given
  elsewhere, before or while its editor is open, even one Inkline would not
  give. Drafts keep a name typed but not saved.
- The editor's pen, eraser, four brush sizes, undo, redo, and clear, each with
  its shortcut in its tooltip. A pen's eraser end erases, and a palm resting on
  a tablet does not draw, even one that touched it before the pen. A symbol
  wider than the editor's usual view is shown whole, and F fits the drawing in
  view. Shortcuts that would also type, such as single keys and undo, give way
  to a text field that has the focus.
- Holding Shift while drawing makes the stroke straight from where it was when
  Shift went down. A grid of 1/8 em, which Shift+G shows or hides, snaps the
  ends of strokes to it, for scripts built from straight strokes and dots. The
  grid keeps its place on the drawing through saves and in drafts, and for a
  symbol opened again it goes where most of its strokes start and end.
- Guides in the editor at the text font's ascender, cap height, x-height,
  baseline, and descender, measured from the font, and at the ends the saved
  image would have; the Guides button or G shows or hides them.
- A line of text under the drawing shows the symbol at its size in the text, as
  it is drawn.
- The editor asks before closing a drawing with unsaved changes, whether by Esc,
  the close button, or a click outside, and keeps the drawing open when a save
  fails.
- Unsaved changes are kept as a draft in the vault's local storage after each
  finished stroke, undo, redo, or clearing, so that closing Obsidian or a crash
  loses at most a stroke still being drawn, and disabling Inkline loses nothing.
  Opening the same symbol, or a new one in the same note, offers the draft back;
  a draft not restored within 30 days is dropped. If the storage refuses a
  draft, a notice says so, and the last draft kept stays. Restoring the draft of
  a new symbol whose first save was interrupted, or whose embed could not be
  inserted, finishes that save with the file it made, if nothing changed that
  file since, and inserts the embed unless the note already has it.
- The editor follows its symbol's file while it is open. A change made
  elsewhere, by sync, another app, or another editor, reloads a drawing with
  nothing unsaved; otherwise the editor asks whether to reload, which Undo takes
  back, or keep the drawing, which saving then writes over the change. Each save
  checks the file first. A file that this version of Inkline cannot read is
  never saved over, and a deleted symbol is saved again where it was.
- A new symbol goes into the note it was started in, where the cursor was, even
  if that note's tab now shows another note or was closed. If the text around
  that place changed so much that it cannot be found, the symbol is added at the
  end of the note, with a notice. A cursor inside a link, an embed, or a web
  address puts the symbol just after it, so that no link is split; after a bare
  web address, which only a space ends, a space comes first.
