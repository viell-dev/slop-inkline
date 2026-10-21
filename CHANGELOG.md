# Changelog

Notable changes to Inkline, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers are
plain dotted numbers, and versions below 1.0.0 are prereleases. Each release's
section is also its
[GitHub release](https://github.com/viell-dev/slop-inkline/releases)'s notes.

## Unreleased

### Added

- **Insert symbol**, a command that opens the editor for a new symbol. Draw it
  with a mouse, pen, or finger, and save it with Mod+Enter: Inkline creates the
  file in Obsidian's attachment location, named with the next free number, and
  inserts it where the cursor was. Nothing is created until the first save.
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
  the plain images they are. A plugin's own view of a note shows them as text
  with the `inkline-text` class, as [docs/rendering.md](docs/rendering.md)
  describes for theme and plugin authors.
- **Type to insert:** in a note, type `;;` and a few letters of a symbol's name,
  in any script, to choose it from a list with its picture: the best match
  first, then those the note uses most, then the most recently changed. Enter
  puts its embed in place of what was typed; Esc closes the list, and what you
  type after it stays text. Code and front matter show no list. **Insert
  existing symbol**, a command, opens the same list to search.
- **Edit symbol**, in a symbol file's menu, which opens it in the editor again
  with every stroke, so that nothing is lost by editing.
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
