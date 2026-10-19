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
