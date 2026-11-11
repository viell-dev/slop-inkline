# Known limits

What Inkline does not do yet, or does not do everywhere, and what to do instead.
The [issues](https://github.com/viell-dev/slop-inkline/issues) track each one.

## Not there yet

- **Prerelease.** Install from GitHub releases, by hand or with BRAT; Inkline is
  not in Obsidian's community directory yet. See [Install](./install.md).
- **Desktop only.** Obsidian's mobile apps do not offer Inkline. The host tests
  run on Linux; Windows and macOS should work but are not tested.
- **Mouse or trackpad.** A drawing tablet's pen or a touchscreen draws as a
  mouse does: pen pressure and a pen's eraser end are not supported.
- **Large libraries** show 100 symbols at a time, with **Show more** for the
  next 100. Filter them, or choose a folder, to narrow the list.
- **Library insertion needs a sidebar.** If the library's tab is dragged into
  the main area, move it back to a sidebar to insert into a note.
- **Physical printing** has not been checked. Native
  [PDF export](./notes.md#export-a-note-to-pdf) is verified on Linux.

## Links Obsidian writes

With **Use \[\[Wikilinks\]\]** off, Obsidian writes Markdown links, and leaves a
`%` or an unbalanced parenthesis in a file name as it is, so that such a link
can lead nowhere or to another file
([#35](https://github.com/viell-dev/slop-inkline/issues/35)). Inkline checks
every embed it inserts: it writes such a `%` as `%25`, and names a symbol whose
link would still lead elsewhere by its path in the vault.

## A file written at the moment Inkline saves

Inkline's own saves of symbols go one at a time, whether from the editor or the
library, and each reads the file first, so that two of them cannot undo each
other, even if the file is renamed or replaced while one waits. It also means
that a save Obsidian never finishes, as on a drive that stops answering, holds
up every later save, whichever symbol it is for. After a few seconds of that,
the editor and the library's fields say so, and saving goes on by itself if
Obsidian finishes. A save is never let go of early, as Obsidian could still
finish it, over whatever a later save had written. If nothing changes, restart
Obsidian, which ends the wait:

- **In the editor,** your strokes are safe in a draft. Open the symbol again, or
  start a new symbol in that note if it had not been saved yet, and choose
  **Restore**.
- **In the library's fields,** what you typed stays there, and you can select
  and copy it. Copy it before you restart, as a restart does not keep it.
  **Cancel** or Esc closes the fields and stops the save. Only a save that had
  already reached Obsidian can still finish, and a notice says so.

A rename is not in that line, so a save never waits for one, and it is told
apart differently, as it can rightly take a long time: Obsidian's question about
links stays open for as long as you like, and it then updates each note that
links to the symbol, which takes a few seconds for every thousand notes. So only
a rename where nothing happens for a few seconds, with no question open, says it
is waiting for Obsidian, and the message goes if it moves again. If nothing
changes, restart Obsidian:

- **In the library,** the name you typed stays in the row to copy, as a restart
  does not keep it. **Cancel** or Esc closes the row, and stops the rename if
  Obsidian has not begun it yet. One it has begun can still finish, and a notice
  says so, and says again when it ends, whether it worked or not. Until then
  another rename of that symbol is refused, and says why.
- **In the editor,** the drawing is saved by then, and the name is in the draft.
- **Obsidian moves the file before it updates the links.** A restart while it
  updates them leaves the notes it had not reached with the old name, whose
  embeds no longer find the symbol.

Inkline cannot do the same with another program. Obsidian writes a binary file
only as a whole, with no way to write it only if it has not changed since it was
read, so a sync tool that writes the file in the moment between Inkline's last
read and its write can have that change replaced. Inkline keeps that moment
short, with the read straight before the write, and it does not rule it out. A
change made before that read is noticed: the editor asks, and the library shows
it. Your sync tool's own history is the way back from a change lost like this.

## A file changed as Obsidian renames it

**Unreleased:** Obsidian moves a file by its path, without checking that the
file there is still the one it was asked to rename, and its rename can first
wait a while, for its index of the vault and for any other rename. So Inkline
waits for those itself before it checks the symbol for the last time, and
Obsidian begins to move the file in the same step as that check. Inkline learns
what Obsidian is waiting for from Obsidian's own state, which its plugin API
does not include ([#10](https://github.com/viell-dev/slop-inkline/issues/10)).
With a version of Obsidian that keeps it otherwise, Obsidian waits after the
check, as it did before, and it can then say a rename is done before it has made
it, which Inkline reports as a name that may still change.

Some changes can still reach the file between the check and the move: one that
Obsidian had already begun to write to the disk, and one made outside Obsidian
at that moment, as by a sync tool. If anything is deleted, created, or renamed
at the symbol's path or its new one before Obsidian has moved it, Inkline says
what happened and where the symbol is now, rather than closing the library's row
or saying only that the editor saved. Obsidian may by then have given the new
name to another file at the old path, or moved the symbol away from a name given
elsewhere, and Inkline cannot stop a move Obsidian has begun: look at both names
in the library before going on.

## Renames and Obsidian's question

When a file is renamed, Obsidian notes where the links to it are, asks whether
to update them, and after your answer writes at those places without checking
what is there now. If a note changed in between, the new link goes over other
text, which is lost. A note's own save, two seconds after an edit, is enough.
Obsidian does this with any file
([#10](https://github.com/viell-dev/slop-inkline/issues/10)).

Inkline's own renames save every open note first, which leaves that save nothing
to do, and refuse to go on if one cannot be saved
([#182](https://github.com/viell-dev/slop-inkline/issues/182)). **Unreleased:**
a note typed in while the others are being saved is saved again before the
rename starts. What stays out of Inkline's reach:

- **Text that arrives during the question,** from another window or a plugin, if
  the note saves itself before you answer. Answer the question first.
- **Renames outside Inkline,** as in Obsidian's file explorer, which save
  nothing first. Use the library or the symbol's editor to rename a symbol while
  its notes are open, or close them.
- **Notes edited inside a Canvas card,** which Inkline cannot reach to save.
- **A disk that stalls for seconds.** Obsidian's own save can then meet its
  reload of the same note and take unsaved text out of the editor, with no
  symbol involved. After a rename by Inkline the text usually comes back once
  the file has been read again, and if the note has still not settled after five
  seconds, a notice asks you to check the embed. If a read held up by the stall
  lands last, the text leaves the editor for good, with no notice. The file
  still holds it then, until the next save, so if lines vanish after a stall,
  undo or reopen the note before typing.

A note that starts with a byte order mark, which Obsidian does not support, has
any rename's links written one character early, which loses the character before
each one ([#185](https://github.com/viell-dev/slop-inkline/issues/185)). Remove
the mark before renaming what it links to.

## Files and sizes

- A symbol is at most 4096 pixels wide, 32 times the height of its text.
- **A symbol saved before 0.9.2 keeps its look but not its strokes.** The file
  format became final in that release, and no later version reads the strokes of
  earlier files. The symbol stays in your notes and opens as a
  [picture to draw over](./recovery.md#pictures-without-strokes).
- Tools that change or recompress a symbol's image can drop the strokes it
  keeps, leaving a picture; see
  [Without Inkline](./without-inkline.md#editing-them-elsewhere).
- A symbol holds at most 250,000 points across its strokes, erased ones
  included. That is minutes of unbroken drawing with the fastest mice. Saving
  past it fails with a message, and the draft stops at the last stroke within
  it, so undo what took the drawing over.
- Saving a symbol with a large base layer from the editor takes two or three
  seconds near the limit, and Obsidian keeps answering all through it. A symbol
  drawn by hand takes milliseconds. What remains is a pause of up to about a
  quarter of a second just after you ask to save, while Inkline keeps a copy of
  the base layer for a draft, in one write that it cannot divide
  ([#200](https://github.com/viell-dev/slop-inkline/issues/200)).
- Opening such a symbol in the editor takes a second or two near the limit.
  Obsidian keeps answering while Inkline reads it, and a notice says that it is
  opening. The longest pauses left are about a tenth of a second, up to a
  quarter at worst, in single steps that Inkline cannot divide, such as hashing
  the file ([#202](https://github.com/viell-dev/slop-inkline/issues/202)).
- **Unreleased:** a draft keeps only the base layer its drawing uses now. Undo
  or Redo past a Copy from, a Make ink, or a picture you chose stores that
  step's base layer again, which takes a moment for a large one. If Obsidian's
  storage is nearly full, it can then refuse the draft, and a notice
  [says so](./troubleshooting.md#common-problems): save to keep the changes.
- A symbol file made to be slow to draw, by a stroke that turns back at nearly
  every point, can keep Obsidian busy for a long time when you open it in the
  editor, hours for the worst of them, from a file of a few kilobytes. Close
  Obsidian if it stops answering: no file has changed, and the note shows the
  symbol as before. Drawing by hand does not come near this.
- The lists find a symbol by its readings and translations a moment after
  Obsidian starts, and a few seconds after in a vault of thousands of symbols,
  as they are read in the background each time; a line in the list says so
  meanwhile. Names work from the start. A file of over 32 MiB, or with more than
  16 chunks of one keyword before a usable one, as a file made to be slow to
  read has, is found by its name only. Its text still shows in the library's
  fields.
- A list of readings or translations that Inkline cannot read, as from a later
  version, stays in the file, behind any you type, and looks empty. Inkline
  offers no way to remove one.
- A symbol's readings and translations go with its file, and only there. Some
  image programs drop them; a long list in a non-Latin script was lost through
  two plain ImageMagick copies, while short text came through.
- A picture to trace over is scaled down to 4096 pixels on its longer side. A
  file opened from its pixels can be up to 4096 pixels a side, and its ink must
  fit within 8 MiB, the largest base layer a symbol can store.
- **Make ink** of a picture with transparency, shown larger than its own pixels,
  keeps the soft edges of that transparency: they spread across each enlarged
  pixel, while an opaque picture's edges stay sharp
  ([#96](https://github.com/viell-dev/slop-inkline/issues/96)).
- **Make ink** cannot bring back what a picture has lost. A thin stroke with
  soft edges, as in a small screenshot, comes out wider than it was drawn: about
  a third wider for a stroke 2 pixels wide with a pixel of softness. Move the
  threshold towards the stroke's own tone to thin it. A stroke thinner than its
  softness also follows the picture's pixels, so that a straight line wavers
  slightly when enlarged many times. Draw over it, or trace it by hand, where
  that shows.
- **Make ink** chooses the threshold's first position from the picture alone,
  which cannot say what you want traced. A small bright element can draw it away
  from dim strokes, leaving them no ink: move the slider down to the strokes, or
  move the picture to keep the element out
  ([#147](https://github.com/viell-dev/slop-inkline/issues/147)).
- **Make ink** counts a capture of a window with transparent corners or a shadow
  as a transparent picture, so it can start with the ink inverted: the window's
  ground as the ink, and its strokes as holes. Press **Light ink** to swap them,
  then set the threshold with the slider, which cannot swap them by itself. Its
  edges can stay softer than an opaque picture's. With dark ink, a shadow stays
  as faint ink around the window at any threshold that keeps the strokes: bring
  only the inside of the window into view. A capture without transparency has
  neither limit ([#148](https://github.com/viell-dev/slop-inkline/issues/148)).
- Images from outside the vault are left as they are, even when their names end
  in `.ink.png`.
