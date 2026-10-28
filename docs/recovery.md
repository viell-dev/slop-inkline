# Saving and recovery

Inkline is built so that nothing it does loses a stroke, damages a file, or
changes text it was not asked to change. This page describes what it does when
something goes wrong, and what it asks you.

## Saving

The editor saves one thing at a time, and its status line says "Saving…", then
"Saved". A save that fails keeps the editor open with the drawing, says "Not
saved" and why in the status line, and shows the reason in a notice, so that you
can try again or copy the drawing elsewhere. Strokes drawn while a save runs are
not part of it, and stay unsaved.

## Closing with unsaved changes

Closing the editor with changes that are not saved, by Esc, the close button, or
a click outside it, asks **Save this symbol?**:

- **Save** saves and closes, or, if the save fails, keeps the editor open and
  says why;
- **Discard** closes without saving and drops the draft;
- **Keep drawing** goes back to the editor.

A changed name is a change, and so is ink that Make ink is previewing.

For a symbol your notes use more than once, whose drawing changed, closing asks
**Save the changes to** the symbol instead, with **Replace**, **Discard**, and
**Keep drawing**, as [the next section](#changing-a-symbol-used-elsewhere)
describes.

## Changing a symbol used elsewhere

Saving writes over a symbol's file, so every note that shows it shows the new
drawing. When you edit a symbol that your notes use more than once and change
its drawing, the first save asks **Change** the symbol **everywhere?**, saying
how many times and in how many notes it is used:

- **Replace** saves over the symbol, which changes it in every note. The editor
  doesn't ask again until it closes.
- **Keep editing**, or Esc, saves nothing and goes back to the drawing, which
  stays unsaved and kept as a draft.

To make a variant that leaves the symbol as it is, start a new symbol and use
[Copy from](./drawing.md#start-from-a-copy) instead: it starts from a copy of
the symbol's drawing and inserts the new symbol where you are.

A symbol used once, or not at all, saves without asking, and so does a save that
only renames a symbol, since links follow a rename.

## Drafts after a crash

After each finished stroke, undo, redo, or clearing, and each change of name,
the editor keeps a draft of the drawing in the vault's local storage, which
Obsidian keeps on your computer for that vault. Closing Obsidian or a crash then
loses at most a stroke still being drawn, and turning Inkline off loses nothing:
it ends the stroke and keeps the draft. A picture you were tracing over is not
kept.

Opening the same symbol again, or a new symbol in the same note, asks **Restore
the unsaved drawing?**, with the time the draft was kept:

- **Restore** puts the drawing back as it was, name included;
- **Discard** drops the draft;
- **Not now** keeps it, to be offered next time.

If the symbol was saved again since the draft was kept, the question says that
its strokes may not line up. A draft not restored within 30 days is dropped. If
the local storage refuses a draft, as when it is full, a notice says so, and the
last draft kept stays; save the symbol to keep the changes.

A new symbol's first save that was cut short, or whose embed could not be
inserted, is finished when you restore its draft: with the file it had made, if
nothing changed that file since, and with the embed, unless the note has it
already.

## When the file changes while the editor is open

The editor follows its symbol's file while it is open, so that a change made
elsewhere, by sync, another app, or another editor, is not lost to a save:

- With nothing unsaved, the editor takes in the change and says "Reloaded".
- With something unsaved, it asks whether **The symbol changed on disk**:
  **Reload** takes in the change, and Undo brings your drawing back while the
  editor is open; **Keep mine** keeps your drawing, and saving it replaces the
  change.
- Each save checks the file first, and asks the same question if it changed.
- A symbol whose file was deleted while it was open is saved again where it was,
  folder and all.
- A rename made elsewhere is followed, and its name kept.

## Files Inkline cannot read

- **A symbol saved by a newer version of Inkline** opens with a notice to update
  Inkline instead of in the editor, so that this version never saves over what
  it does not understand.
- **A file that changed on disk to something this version cannot read** is never
  saved over: the editor says so, and keeps your drawing open.
- **A file that is not a valid PNG** does not open, and a notice says why.

## Pictures without strokes

A `.ink.png` file whose strokes are missing opens as a picture: its pixels
become the symbol's base layer, at their own resolution, scaled in proportion to
the line's height, and the pen and eraser act on it. Its transparency, or for an
opaque picture its darkness, becomes the ink, in the text's colour like any
other. That happens with files from other programs, with files whose strokes an
image optimiser or a sync tool stripped out, and with symbols from Inkline's
earlier prototype, whose white background becomes transparent. Saving one stores
strokes again from then on.
