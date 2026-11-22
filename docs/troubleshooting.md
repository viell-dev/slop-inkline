# Problems and reports

## Common problems

**A symbol shows as a large grey picture.** Inkline is off, or did not load:
check that it is turned on under **Settings → Community plugins**. Inkline shows
only images from the vault whose file names end in `.ink.png` as characters; any
other image stays a picture. A symbol file opened in its own tab stays a picture
too.

**Insert symbol is not in the command palette.** It needs a note open in editing
view, Live Preview or source mode, where there is a cursor to insert at; Reading
view has none.

**Edit symbol is not offered.** The command needs the cursor on a symbol's
embed, outside code and front matter. A right-click on the symbol itself offers
it, as [Edit a symbol](./notes.md#edit-a-symbol) lists.

**a double-click on a symbol opens Obsidian's image viewer.** In Reading view,
embedded notes, hover previews, and a focused canvas card, a click on any
picture opens the viewer before a second click can make a double-click.
Right-click the symbol and choose **Edit symbol**, or double-click it in Live
Preview.

**Typing the insert trigger lists nothing.** The list does not open in code or
front matter, nor when a space follows the trigger straight away. Code is where
Reading view shows it, which can differ from how the editor colors it: a pair of
backticks makes code across the lines of a paragraph, but not from a callout's
title line into the callout. **Unreleased:** nor does it open in a `$$` math
block, and in a list item, how far a line is indented counts as Reading view
counts it, as [Insert a symbol you have](./notes.md#insert-a-symbol-you-have)
says. With no symbols in the vault yet, the trigger shows nothing, and
**Inkline: Insert existing symbol** says so. Typed with a space, a name matches
only symbols whose names hold what you typed.

**A table comes apart at the key after a symbol.** In Live Preview, if the text
of a table cell ended in a space when you inserted a symbol there with
**Inkline: Insert existing symbol** or from the editor, the next key garbles the
table. It is Obsidian's. Undo at once, then leave the note and come back before
you type in the table again, as [Known limits](./limits.md#in-general) says.

**"… was saved by a newer version of Inkline."** The symbol is in a newer
version of the file format than this Inkline reads. Update Inkline, as
[Install](./install.md#update) describes; this version will not edit the symbol,
so that it never loses what the newer one stored.

**"This symbol has unsaved changes from a newer version of Inkline …"** A newer
version of Inkline kept a draft of the symbol, which this version cannot read,
as after you went back to this version from that one. The draft stays as it was:
update Inkline to get it back, as
[Drafts from a newer version](./recovery.md#drafts-from-a-newer-version) says.

**"… Unsaved changes to it are kept as a draft. To get them back, …"** The
symbol did not open, as its file is not a valid PNG or its strokes cannot be
read, and the editor had kept a draft of it, as when a crash cut short a save.
[Drafts whose symbol is gone or does not open](./recovery.md#drafts-whose-symbol-is-gone-or-does-not-open)
says how to get the draft back. **Unreleased:** opening such a symbol asks
**Open the unsaved drawing as a new symbol?** instead. The notice comes only if
another window opened while the symbol was read, so that the question does not
take the keys from it, and then says to run **Inkline: Recover drafts**, which
lists the draft.

**"No draft is waiting for a symbol that is gone or does not open …"**
**Unreleased:** **Inkline: Recover drafts** found nothing to list. A symbol that
opens offers its own drafts when you open it, one renamed while Inkline was off
offers its draft once you rename it back, and a new symbol started in a note
that is still there offers its draft when you start a new symbol in that note.

**"The unsaved drawing was not opened, as the editor was in use while it was
read. …"** **Unreleased:** a draft opened as a new symbol keeps a picture to
draw over, which takes a moment to read, and the editor was saved, closed, or
asked something meanwhile. The draft is still kept, as it was: run **Inkline:
Recover drafts** to open it again.

**"The unsaved drawing's base layer cannot be read, so only its strokes came
back."** **Unreleased:** a draft opened as a new symbol kept a picture to draw
over, which the vault's local storage no longer holds whole. The strokes are in
the editor, without that picture. The draft keeps the picture, should it be read
another time, until a save starts writing the new symbol.

**"Opened as a picture to draw over, as this file holds no strokes …"** The file
holds a picture but no strokes to edit, as every symbol saved before 0.9.2 does.
Nothing is wrong with it, and it looks as it did;
[Pictures without strokes](./recovery.md#pictures-without-strokes) says what you
can do with it.

**"Could not save the symbol: …"** The reason follows the colon, such as a name
refused or a file that could not be written. The editor stays open with the
drawing, which is also kept as a draft: fix what the notice says, and save
again.

**"Waiting for Obsidian to finish writing a file."** A save of a symbol has
taken more than a few seconds, usually because a drive has stopped answering.
Saving goes on by itself if Obsidian finishes. If nothing changes, restart
Obsidian:
[what you drew or typed](./limits.md#a-file-written-at-the-moment-inkline-saves)
is kept in different ways in the editor and the library.

**"Waiting for Obsidian to finish renaming a file."** A rename from the library
has stopped for more than a few seconds, usually because a drive has stopped
answering. It goes on by itself if Obsidian finishes, and **Cancel** or Esc
close the row meanwhile. If nothing changes, copy the name you typed and restart
Obsidian, then
[check the notes that use the symbol](./limits.md#a-file-written-at-the-moment-inkline-saves).

**"The readings and translations of … were not saved: …"** The library's row
closed before its save was done, as when Inkline is turned off or the library is
closed while the save waits, and the reason says why it was not written. Open
the symbol's readings and translations in the library again, and save them once
more. A rename that the library had not yet handed to Obsidian when Inkline was
turned off, even one waiting for Obsidian to finish another rename, says "…
could not be renamed to …: Inkline was disabled" the same way, at once, and
renames nothing.

**"The readings and translations are saved, but the symbol was not renamed:" in
Quick edit.** The reason follows on the next line. The library wrote the
readings and translations you typed, and then could not rename the symbol, for
that reason. The name you typed stays in the row: deal with the reason, and
**Save** again, which tries only the name. When something came between the
rename and Obsidian, the row says only that they are saved, and the next line
says what happened and where the symbol is now. A notice says the same, as
"Saved …. … could not be renamed to …: …", if the row had closed by then, and
"Saved …. It was not renamed." if you closed the row while the rename waited.

**"Nothing was renamed." in Quick edit.** The readings and translations could
not be written, for the reason on the line above, so the library did not go on
to the new name. Both stay in the row: deal with the reason, and **Save** again.
A notice says the same, as "The readings and translations of … were not saved,
and it was not renamed to …: …", if the row had closed by then.

**"… the file was deleted or replaced as it was written, so what is at its path
may hold this save"** The symbol's file was deleted, or another file put at its
path, while Obsidian wrote this save, so the save may be in the file now at that
path. What you drew or typed is still in the editor, or in the library's row.
Look at the file at that path, and at your sync tool's history for what was
there, then save again or close without saving.

**"… is saved, but was not inserted, as the note it was for, …, was deleted."**
The note you started the symbol in was deleted while you drew, as by sync or on
another device. The symbol is saved in its file: insert it where you want it
with **Inkline: Insert existing symbol** or the
[insert trigger](./notes.md#insert-a-symbol-you-have).

**"No next symbol was started, as the note it was for, …, was deleted."** You
pressed **Next** after the note you were drawing symbols into was deleted, as by
sync or on another device. The symbol you were on is saved; there is no note for
the next one to go into.

**"… is saved, but could not be renamed: …"** The drawing is saved under the old
name, and the new name stays in the editor's name field, for the next save to
try again. When the reason is that a note could not be saved first, Obsidian
says why too. Nothing was renamed, and the note keeps its text in its editor:
deal with what stopped the save, and save the symbol again.

**"Check the symbol's embed in …: it may still have the old name."** The symbol
was renamed, but the note's editor had not taken the new name five seconds
later, as on a very slow disk. Inkline leaves the note's text alone. Look at the
embed in that note, and if it still has the old name, change it by hand.

**"The note changed where the symbol was going, so it was added at the end of
…"** The text around the place where you started the symbol changed too much to
be found again. The symbol is at the end of that note; move its embed where it
belongs.

**"Inkline could not keep a draft of the latest changes …"** The vault's local
storage refused the draft, as when it is full: save the symbol to keep the
changes. If the notice says the changes take the drawing past what a symbol can
hold, saving refuses too: undo them, and see
[Known limits](./limits.md#files-and-sizes).

**A symbol has the wrong colour or size.** A theme or a CSS snippet can change
how images in text look. [Rendering in notes](./rendering.md) describes the
classes and properties Inkline gives symbols, for theme and snippet authors.

## Report a problem

Search the
[open and closed issues](https://github.com/viell-dev/slop-inkline/issues?q=is%3Aissue)
first, then open a
[bug report](https://github.com/viell-dev/slop-inkline/issues/new?template=bug.yml).
Only what happened is required. Anything else you can give helps find the cause
sooner:

- the steps that led to it, from a new vault or note if you can, with any theme
  or other plugin the problem needs, and what you expected instead;
- the Inkline version, or for a development build the commit it was built from,
  which `git rev-parse --short HEAD` prints in its folder;
- the Obsidian version and installer version, both under **Settings → General**,
  and your operating system;
- what you draw with: a mouse, a trackpad, or another pointer;
- any message, a screenshot, or a `.ink.png` file that shows the problem.

Use synthetic examples only, and leave private notes and drawings out of every
report.

Ask a question with the
[question form](https://github.com/viell-dev/slop-inkline/issues/new?template=question.yml),
and suggest a feature with the
[feature form](https://github.com/viell-dev/slop-inkline/issues/new?template=feature.yml).
Report a vulnerability privately, as the
[security policy](https://github.com/viell-dev/slop-inkline/blob/main/SECURITY.md)
describes, never in a public issue.
