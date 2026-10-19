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
- **Edit symbol**, in a symbol file's menu, which opens it in the editor again
  with every stroke, so that nothing is lost by editing.
- The editor's pen, eraser, four brush sizes, undo, redo, and clear, each with
  its shortcut in its tooltip. A pen's eraser end erases, and a palm resting on
  a tablet does not draw.
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
  inserted, finishes that save with the file it made.
- A new symbol goes into the note it was started in, where the cursor was, even
  if that note's tab now shows another note or was closed. If the text around
  that place changed so much that it cannot be found, the symbol is added at the
  end of the note, with a notice.
