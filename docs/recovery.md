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
only renames a symbol, since links follow a rename. The count is Obsidian's link
index: a note or canvas that Obsidian has not indexed yet is missing from it.

## Drafts after a crash

After each finished stroke, undo, redo, or clearing, and each change of name,
the editor keeps a draft of the drawing in the vault's local storage, which
Obsidian keeps on your computer for that vault. Closing Obsidian or a crash then
loses at most a stroke still being drawn, and turning Inkline off loses nothing:
it ends the stroke and keeps the draft. If Obsidian is still renaming the symbol
you saved as you turn Inkline off, as while it asks about links, the draft
follows the rename once Obsidian finishes it, with its own copy of any picture
you drew over, and the time it was kept. A picture you were tracing over is not
kept.

Opening the same symbol again, or a new symbol in the same note, asks **Restore
the unsaved drawing?**, with the time the draft was kept:

- **Restore** puts the drawing back as it was, name included;
- **Discard** drops the draft;
- **Not now** keeps it, to be offered next time.

A symbol's draft that would bring back nothing its file lacks, the same strokes,
picture and name, with nothing typed in its readings and translations, is
dropped as the symbol opens, without the question.

If the symbol was saved again since the draft was kept, the question says that
its strokes may not line up. A change to its readings or translations alone
leaves the strokes where they were, so the question says nothing of them; if the
draft holds text you typed, it says to look that over before saving. A draft not
restored within 30 days is dropped. If the local storage refuses a draft, as
when it is full, a notice says so, and the last draft kept stays; save the
symbol to keep the changes.

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
  That includes a save from the library, which waits for one from the editor,
  and the other way round. The last moment before a write is
  [a known limit](./limits.md#a-file-written-at-the-moment-inkline-saves).
- A change to a symbol's readings or translations alone, as from the library or
  by sync, changes nothing about the drawing, so the editor asks nothing and
  takes it in: your strokes, unsaved or not, and Undo stay as they are, and the
  fields follow the file. This holds for a save too, which goes on with the new
  text.
- A field you have typed in keeps what you typed, as nothing could bring that
  back. If the file changed that field too, the fields open and say what saving
  replaces, and the file keeps its value until you save. A save that finds such
  a change only as it starts writes nothing, so that you see what it would
  replace; save again to replace it.
- When the drawing changed too, the question comes up as above, and it mentions
  a field you typed in that the file changed: **Keep mine** keeps what you
  typed, and **Reload** takes the file's. A field you typed in that the file
  left alone stays as you typed it either way.
- A symbol whose file was deleted while it was open is saved again where it was,
  folder and all.
- A rename made elsewhere is followed, and its name kept.

## Files Inkline cannot read

- **A symbol saved in a newer version of the file format** than this Inkline
  reads opens with a notice to update Inkline instead of in the editor, so that
  this version never saves over what it does not understand. A symbol that a
  later Inkline saved in a format this one reads opens as usual.
- **A symbol whose strokes cannot be read**, because the file was damaged or a
  program wrote them wrongly, does not open either, and a notice says so, so
  that saving never replaces strokes that might still be recovered. It still
  shows in notes. To go on from what it shows, use
  [Copy from](./drawing.md#start-from-a-copy) in a new symbol, which leaves the
  file as it is.
- **A file that changed on disk to something this version cannot read** is never
  saved over: the editor says so, and keeps your drawing open.
- **A file that is not a valid PNG**, as one cut short by a failed copy, does
  not open, and a notice says why.
- A symbol whose image is damaged, but whose strokes are whole, opens as usual,
  and saving it draws the image again.

## Drafts whose symbol is gone or does not open

The editor offers a draft only when it opens a symbol at the path the draft was
kept for. Drafts follow a rename that Obsidian makes while Inkline is on. A
draft stays unseen when its symbol's file then stops opening, as one cut short
by a crash while it was saved, and when the file is renamed or deleted in a way
Inkline does not see, as while it is off. **Unreleased:** when a symbol does not
open because its file is not a valid PNG or its strokes cannot be read, the
notice says so if a draft of it is kept.

A draft not restored within 30 days is dropped. To get one back before then:

- **A symbol renamed or moved while Inkline was off:** rename it back to the
  name and folder it had, then open it, and choose **Restore**.
- **A symbol that does not open, or was deleted:**
  1. Move its file out of the vault, if you might want what it holds, or delete
     it.
  2. Start a new symbol, draw anything, such as a dot, type the file's name, and
     save it. If it is saved in another folder, move it to the folder the file
     was in, as in Obsidian's file explorer. Its save puts its embed where you
     started it: delete that if the note did not need it.
  3. Open the new symbol. It asks **Restore the unsaved drawing?**, and says
     that the symbol was saved again since the draft was kept. Choose
     **Restore**, which puts the draft's drawing in place of what you drew, and
     save.

The draft brings back its strokes, and any name, readings, and translations you
had typed. A base layer, the picture to draw over, comes back only if the draft
kept its own, as when it had changed since the symbol was last saved: otherwise
the draft used the file's, which the new symbol does not have.

## Pictures without strokes

A `.ink.png` file that holds no strokes opens as a picture to draw over, and the
editor's status line says so. Its pixels become the symbol's base layer, at
their own resolution, scaled in proportion to the line's height, and the pen and
eraser act on it. Its transparency, or for an opaque picture its darkness,
becomes the ink, in the text's colour like any other. Saving one stores strokes
again from then on. Until then the file stays as it was.

That happens with:

- every symbol saved by a version before 0.9.2, as the file format became final
  in that release, and Inkline does not read the strokes of earlier files. They
  look as they did and stay in your notes, but their strokes can't be edited one
  by one. Draw over the picture, or draw the symbol again;
- files from other programs;
- files whose strokes an image optimiser or a sync tool stripped out.
