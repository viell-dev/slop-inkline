# Changelog

Notable changes to Inkline, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers are
plain `x.y.z` from 0.9.0 on, where an odd minor version is a pre-release and an
even one a public release; earlier pre-releases carry a suffix such as
`-alpha.N`. Each release's section is also its
[GitHub release](https://github.com/viell-dev/slop-inkline/releases)'s notes.

## Unreleased

### Changed

- A path no longer becomes ink as soon as it ends. Ending it, with Enter or a
  click on its last point, or closing it on its first point, leaves it waiting,
  open or closed, with no curve following the pointer, for its points and
  handles to be dragged until it looks right; a click then places nothing, and
  nothing else is drawn meanwhile. Enter again, or the new **Finish path**
  button, makes it ink; the button also does while the path is still being
  placed. Undo takes back each adjustment, then the ending itself, back to
  placing the path. Choosing another shape, saving, and **Next** make a waiting
  path ink as they do one being placed, and Esc drops it. Paths are still saved
  as ordinary strokes
  ([#476](https://github.com/viell-dev/slop-inkline/issues/476)).

### Fixed

- A draft opened as a new symbol, from **Inkline: Recover drafts** or a symbol
  whose file does not open, whose first save was refused, as for a name typed
  that another symbol came to as it was saved, stayed kept for that other
  symbol, which then offered it as its own when it opened. Now the draft stays
  the old symbol's, as before the save, for the next save to make the file
  ([#437](https://github.com/viell-dev/slop-inkline/issues/437)).
- On Windows and macOS, a deleted symbol whose folder was there again in another
  letter case, as `signs` for `Signs`, stopped every save that made it again
  with Obsidian's "Folder already exists." Now it is saved in that folder, which
  those systems read as the same one. A file of its name already there, as after
  the folder's letter case was changed outside Obsidian, is the file at its
  path: written over if it holds what the editor last saved, and asked about
  otherwise, as any change is
  ([#436](https://github.com/viell-dev/slop-inkline/issues/436)).
- **Make ink**, **Zoom**, and **Fit** pressed while **Move** drags the picture
  now wait until you let go, as they do while you draw. They acted at once: Make
  ink's row, opening above the drawing area, or a zoom, changing its height,
  moved the drawing under the pointer, and the picture ended that far from where
  you put it. Make ink's row also stays until you let go, during a drag or a
  stroke, when Make ink closes for another reason, as when a picture pasted then
  replaces the one it was open for
  ([#444](https://github.com/viell-dev/slop-inkline/issues/444)).
- A picture dragged with **Move** now comes back under the pointer as you go on
  or let go when the drawing moves under the pointer during the drag, as when
  Obsidian's page zoom or the window's size changes. It used to move with the
  drawing and stay that far from the pointer, and a page zoom could also make it
  jump. **Readings and translations** opened or closed while you draw a stroke
  now ends the stroke where it showed, as a change to the window's size does,
  rather than moving the drawing under the rest of it
  ([#445](https://github.com/viell-dev/slop-inkline/issues/445)).

## 1.1.0 - 2026-11-22

This is the first pre-release since 1.0.0, an alpha of 1.2.0, the next public
release. Features can still arrive and change in this line until a goal for
1.2.0 is agreed. Its main new feature is **Path**, for curves placed by their
points; the owner is asked to try it, with two smaller changes, in
[the test request](https://github.com/viell-dev/slop-inkline/issues/446), which
1.2.0 waits for.

Obsidian does not offer pre-releases: it goes on offering 1.0.2 from the
community plugins. To try 1.1.0, best in a vault of its own, install
`inkline-1.1.0.zip` from this release's assets by hand, or choose version
`1.1.0` in BRAT, as
[the install guide](https://viell-dev.github.io/slop-inkline/install) says.
BRAT's **latest** choice moves to it by itself. To go back, install 1.0.2 the
same way.

The file format is unchanged: a symbol saved with 1.1.0, with paths or without,
opens in 1.0.0 to 1.0.2, and drafts keep the layout that every release from
0.9.2 on uses.

### Added

- A draft kept for a symbol whose file is gone or does not open, as one cut
  short by a crash while it was saved, or deleted or moved while Inkline was
  off, can be opened as a new symbol, which used to take a long way round
  through the guide. Opening such a symbol asks **Open the unsaved drawing as a
  new symbol?**, and **Inkline: Recover drafts** lists such drafts, other than
  one that a symbol's editor has open, with a picture of each, where it was kept
  for, and when. The new symbol starts with the draft's strokes, name, readings
  and translations, and any picture to draw over that the draft kept itself; its
  first save makes a new file in the old one's folder, inserted into no note,
  and leaves a file that does not open as it is. Drafts that a newer version of
  Inkline kept are left as they are
  ([#298](https://github.com/viell-dev/slop-inkline/issues/298)).
- **Inkline: Recover drafts** also lists a new symbol's draft whose note is
  gone, which only a new symbol started in that note offered. It opens as a new
  symbol, inserted into no note, where new symbols go; if its first save had
  made a file, saving writes over that file while it holds what that save wrote,
  and otherwise leaves it as it is and makes another
  ([#390](https://github.com/viell-dev/slop-inkline/issues/390)).
- **Path** (A) in the editor places a curve by its points, for curves that are
  hard to draw steadily with a mouse, such as a quarter circle or an S
  ([#340](https://github.com/viell-dev/slop-inkline/issues/340)). Click for a
  corner, or press and drag for a smooth point, whose handle sets the curve's
  direction there. While the path is placed, a point or a handle's end can be
  dragged to move it, and Undo takes back the last point or drag. A click on the
  first point closes the path, a click on the last or Enter ends it, and Esc
  drops it. Shift puts points and handles' ends on the grid, **Toggle fill**
  fills a closed path, and **Flat ends** cuts its ends on the grid as it cuts a
  freehand stroke's. Once it ends, a path is ordinary ink: it is saved as a
  stroke along the curve of a kind the file format already has, so a symbol with
  paths opens and looks the same in earlier versions of Inkline.

### Changed

- A symbol saved without a name passes over a number that a note still links to,
  so a note that embeds a deleted symbol no longer shows the next new symbol in
  its folder in its place. A link counts as Obsidian would resolve it, once
  Obsidian has read the note's links after opening the vault
  ([#299](https://github.com/viell-dev/slop-inkline/issues/299)).

### Fixed

- Typing the insert trigger no longer opens the list where Reading view shows
  code, or nothing, in four kinds of note
  ([#271](https://github.com/viell-dev/slop-inkline/issues/271)). In a list
  item, a line indented less than the item's text, before or after the place,
  makes Reading view take fewer columns from all of the item's lines, which can
  make code of lines that looked like text, or end a fence or a heading
  elsewhere; the list now follows it in every item that holds the place, where
  it followed only a later line in the innermost one. A footnote's text is read
  as Reading view shows it at the note's end, as a note of its own, so a fence
  in it makes code, as does indenting its first line by eight columns after the
  label, and a `<code>` that the rest of the note or another footnote leaves
  open makes all of it code; it ends where Reading view ends it, at a definition
  only where one reads in full, and before a line over an underline. A `$$` math
  block lists nothing, where an embed shows nothing, and where math has an error
  that shows its text. And a line of seven spaces under `1. a` and a blank line,
  which Reading view shows as text, lists again: an item numbered 0 to 9 with a
  `.` whose text starts an odd number of columns in loses a column more from its
  later lines. A callout's title after a task's box, as in
  `- [ ] > [!note] title`, is read as the title, where the box was taken for its
  start. The few notes still read otherwise, such as link reference definitions
  over more lines, are in
  [#435](https://github.com/viell-dev/slop-inkline/issues/435). Rare, unusual
  layouts may still open the list where Reading view shows code, in far fewer
  notes than before.
- A polygon drawn with a large brush showed a faint, lighter line inside its ink
  at a corner, where the parts the line is drawn in meet, and a filled polygon
  showed it outside the fill. It no longer does. The shape is the same, and so
  is the file format: a symbol saved before keeps the line in its image until it
  is saved again ([#368](https://github.com/viell-dev/slop-inkline/issues/368)).
- Typing straight after saving a new symbol keeps its letters in order. As the
  editor closes, Inkline puts the cursor back after the symbol, in case the note
  changed while you drew, and gives the note the focus if nothing has it, as
  when a change on disk took a table cell's editor away. It did both a moment
  later, and on a busy computer that moment could come after your first key: the
  second key then went in front of the first, so `xy` became `yx`, and a click,
  a shortcut, or a paste had its cursor moved after it. In a table cell whose
  editor a change on disk took away, the first key went nowhere. Now both happen
  as the editor closes, before any key
  ([#387](https://github.com/viell-dev/slop-inkline/issues/387),
  [#429](https://github.com/viell-dev/slop-inkline/issues/429)).
- A symbol's file replaced while the editor saved it, deleted and another put at
  its path through Obsidian, as by another plugin or a sync tool working through
  it, could have the save find no file, go to make it again, and stop with
  Obsidian's "File already exists." Now the save looks at the new file, says
  "Not saved: the file changed on disk", and asks about it, as it does when it
  finds the new file first. Nothing was written over the new file unasked,
  either way. A save that makes a deleted symbol's folder again no longer stops
  with "Folder already exists." when the folder comes back meanwhile: it saves
  into it ([#379](https://github.com/viell-dev/slop-inkline/issues/379)).
- A save that made a symbol's file, the first save of a new symbol, or of a
  draft opened as one, or a save that made a deleted symbol again, could write
  over a file that another plugin or a sync tool asked Obsidian for in the
  moment after Obsidian's check of the path and before its write, without a
  question. Now the save writes the symbol first to a file of Inkline's own,
  which the vault does not list, and has Obsidian copy it into place, which
  makes the file only where nothing is and checks that as it makes it. A file
  that comes meanwhile, through Obsidian or from a program outside it, is left
  as it is: for a deleted symbol, the editor asks about it, as about any change
  ([#413](https://github.com/viell-dev/slop-inkline/issues/413)).
- A new symbol's first save stopped with Obsidian's "File already exists." when
  a file came to its path as it was made. Now a numbered symbol takes the next
  free number, and a name typed for it is refused as one already taken
  ([#388](https://github.com/viell-dev/slop-inkline/issues/388)).
- On Windows and macOS, a file whose name differs from a deleted symbol's only
  in letter case stopped every save that made the symbol again with Obsidian's
  "File already exists." Now the editor names that file, and says to rename or
  move it. After a save that could not make a deleted symbol again, the status
  line keeps saying why, where it went back to "The file was deleted; saving
  makes it again"
  ([#414](https://github.com/viell-dev/slop-inkline/issues/414)).
- When a save's own write stopped part-way, as on a full disk, the part left
  could not be read, and the editor then refused every save until the file was
  deleted by hand, with nothing saying that it was what was left of its own
  save. Now a save that makes a symbol's file leaves nothing at its path when
  its write stops, and a save of a symbol whose file is there says what the part
  left is, and the next save writes the whole symbol over it, however many times
  in a row a write stops: that part holds only the start of what the save writes
  ([#425](https://github.com/viell-dev/slop-inkline/issues/425)).
- Ink shows under the pointer that draws it when a theme or a CSS snippet gives
  the drawing area padding, which Inkline's own styles do not. The ink landed
  away from the pointer by the padding, and the brush's circle was the wrong
  size and showed over the padding too. Now the drawing fills the area inside
  the padding, the pointer is mapped from there, and the brush's circle shows
  only there, at the size the brush draws
  ([#378](https://github.com/viell-dev/slop-inkline/issues/378)).
- The brush's circle stays on the pointer when a theme or a CSS snippet gives
  the drawing area a margin, which Inkline's own styles do not. It showed away
  from the pointer by the margin, though the ink went where the pointer was
  ([#394](https://github.com/viell-dev/slop-inkline/issues/394)).
- **Zoom** pressed while you draw a stroke or a shape, with the pen or the
  eraser, or while you press a polygon's corner or a path's point or handle, now
  waits until you let go, by its key and by its button. It used to zoom at once,
  which moved where the pointer fell in the drawing, so letting go without
  moving ended the stroke somewhere other than it showed
  ([#382](https://github.com/viell-dev/slop-inkline/issues/382)).
- **Inkline: Insert existing symbol** in a table cell in Live Preview keeps the
  symbol when you type straight after choosing it. On a busy computer, a key
  that came before the cell had taken the symbol made it leave the symbol out,
  keeping only the letter
  ([#415](https://github.com/viell-dev/slop-inkline/issues/415)).
- **Fit** pressed while you draw now waits until you let go, as **Zoom** does.
  Moving along a zoomed drawing with the wheel or the left and right arrow keys
  while you draw now takes what you draw with it, on to where the pointer is in
  the drawing, and shows it there at once, so a long stroke can go past the edge
  of the view; it used to stay where it was until you moved or let go, and
  letting go then drew a part that never showed. A change to the window's or the
  editor's size, or to Obsidian's page zoom (Ctrl+= and Ctrl+−), while you draw
  now ends the stroke where it showed, if it moves the drawing under the
  pointer, as the pointer may have moved with the window
  ([#393](https://github.com/viell-dev/slop-inkline/issues/393),
  [#418](https://github.com/viell-dev/slop-inkline/issues/418)).
- A stroke started while the editor's status line showed a message of two lines,
  as **Zoom**'s does in a narrow window, now starts where you pressed. The press
  empties the message, which made the editor shorter, and Obsidian, which keeps
  the editor in the middle of the window, moved the drawing under the pointer,
  so the stroke's first point was a few pixels off from the rest. A message of
  two lines said while you drew, such as **Flat ends**' reason for doing
  nothing, moved it in the same way. While you hold the pointer down on the
  drawing area, the lines below it and the picture's row above it now keep their
  height; a message that needs more room shows whole once you let go. **Make
  ink** pressed while you draw now opens or closes its row once you let go, as
  **Zoom** does: opened at once, the row moved the drawing by its height under
  the pointer in the middle of the stroke. Meanwhile, its button shows what it
  will be, a save makes ink only if it stays open, and it does not open behind a
  question that comes before you let go
  ([#427](https://github.com/viell-dev/slop-inkline/issues/427)).
- A rename of a symbol that was renamed elsewhere, deleted and replaced, or
  whose new name another symbol took, while Quick edit wrote its readings and
  translations or the editor its drawing, is refused at once. It used to read,
  and save, every open note first, and so waited on a slow disk for a refusal
  that was coming anyway
  ([#279](https://github.com/viell-dev/slop-inkline/issues/279)).
- Quick edit says why the readings and translations cannot be typed in, as for a
  file that is not a whole PNG, together with a refused name's reason. One used
  to hide the other: the fields closed with no reason given, or the file's
  reason went for good
  ([#279](https://github.com/viell-dev/slop-inkline/issues/279)).
- Quick edit no longer goes back to what the file said earlier after a save that
  found the file changed, when a read of the file from before the save came back
  late. The fields said that saving would replace the earlier text, and the next
  **Save** was refused again
  ([#279](https://github.com/viell-dev/slop-inkline/issues/279)).
- When a Quick edit save leaves the row open, as one refused because the file
  changed does, the row takes in a change that reached the file while the save
  ran. Such a change was left until the file changed again or **Save** was
  pressed again: other text showed what the file had said a moment earlier, and
  a file cut short or deleted in that moment left the fields open with no reason
  given. When the change closes the fields, the focus goes to the name, which
  can still change, rather than staying in a field that cannot be typed in
  ([#423](https://github.com/viell-dev/slop-inkline/issues/423)).
- In a PDF exported with Obsidian's **Export to PDF**, symbols in text colour no
  longer show a faint one-pixel line along an edge of their box in some PDF
  viewers, Obsidian's own PDF view among them, at some zoom levels. Each prints
  from a copy of its own pixels in the colour its text prints in, the way a
  symbol in stored colour prints, rather than through a mask, which the browser
  Obsidian is built on writes into a PDF in a way those viewers draw with the
  line. Symbols keep their size, baseline, and colour. Exporting waits for the
  copies while they are being made; a symbol whose copy has got no further for
  ten seconds, or cannot be made, prints as before
  ([#255](https://github.com/viell-dev/slop-inkline/issues/255)).

## 1.0.2 - 2026-11-19

A fix release for 1.0.1. The file format is unchanged: symbols open and look as
they did, and a symbol saved with 1.0.2 opens in 1.0.0 and 1.0.1 too.

**To update,** let Obsidian update Inkline under **Settings → Community
plugins**, or install `inkline-1.0.2.zip` from this release's assets: extract it
into your vault's `.obsidian/plugins/` directory, replacing the three files of
the version before, as
[the install guide](https://viell-dev.github.io/slop-inkline/install#update)
says.

### Fixed

- The eraser takes away exactly what its circle passes over, and what it has
  taken stays taken as you go on, but for a straight part that Shift draws,
  which follows the pointer until you let go of Shift, as with the pen. Behind a
  large brush moving along a curve, the edge it left in the ink used to shift
  while erasing, and a little ink came back beside its way, some of it for good.
  An eraser stroke drawn freehand is now saved as the area its brush swept, as a
  filled shape the file format already has, so symbols stay in the same format
  and open in earlier versions of Inkline as before, and what the editor shows
  while you erase is what it saves, unless **Zoom** is pressed during the
  stroke, which can move where any stroke ends
  ([#382](https://github.com/viell-dev/slop-inkline/issues/382)). In the strokes
  measured, such a stroke held about three times the points of a pen stroke as
  long, and up to nearly seven times for a slow curve with the largest brush. A
  tap with that brush holds a few dozen points, where the pen's holds one. A
  reopened symbol places its grid by where such a stroke ends, and no longer by
  where it starts. A tap with the eraser is the brush's circle saved the same
  way. An eraser stroke that starts with Flat ends and the grid both on is drawn
  as before, so that its ends can stop flush with a row, and its edge can still
  shift along a curve, as
  [Known limits](https://viell-dev.github.io/slop-inkline/limits#in-general)
  says; turn Flat ends off to erase along a curve. Pen strokes, the eraser's
  shapes, and eraser strokes saved before are as they were, and so is the grid
  that a symbol saved before places when it opens again
  ([#341](https://github.com/viell-dev/slop-inkline/issues/341)).
- Inkline follows a canvas card's own editor from the moment it appears, rather
  than once it takes the focus, tens of milliseconds later. A symbol that
  changed in between kept its old picture there, and an editor that never took
  the focus would never have been followed, its symbols keeping their old
  pictures without Inkline's menu or double-click
  ([#336](https://github.com/viell-dev/slop-inkline/issues/336)).
- A symbol that changes, as through sync, while some of its images are out of
  the page now shows its new picture in them when Obsidian puts the same images
  back with the addresses they had, as it does with parts of Reading view as it
  lays a note out again, and with a canvas card's own editor, which it moves
  into a frame of its own as it opens. Those images kept the old picture until
  the note or the editor was shown again. An image that Obsidian makes anew,
  rather than puts back, is not covered: one made with an address from before
  the change can still show the old picture until the note is shown again
  ([#281](https://github.com/viell-dev/slop-inkline/issues/281)).

## 1.0.1 - 2026-11-18

A fix release for 1.0.0. The file format is unchanged: symbols open and look as
they did, and a symbol saved with 1.0.1 opens in 1.0.0 too.

**To update,** let Obsidian update Inkline under **Settings → Community
plugins**, or install `inkline-1.0.1.zip` from this release's assets: extract it
into your vault's `.obsidian/plugins/` directory, replacing the three files of
the version before, as
[the install guide](https://viell-dev.github.io/slop-inkline/install#update)
says.

### Fixed

- A filled polygon or ellipse keeps the brush's width around it. Closing a
  filled polygon left only the area through its corners, half the brush's width
  smaller on every side than its sides had shown while it was placed, and a
  filled ellipse came out as much smaller than the same ellipse unfilled. Each
  now leaves the same shape as with **Toggle fill** off, with its inside filled
  too, so a filled and an unfilled shape drawn across the same corners have the
  same outer edge, with the pen or the eraser. One Undo takes back the whole
  shape. Files stay as they were: a filled shape is saved as two kinds of stroke
  the format already has, so a symbol drawn with this release opens in 1.0.0,
  and symbols already saved look as before
  ([#342](https://github.com/viell-dev/slop-inkline/issues/342)).
- Ink shows under the pointer that draws it at the bottom of the drawing area
  too, where it showed up to 2 CSS pixels above it, in the usual view and in
  **Zoom** alike, as the area's border took its height from the drawing
  ([#359](https://github.com/viell-dev/slop-inkline/issues/359)). Strokes were
  always saved where the pointer was, and the grid, the guides, and the ink
  lined up with one another; the drawing area is now 2 pixels taller.
- The editor's status line no longer keeps a message that has stopped applying,
  such as "Zoomed out" after **Fit**, or "Polygon dropped" once the threshold
  moves in **Make ink**
  ([#302](https://github.com/viell-dev/slop-inkline/issues/302)). Whatever you
  do replaces it, with what that did, or with nothing when there is nothing to
  say, which a screen reader does not announce. Through actions with nothing of
  their own to say, "Saving…" and "Draft not kept" stay until the save ends or a
  draft is kept again.
- Going back from a later version of Inkline, as by choosing an earlier version
  in BRAT or installing an older ZIP, keeps the unsaved drawings that the later
  version kept as drafts, if it keeps them in a way this version cannot read.
  Inkline used to drop such drafts, with their pictures, as soon as an editor
  opened or a file was renamed. This version cannot restore them, and the later
  version offers them again once you update. Opening their symbol says so, when
  this version can tell which symbol they are for, and it drops those it can
  tell the age of 30 days after they were kept, as it does its own. Every
  release from 0.9.2 on keeps drafts the same way, so none has lost one like
  this yet ([#300](https://github.com/viell-dev/slop-inkline/issues/300)).
- In a right-to-left interface, as Obsidian's in Hebrew, Inkline's notices keep
  the full stop at the end of their English, where they used to put it at the
  start, as in ".There are no symbols to insert yet". Other plugins' notices,
  and Obsidian's, are laid out as before. Tooltips needed no change: measured on
  the screen, Inkline's keep their closing brackets in place, as in "Pen (P)",
  and the guide's known limits no longer say otherwise
  ([#267](https://github.com/viell-dev/slop-inkline/issues/267)).
- The **Fit** button's tooltip, and the table of keys in the guide, said that
  Fit shows all of a drawing wider than the view. That is so out of **Zoom**; in
  Zoom, Fit centres the drawing and stays zoomed, as the guide and **Help** say
  ([#363](https://github.com/viell-dev/slop-inkline/issues/363)).
- [Known limits](https://viell-dev.github.io/slop-inkline/limits#in-general) now
  says that the edge the eraser leaves can shift behind a large brush moving
  along a curve, and that a little ink can come back beside the way it went,
  with what to do instead
  ([#341](https://github.com/viell-dev/slop-inkline/issues/341)).

## 1.0.0 - 2026-11-16

This is Inkline's first stable release. It is 0.9.5, the last release candidate,
with the changes below.

**The file format is frozen from this release.** Symbols saved by 0.9.2 or later
open as they are, strokes included, as the format has not changed since then,
and every symbol saved from now on keeps opening and looking the same in later
versions. A symbol saved by a version before 0.9.2 still looks as it did, and
opens as a picture to draw over, as it has since 0.9.2.

**To install it,** use Obsidian's community plugins, under **Settings →
Community plugins → Browse**, once Inkline appears there; Obsidian then offers
its updates. Or install it now with `inkline-1.0.0.zip` from this release's
assets: extract it into your vault's `.obsidian/plugins/` directory, replacing
an earlier version's three files, as
[the install guide](https://viell-dev.github.io/slop-inkline/install) says.
Obsidian's community plugins offer public releases only, those with an even
minor version. Later pre-releases, such as 1.1.0, are on GitHub only, to install
by their ZIP or with BRAT.

### Changed

- While a row of the library is in Quick edit, its own buttons stay at its top:
  the symbol, which still inserts it, **Uses**, which waits as the other rows'
  do, and **Quick edit**, shown pressed, which closes the row as **Cancel**
  does. The fields take the place of the readings, translations, and notes under
  them, rather than of the whole row, and no longer repeat the symbol's picture
  beside its name
  ([#294](https://github.com/viell-dev/slop-inkline/issues/294)).
- When a symbol does not open, because its file is not a valid PNG or its
  strokes cannot be read, and Inkline keeps a draft of it, as after a crash cut
  short a save, the notice says that the draft is kept. The editor offers a
  draft only for a symbol that opens at the draft's path, so such a draft used
  to wait unseen until it expired.
  [Saving and recovery](https://viell-dev.github.io/slop-inkline/recovery#drafts-whose-symbol-is-gone-or-does-not-open)
  now says how to get it back, and how to get back a draft whose symbol was
  renamed or deleted while Inkline was off.

### Fixed

- A new symbol whose note was deleted while it was drawn, as by sync or on
  another device, is saved, and a notice says that it was not inserted, as its
  note was deleted. The editor then closes as after any save. Its file used to
  be written, while the editor said "Not saved" with a path on the disk, and
  every save after failed the same way, so that only **Discard** closed it. If
  the note is deleted after the symbol went in, later saves and renames of the
  symbol work, where a rename used to say "Not saved" too, and **Next** says
  that it started no other symbol, where it used to open one for the deleted
  note. A note put at the deleted one's path is never given the embed.
- A new symbol with nothing drawn, no stroke of the pen and no picture as its
  base layer, is not saved: Save, Mod+S, and **Next** leave the editor open, and
  its status line says "Not saved: nothing drawn yet". An untouched new editor
  used to save an empty symbol and insert it, and a second click on **Next**,
  landing on the next editor, did the same. A symbol that has a file still saves
  when erased to nothing.
- The editor's **Help**, the **Zoom** button's tooltip, and the line Zoom shows
  as it turns on said that the arrow keys move along a zoomed drawing. Only the
  left and right arrow keys do; the up and down arrow keys move the drawing.
- The guide said that a symbol saved by a newer version of Inkline does not
  open. It is a symbol saved in a newer version of the file format that does
  not: one that a later Inkline saved in a format this one reads opens as usual.
- [Known limits](https://viell-dev.github.io/slop-inkline/limits#files-and-sizes)
  now says that symbols saved without a name take the lowest free number on
  every device, so that two devices can give two symbols the same name before
  they sync, and a sync tool keep only one of them, and that a new symbol can
  take the number of a deleted one that a note still embeds
  ([#299](https://github.com/viell-dev/slop-inkline/issues/299)).
- [Known limits](https://viell-dev.github.io/slop-inkline/limits#in-general) now
  says that a line whose first letter is in a symbol's name, as
  `8 ![[مرحبا.ink.png]]`, runs in that name's direction in Live Preview, and not
  in Reading view, and how to give the line its own
  ([#301](https://github.com/viell-dev/slop-inkline/issues/301)).

## 0.9.5 - 2026-11-15

This is the fourth release candidate of 1.0.0: a build meant to become 1.0.0
with only its version number and documents changed. The owner is asked to look
at it in
[their test request](https://github.com/viell-dev/slop-inkline/issues/294).

0.9.4 did not become 1.0.0: the owner's pass on it
([#289](https://github.com/viell-dev/slop-inkline/issues/289)) asked for four
changes to the library, which are all here: more space around a symbol's
readings and translations, with their labels in bold, Quick edit's fields that
fit what they hold, the other rows' buttons disabled while a row is in Quick
edit, and a labelled, bulleted list of the notes that use a symbol. Nothing else
changes, and the file format is as it was, so symbols and drafts from 0.9.2 on
open as they did.

### Changed

- In the library, a symbol's readings and translations start at the row's edge,
  at the size of Quick edit's labels, with **Readings:** and **Translations:**
  in bold, and with 4 px more space above and below them, so that a row that has
  them is 12 px from the next. The notes that **Uses** lists follow them as part
  of the same list, under a bold **Uses:**, each with a bullet, at the same size
  ([#289](https://github.com/viell-dev/slop-inkline/issues/289)).
- Quick edit's readings and translations fields grow and shrink with what they
  hold, from two lines to eight, and scroll past that. A field dragged to a
  height of its own keeps it
  ([#289](https://github.com/viell-dev/slop-inkline/issues/289)).

### Fixed

- While a row is in Quick edit, the other rows' **Uses** and **Quick edit**
  buttons, and **Show more**, are disabled until it closes. A click on **Uses**
  used to open or close its list only once the form closed, and one on another
  **Quick edit** only put the focus back in the open form, which looked like
  nothing. A symbol's button still inserts it meanwhile, and the notes listed
  still open ([#289](https://github.com/viell-dev/slop-inkline/issues/289)).

## 0.9.4 - 2026-11-15

This is the third release candidate of 1.0.0: a build meant to become 1.0.0 with
only its version number and documents changed, for its last checks. The owner is
asked to try it in
[their test request](https://github.com/viell-dev/slop-inkline/issues/289).

0.9.3 did not become 1.0.0: the owner's pass on it
([#212](https://github.com/viell-dev/slop-inkline/issues/212)) asked for symbols
to stand on the text's baseline, space between the library's rows, one Quick
edit for a symbol's name, readings, and translations, and a double-click that
opens a symbol in the editor. They are all here, with the fixes found since. The
file format is unchanged, so symbols and drafts from 0.9.2 and 0.9.3 open as
they did.

### Added

- Double-clicking a symbol opens it in the editor, as **Edit symbol** does, in
  Live Preview, a table in Live Preview, a canvas card or note that is not
  focused, and a canvas text card's own editor
  ([#264](https://github.com/viell-dev/slop-inkline/issues/264)). Obsidian's
  image viewer no longer opens on the second click there, nor does the canvas
  card open its text, and the first click does what it did before. In Reading
  view, embedded notes, hover previews, and a focused canvas card, a click opens
  the image viewer as before, so right-click a symbol there for **Edit symbol**.
- Each release now carries a copy of the
  [file format](https://viell-dev.github.io/slop-inkline/file-format)'s
  specification as of that release, named by the format's version and the
  document's revision: `inkline-file-format-version-1-revision-1.md`. It is
  listed in `SHA256SUMS` and attested like the other files, so that what symbol
  files hold stays described wherever a release is kept. Installing does not
  need it: the install ZIP and the three plugin files are as before.

### Changed

- In the library, **Quick edit** takes the place of **Rename** and the button
  with the translation icon. It opens a symbol's name, readings, and
  translations together in its row, and one **Save** writes the readings and
  translations and then renames the symbol, with links following as before. A
  name that would be refused is refused before anything is written. If one part
  fails, the row says which, keeps everything you typed, and **Save** tries
  again what is left. The count of notes that use a symbol is now the **Uses
  (2)** button, which lists them as before
  ([#263](https://github.com/viell-dev/slop-inkline/issues/263)).
- Inkline's description in Obsidian's list of plugins now says what it is for:
  "Draw symbols that no font has, then write with them inline in your notes like
  characters. Each one is saved as a plain PNG image." The README, the guide's
  home page, and the directory listing say the same in more words: Inkline is
  for writing notes in a script that no font has, whether you are working it out
  from a game or making it up for a language of your own, by writing a symbol
  down easily and using it again easily.
- The README and the guide describe a symbol's readings and translations as the
  place for how it is read and what it means, which can be edited without
  changing a note, and say that the list of symbols finds one by them as well as
  by its name.
- The README and the guide call the characters that open the list of symbols the
  insert trigger, as its setting does, and give `;;` as its default, since the
  setting can change it.
- The README, the guide, and the directory listing say that a symbol takes the
  size and colour of the text around it by default, since the settings can
  change both. The guide's home page and the listing no longer list what Inkline
  is not, and Known limits no longer says what Inkline "does not do yet", or
  heads its general limits "Not there yet". These four changes, from Inkline's
  description to this one, change only text, not how Inkline works.

### Fixed

- The `;;` list follows Reading view in more places when it tells code from
  text, so that it neither opens in code nor stays closed in text there:
  - Inline code starts and ends where Reading view finds it. A backtick inside a
    wiki link, a link's address, a `%%` comment, math, a web address, or an HTML
    tag starts none, and inline code inside emphasis, strikethrough, a
    highlight, a link's text, or square brackets ends where they do: in
    `` **`a** b` `` nothing is code, while ``**`code`**`` is code
    ([#243](https://github.com/viell-dev/slop-inkline/issues/243)).
  - A tab after a quote's `>`, or after a list item's marker and a space, makes
    the line indented code, unless it goes on in a paragraph; spaces before a
    tab do not ([#249](https://github.com/viell-dev/slop-inkline/issues/249)).
  - A line without `>` stays in its quote after a heading, a code block, a
    table, or a `>` alone, as it does after a paragraph, unless it starts a
    block that ends the quote
    ([#250](https://github.com/viell-dev/slop-inkline/issues/250)).
  - `%%` comment and `$$` math blocks, link reference definitions, task boxes,
    headings underlined with `===`, the line after an empty list item, and the
    end of a table are read as Reading view reads them.
  - The list lists nothing in a block of HTML, where an embed shows as text and
    code, as in `<pre><code>`, cannot be told from text, nor in a paragraph too
    long to read in time, such as one of a thousand brackets that nothing
    closes. After a `<code>` or `<pre>` tag, in any form, `<code/>` included, it
    lists nothing until the note closes it with `</code>` or `</pre>`, over
    blank lines and other blocks too. A closing tag counts only where the
    browser reads it as one: not inside an HTML comment, a quoted attribute, a
    `<textarea>` or `<style>`, a table's cell, or a footnote, and not past eight
    or more nested blocks. It lists nothing inside an HTML tag or comment, a
    `%%` comment, or inline math, where an embed shows nothing, nor in a
    `<textarea>`'s text, and nothing in the rest of a note after a comment, tag,
    or quote that a block of HTML leaves open, or after a `<script>`, an
    `<svg>`, or a `<math>`.

  A few rare notes are still read otherwise
  ([#271](https://github.com/viell-dev/slop-inkline/issues/271)).

- A symbol stands on the baseline of the text beside it wherever it falls in the
  line, and the symbols of a line line up with each other
  ([#261](https://github.com/viell-dev/slop-inkline/issues/261)). Before, by
  where it fell, a symbol's ink could sit three quarters of a pixel higher than
  the letters beside it in Obsidian's default 16-pixel text, so that two copies
  of one symbol in a line could differ; now it stands exactly on their baseline
  there. At some other text sizes, Symbol sizes, and zoom levels it can still
  stand off the letters, as the text and the symbols are each drawn on whole
  pixels of the screen: up to about a pixel at 100% zoom, and at other zoom
  levels up to 1.75 pixels in Obsidian 1.13.4 and 1.00 in 1.15.1. The symbols of
  a line stand within half a pixel of each other at 100% zoom, and within a
  pixel at other zoom levels. Symbols shown in their stored colour were not
  affected.
- A symbol with a size written into its embed, such as `![[wide.ink.png|1000]]`,
  that is wider than the space it is shown in stays on the baseline when
  Obsidian shrinks it to fit, in notes, tables, hover previews and exported PDFs
  ([#245](https://github.com/viell-dev/slop-inkline/issues/245)). Before, it sat
  a few pixels below it: 7.5 pixels in a hover preview.
- Turning Inkline off while Obsidian is still renaming a symbol you have just
  saved, as while it asks whether to update links, no longer leaves a draft that
  the editor offers back though the file holds the drawing. A stroke drawn after
  that save is offered back under the symbol's new name, with the picture it was
  drawn over, where it used to stay in a draft that nothing offered
  ([#247](https://github.com/viell-dev/slop-inkline/issues/247)). Opening a
  symbol now drops, without asking, a draft that would bring back nothing its
  file lacks.
- The library's rows have space between them, so that the line of readings and
  translations under a row no longer reads as part of the row below it
  ([#262](https://github.com/viell-dev/slop-inkline/issues/262)).
- Resting the pointer over empty space in the library's list, or over a row's
  readings and translations, no longer shows a "Symbols" tooltip at the bottom
  of the list. Screen readers still hear the list's name
  ([#262](https://github.com/viell-dev/slop-inkline/issues/262)).
- A save no longer writes over a file that another plugin or a sync tool,
  working through Obsidian, put at a symbol's path in its place while the save
  looked at the symbol for the last time. Obsidian reads and writes the vault's
  files one after another, so what was asked of it during that look came before
  the save's write. A save now waits for it and looks again: the library refuses
  a symbol that has gone, and the editor asks about a file that changed. On a
  disk still busy after three such looks, or in a version of Obsidian that keeps
  its line where Inkline cannot see it, a save writes as before, as
  [Known limits](https://viell-dev.github.io/slop-inkline/limits#a-file-written-at-the-moment-inkline-saves)
  says. A save that finds its file gone once it has written says so, and keeps
  what was drawn or typed
  ([#280](https://github.com/viell-dev/slop-inkline/issues/280)).

- In a right-to-left interface, as Obsidian's in Hebrew, a symbol's picture in
  the insert trigger's list, Insert existing symbol, Copy from, and the library
  starts at the right of its column, as the mirrored row has it, rather than at
  the left. Inkline's English in the editor and its Help and in the library
  keeps its full stops and ellipses where English puts them: "Choose picture…"
  no longer shows as "…Choose picture"
  ([#256](https://github.com/viell-dev/slop-inkline/issues/256)). Notices and
  tooltips still move them, as Known limits says.

## 0.9.3 - 2026-11-12

This is the second release candidate of 1.0.0: a build meant to become 1.0.0
unchanged, for its last checks. The owner is asked to try it in
[their test request](https://github.com/viell-dev/slop-inkline/issues/212).

0.9.2 did not become 1.0.0: a review of the whole code after it was published
([#217](https://github.com/viell-dev/slop-inkline/issues/217)) found that a
rename could move another file than the one you chose
([#218](https://github.com/viell-dev/slop-inkline/issues/218)). That is fixed
here, with the review's other findings. The file format is unchanged, so symbols
and drafts from 0.9.2 open as they did.

### Fixed

- The `;;` list no longer opens in inline code that started on an earlier line
  of its paragraph, where Enter put an embed into the code
  ([#219](https://github.com/viell-dev/slop-inkline/issues/219)). A callout's
  title line is read on its own, as Reading view shows it: inline code in it
  ends with the line, and a table can start on the line under it
  ([#248](https://github.com/viell-dev/slop-inkline/issues/248)).
- The `;;` list opens again in the text after a quote or a list item holding a
  fenced code block that was never closed: the block ends with the quote or the
  item, as Reading view shows it. **Inkline: Edit symbol** works on an embed
  there too ([#220](https://github.com/viell-dev/slop-inkline/issues/220)).
- The list follows Reading view in a few more places where it differed: it lists
  nothing in a code block made by indenting lines, which it now tells from a
  list item's indented text, nor in a fenced code block opened on a list item's
  own line, nor after a run of backticks that only a shorter run closes, and it
  reads each of a table's cells on its own. **Inkline: Edit symbol** is not
  offered on an embed in an indented code block, which shows it as text.
- Turning Inkline off closes **Inkline: Insert existing symbol**, which stayed
  open and could still insert a symbol into the note
  ([#221](https://github.com/viell-dev/slop-inkline/issues/221)). Nothing else
  Inkline started acts once it is off either: **Edit symbol** in a symbol's menu
  left open does nothing, and a rename or a change of readings and translations
  that the library was still saving stops and says so, as the editor's saves
  already did, unless it had reached Obsidian. A rename that Obsidian has not
  begun, from the library or the editor, saves no open note after that, and one
  waiting for Obsidian to index the vault or finish another rename stops at
  once. One that Obsidian has begun finishes, as before, and the embed of a new
  symbol renamed as it was saved now follows it to the new name, where it kept
  the old one, which no longer named a file. Turned off just as it starts,
  before Obsidian's window is ready or while it reads its settings, Inkline no
  longer goes on showing symbols as characters, or leaves its commands behind
  ([#222](https://github.com/viell-dev/slop-inkline/issues/222)).
- A symbol wider than the space it is in, as a very wide one can be in a hover
  preview, a table cell, a narrow pane, or a PDF page, or at a larger Symbol
  size, is no longer squeezed sideways. It shrinks evenly to fit, whole and in
  the proportions it was drawn in, and stays on the baseline. Before, only its
  width gave way, so a symbol near the widest a file can be showed about a
  quarter too narrow at the default size in a hover preview
  ([#241](https://github.com/viell-dev/slop-inkline/issues/241)).
- A rename, from the library or the editor, no longer renames another file when
  the symbol is deleted and a file is put at its path while the rename saves the
  open notes or the drawing, or while Obsidian finishes indexing the vault or
  another rename before it moves the file. The symbol is checked again once
  nothing is left to wait for, and Obsidian begins to move it in that same step.
  A symbol deleted, replaced, or renamed elsewhere meanwhile, or whose new name
  another symbol has taken, is not renamed: the name you typed stays to try
  again. A change that still reaches the file before Obsidian moves it, such as
  one made outside Obsidian at that moment, is reported with where the symbol is
  now, rather than taken for a rename that went well
  ([#218](https://github.com/viell-dev/slop-inkline/issues/218)).
- Text typed in a note while a rename saves the other open notes is saved too
  before the rename, so that Obsidian's update of the links can't write over it
  ([#218](https://github.com/viell-dev/slop-inkline/issues/218)).
- `COM¹`, `COM²`, `COM³`, `LPT¹`, `LPT²`, and `LPT³`, which Windows keeps for
  its ports as it keeps `COM1`, are refused as a symbol's or a folder's name,
  with an extension too. A symbol that already has such a name keeps it when
  saved ([#225](https://github.com/viell-dev/slop-inkline/issues/225)).
- A draft is no longer refused for room that pictures no draft needs take up.
  Each **Copy from**, **Make ink**, or reload that gave the drawing a new base
  layer kept the old one's picture in the vault's local storage too, until
  Inkline next looked for drafts to offer, so a few of them in one editor could
  fill it. The old picture now goes as soon as the draft that replaces it is
  kept, and never before
  ([#223](https://github.com/viell-dev/slop-inkline/issues/223)).
- The editor no longer keeps every base layer it has shown in memory until it
  closes. One that Undo and Redo can no longer reach, after a new change past an
  Undo or once it is further back than Undo goes, is let go
  ([#224](https://github.com/viell-dev/slop-inkline/issues/224)).
- The guide said that symbols keep showing in other Markdown apps and on GitHub,
  but those show Obsidian's own embed, such as `![[tower.ink.png]]`, as text.
  [Without Inkline](https://viell-dev.github.io/slop-inkline/without-inkline#in-other-apps)
  now says what another app needs, with the Obsidian settings that write such
  links and an example from a note in a folder
  ([#231](https://github.com/viell-dev/slop-inkline/issues/231)).
- The description prepared for Obsidian's community directory said that Inkline
  reads nothing outside your vault. It now says that it keeps drafts in
  Obsidian's storage on your computer, and reads nothing else unless you choose,
  drop, or paste a picture to trace over, which can come from anywhere. The
  security policy says the same
  ([#233](https://github.com/viell-dev/slop-inkline/issues/233)).
- The README starts with installing Inkline and drawing a first symbol
  ([#232](https://github.com/viell-dev/slop-inkline/issues/232)).

## 0.9.2 - 2026-11-07

This is the first release candidate of 1.0.0: a build meant to become 1.0.0
unchanged, for its last checks. The owner is asked to try it in
[their test request](https://github.com/viell-dev/slop-inkline/issues/212).

**Symbols saved by any earlier version open as pictures to draw over, without
their strokes.** The file format is now final, by the owner's decision in
[#144](https://github.com/viell-dev/slop-inkline/issues/144), after a
[review of every rule in it](https://github.com/viell-dev/slop-inkline/issues/172),
and Inkline no longer reads what earlier versions stored. Your symbols and the
notes that use them don't change, and they look as they did. In the editor, such
a symbol says why it has no strokes, and saving it stores strokes from then on.
Unsaved drafts from earlier versions are dropped, so finish what you are drawing
before you update.

What else is new since 0.9.1:

- **Readings and translations.** A symbol can record how it is read and what it
  means, apart from its name, and the lists find it by either.
- **The grid is a guide.** Nothing snaps to it unless Shift is held, and **Flat
  ends** only ever cuts along a row.
- **Typing goes on after a symbol,** as after a typed character, and names line
  up in the lists.
- **Large symbols no longer freeze Obsidian** while they open or save.
- **A save or a rename that stalls says so,** with how to get your work back.

### Added

- A symbol can record readings and translations, apart from its file's name, one
  to a line, so that correcting a guess changes no note and needs no rename.
  Fill them in beside the name in the editor, or in the library, beside
  **Rename**, where saving changes the file's text and nothing else, in a file
  the editor won't open too. A row shows what a symbol holds
  ([#187](https://github.com/viell-dev/slop-inkline/issues/187)).
- The `;;` list, **Inkline: Insert existing symbol**, **Copy from**, and the
  library's filter find a symbol by a reading or translation as well as by name,
  and a row found that way shows why. Accents need no typing, but a mark that
  makes another sound counts: `sa` finds `šá`, and `は` does not find `ば`. They
  read the vault's symbols in the background, without slowing typing, what just
  changed first, and say so while they may be missing some
  ([#189](https://github.com/viell-dev/slop-inkline/issues/189)).
- A save that Obsidian does not finish, as on a drive that stops answering, says
  so after a few seconds, in the editor and the library, with how to get your
  work back. Saving goes on by itself if Obsidian finishes, and the library's
  fields can be closed meanwhile
  ([#198](https://github.com/viell-dev/slop-inkline/pull/198)).
- The editor's status line says why a file with no strokes opened as a picture
  to draw over, as every symbol saved by an earlier version now does.

### Changed

- The grid is now a guide, and snaps only while Shift is held, for the pen, the
  eraser, Ellipse, and Polygon. A click between its dots stays where you
  clicked, and a stroke's ends stay where you pressed and let go, so that you
  can keep the grid on just to judge distances. Each thing you place goes by
  Shift at that moment: a stroke's start at the press, its end at the release,
  an ellipse's corners likewise, and each polygon corner at its click. With the
  grid on, Shift on Ellipse snaps instead of making a circle; with the grid off,
  it still makes one
  ([#169](https://github.com/viell-dev/slop-inkline/issues/169)).
- **Flat ends** applies to ends that Shift put on the grid. A freehand end is
  not on a grid line, and stays round. The button is available as before
  ([#169](https://github.com/viell-dev/slop-inkline/issues/169)).
- On a symbol you open again, the grid lines up with the ends you put on it with
  Shift, as freehand ends no longer lie on it
  ([#169](https://github.com/viell-dev/slop-inkline/issues/169)).
- Names now line up across rows in the `;;` list, **Inkline: Insert existing
  symbol**, **Copy from**, and the symbol library, as each picture has a column
  of its own. A symbol wider than the column shows whole, at a smaller size
  ([#171](https://github.com/viell-dev/slop-inkline/issues/171)).
- The cursor now lands just after a symbol that **Save** or **Next** inserts, as
  after a typed character, so that typing goes on after it, in a table cell in
  Live Preview too. **Next** still puts a run of symbols in the order they were
  drawn, and the cursor ends after the last, also when the last drawing is
  discarded after the note changed on disk. Selected text stays as it was
  ([#170](https://github.com/viell-dev/slop-inkline/issues/170)).
- **Inkline: Insert existing symbol** places a symbol as the other routes do:
  just after a link or embed the cursor is inside, rather than splitting it, and
  beside selected text, rather than replacing it
  ([#173](https://github.com/viell-dev/slop-inkline/issues/173)).
- A row of the symbol library keeps its picture, name, and buttons on one line
  in the default sidebar, however long the name is. The name has the room the
  row's narrower buttons leave, and they line up across rows. In a sidebar
  narrower than about 285 pixels, they drop below the name together.
- An editor open on a symbol tells a change to its readings or translations from
  a change to its drawing. A change to the text alone, from the library or by
  sync, asks nothing and takes the text in, with unsaved strokes and Undo left
  alone, and a draft no longer warns that its strokes may not line up. Text you
  typed in a field the file changed too stays, with a note of what saving
  replaces, as in the library
  ([#195](https://github.com/viell-dev/slop-inkline/issues/195)).
- The file format is rewritten for the first public release, after a review of
  every rule in it, and
  [its specification](https://viell-dev.github.io/slop-inkline/file-format) now
  stands alone. It also defines where a symbol's readings and translations go:
  PNG text chunks, which a program that changes the file must keep.
- The record moves to a chunk of its own, `inKL`, marked as depending on the
  image, so that a program that changes the image drops it and leaves a picture,
  rather than leave strokes behind that bring the old image back. The format
  version comes first in it, outside the compression, so that any later version
  is recognised whatever else it holds.
- A symbol whose strokes cannot be read is no longer opened as a picture, which
  replaced them on saving: it does not open, a notice says why, and **Copy
  from** starts a new symbol from what it shows.
- A symbol's image is 192 pixels high and at most 4096 wide, down from 8192, and
  a record holds no other geometry. Strokes record no pressure. A fill has no
  brush size, and only a smooth stroke's ends can be cut, `"up"` or `"down"`. A
  symbol holds at most 250,000 points, down from 1,000,000, which keeps the
  memory a small crafted file can ask for lower. It does not bound how long such
  a file can keep the editor busy, as
  [Known limits](https://viell-dev.github.io/slop-inkline/limits#files-and-sizes)
  says.
- A single click draws a round dot exactly as wide as the brush, centred on the
  click, rather than a short stroke a little wider, running down and right.
- Every pixel of a symbol's image holds the same grey, however transparent, so
  that a viewer that scales the image shows no dark fringe.
- How a stroke's outline is drawn is now specified in full and kept in Inkline's
  own source, so that it no longer depends on the perfect-freehand package.
- Every limit of the file format is now tested at the limit and just past it,
  with its number written out, and a recorded list of hashes holds the pinned
  test files, so that neither can change by mistake once the format is permanent
  ([#197](https://github.com/viell-dev/slop-inkline/issues/197)).

### Fixed

- A click on a button in the symbol library no longer does nothing when the list
  redraws between the press and the release, as it could just after a symbol was
  made, or while the vault's symbols were being read. The list now waits for the
  release, so one click is enough
  ([#204](https://github.com/viell-dev/slop-inkline/issues/204)). Space does the
  same, which a button acts on when the key comes up
  ([#209](https://github.com/viell-dev/slop-inkline/issues/209)).
- A rename that Obsidian does not finish, as on a drive that stops answering, no
  longer leaves the library's row stuck, or the editor at "Saving…", with
  nothing said. After a few seconds with nothing happening they say so, and how
  to get out, the row keeps the name to copy, and its **Cancel** and Esc work.
  Obsidian's question about links, and the time it takes to update a much used
  symbol's notes, don't count
  ([#201](https://github.com/viell-dev/slop-inkline/issues/201)).
- **Flat ends** only ever cuts along a row. An end running more along the row
  than across it is no longer cut along a column, which took a corner out of it,
  and stays round, so that a line drawn along the baseline stays whole
  ([#168](https://github.com/viell-dev/slop-inkline/issues/168)).
- A symbol saved while its note had gone to Reading view reaches the note. Its
  embed went into the editor that Reading view keeps out of sight and was lost,
  which left the symbol's file with nothing showing it
  ([#170](https://github.com/viell-dev/slop-inkline/issues/170)).
- A symbol saved into a note that is closed or in Reading view finds its place
  when the file's line endings differ from those the place was taken with, in
  either direction, rather than going at the end of the note. The file keeps its
  own line endings, and a symbol that does go at the end uses them too
  ([#174](https://github.com/viell-dev/slop-inkline/pull/174)).
- A symbol renamed just after it went in no longer spoils a note that holds
  other unsaved text. Its embed could get the new name twice, or part of it at
  the start of the note, and the text could go from the editor. The embed now
  takes the new name once, with the link updates on or off, in one pane or two,
  and in a table cell in Live Preview
  ([#174](https://github.com/viell-dev/slop-inkline/pull/174),
  [#180](https://github.com/viell-dev/slop-inkline/issues/180)).
- A rename no longer lets Obsidian write the new link over other text, which was
  lost for good. It happened when a note embedding the symbol saved itself while
  Obsidian's question about the links was open. Every rename, from the editor or
  the library, now saves the open notes first, and is refused with nothing
  changed if one cannot be saved. Text that reaches a note during the question,
  from another window or a plugin, stays exposed, as with any file in Obsidian
  ([#182](https://github.com/viell-dev/slop-inkline/issues/182)).
- The symbol library draws 100 symbols at a time, with **Show more** for the
  next 100, so that typing in its filter stays quick in a vault of thousands of
  them, where each key took seconds
  ([#189](https://github.com/viell-dev/slop-inkline/issues/189)).
- A long name no longer runs off the symbol library and gives it a horizontal
  scroll bar. It wraps onto a second line and then shortens, as a long folder
  shortens, and a tooltip on the row has the whole of both. A long note name
  listed under a symbol wraps too
  ([#175](https://github.com/viell-dev/slop-inkline/issues/175)).
- A very long name with no spaces breaks within its row in the symbol lists,
  rather than giving the list a sideways scroll bar
  ([#178](https://github.com/viell-dev/slop-inkline/issues/178)).
- The editor keeps the keyboard when **Edit symbol** is chosen from a menu
  before Obsidian has finished opening it. That menu could go on to take every
  key though it had gone from the screen: the editor's shortcuts did nothing,
  the first Escape left the editor open and moved the focus to the name field,
  and a menu that took the keyboard just before the editor opened held the
  note's arrow keys once the editor closed
  ([#78](https://github.com/viell-dev/slop-inkline/issues/78)).
- A flat-ended stroke whose only ink in the line came from the part drawn again
  at its cut end was left out when saving, which could save a blank symbol.
- A picture with an orientation in its metadata is no longer turned on opening,
  and turned again in notes. Saving a symbol drops that metadata.
- A file with a damaged chunk that the image does not depend on opens as it
  shows, and one with a critical chunk that PNG does not define does not open.
- A symbol whose image data is damaged opens if its strokes are whole, and
  saving it draws the image again.
- A large picture drawn smaller keeps its thin lines when saved, whatever its
  size, as each saved pixel is now the exact mean of the pixels it covers.
- A stroke that turns through almost exactly a right angle keeps its shape when
  saving's crop or the arrow keys shift it. Rounding used to depend on where the
  stroke lay, so that adding a mark elsewhere could redraw it pixels away.
- A line whose far end you erased keeps its pixels when an edit moves saving's
  crop. The line runs past the image's edge, and the browser drew its curve a
  little differently wherever the crop put that edge, so that about half of such
  saves changed some of its pixels
  ([#186](https://github.com/viell-dev/slop-inkline/issues/186)).
- A stroke that repeats a point hundreds of times keeps its end, and saving such
  a symbol no longer cuts most of it off. Inkline does not draw such a stroke,
  but another program could write one.
- A symbol whose base layer has incomplete or wrong image data, which only a
  faulty program writes, does not open in any supported Obsidian. One version
  used to open it with the missing rows empty, and the next save kept them so.
- A picture with so many metadata chunks that adding the strokes would take it
  past the 65,536 Inkline reads is not saved, and stays as it was. Saving used
  to write a symbol that then would not open.
- A file is a symbol only if its name ends in the ASCII letters of `.ink.png`,
  in any case. A letter that only lowercases to one of them, such as the Kelvin
  sign, no longer counts.
- **Keep mine** keeps your drawing and no more. A save after it used to write
  back the text and other carried chunks the file had when the editor opened,
  which dropped any that the change on disk had added.
- Saving a symbol with a large base layer no longer freezes Obsidian. Near the
  format's limit that took four to five seconds with nothing painting or taking
  input. It now takes two or three, and Obsidian keeps answering, apart from a
  pause of up to about a quarter of a second just after you ask to save. What
  files hold has not changed
  ([#200](https://github.com/viell-dev/slop-inkline/issues/200)).
- Opening a symbol with a large base layer no longer freezes Obsidian. Near the
  format's limit that took three seconds or more with nothing painting or taking
  input. It now takes one or two, Obsidian keeps answering, and a notice says
  that it is opening. Asking again opens it once, asking for another symbol
  opens that one, and it does not come up over a window opened meanwhile. A
  picture with no record opens the same way. What a file reads as has not
  changed ([#202](https://github.com/viell-dev/slop-inkline/issues/202)).
- **Copy from** no longer takes the place of a drawing that a save or a question
  came to while the other symbol was being read, where **Save** could have saved
  the copy in the drawing's stead. The status line says it was not copied.
  **Reload** asks again if you drew or typed while it read the file
  ([#202](https://github.com/viell-dev/slop-inkline/issues/202)).

## 0.9.1 - 2026-11-06

This is the second beta of 1.0.0. It clears the work left after 0.9.0, and the
owner's test moves to it, in
[#150](https://github.com/viell-dev/slop-inkline/issues/150). The file format
has not changed.

### Added

- Right-clicking a symbol now offers **Edit symbol** in the menus that had none:
  Obsidian's menus for a callout or a table in Live Preview, and the canvas's
  menus for a text card, a note, or several selected cards. Each menu keeps its
  own items. A focused card keeps showing the symbol's menu on the symbol, with
  the card's beside it
  ([#40](https://github.com/viell-dev/slop-inkline/issues/40)).
- The
  [install guide](https://viell-dev.github.io/slop-inkline/install#install-with-brat)
  now describes BRAT as an optional way to install and update Inkline. The
  manual ZIP stays the main route, and nothing needs BRAT. It installs from the
  same GitHub releases, and its **latest** choice follows pre-releases too.

### Fixed

- The command **Inkline: Edit symbol** works in a canvas text card's own editor,
  where it was not offered
  ([#40](https://github.com/viell-dev/slop-inkline/issues/40)).
- A symbol added in a canvas text card's own editor shows as a character at
  once, rather than as a large picture until the editor was opened again, and
  that editor follows the symbol size and colour settings
  ([#40](https://github.com/viell-dev/slop-inkline/issues/40)).
- **Make ink**'s ink no longer comes back for a moment as the slider moves away
  from it, as it could wherever the contrast at the threshold jumped from one
  level to the next. No edge gets softer for it; near the slider's ends, some
  get sharper ([#160](https://github.com/viell-dev/slop-inkline/issues/160)).

### Changed

- The editor keeps up with very long drawings. It adds a pen stroke to what it
  has already measured and drawn rather than starting over, and an eraser stroke
  to what it has drawn: on a drawing of 1,000 dots, the pause after a pen stroke
  falls from about 130 ms to about 10 ms, and after an eraser stroke, or a pen
  stroke past the left end of the image, to about half. Drawing past the end of
  the image no longer draws the preview again each frame, which took over 30 ms
  a frame. Undo and moving the drawing still take as long as before
  ([#115](https://github.com/viell-dev/slop-inkline/issues/115)).
- A pre-release's version no longer reaches the repository's `manifest.json`, so
  that it can never be offered to everyone once Inkline is in Obsidian's
  community directory. Each release's own `manifest.json` and install ZIP still
  name its version, and installing by hand or with BRAT works as before. See
  [the release guide](https://github.com/viell-dev/slop-inkline/blob/main/RELEASING.md#where-a-version-is-recorded).
- A release is refused unless its version is higher than every published one,
  both in SemVer's order and in the number-only order Obsidian uses.

## 0.9.0 - 2026-11-05

This is the first beta of 1.0.0, the first public release, following the owner's
review of 0.3.0-alpha.8
([review](https://github.com/viell-dev/slop-inkline/issues/126)). Its features
are complete; fixes and polish follow. The owner is asked to try it in
[#150](https://github.com/viell-dev/slop-inkline/issues/150).

From this release on, versions are plain numbers: an odd minor version, as
0.9.0, is a pre-release, and an even one, as 1.0.0, a public release. Obsidian
compares versions number by number, so a suffix such as `-rc.1` would have kept
anyone who installed a candidate from being offered the release
([version scheme](https://github.com/viell-dev/slop-inkline/issues/141)). 0.9.0
sorts above every earlier release.

The file format is still a draft until 1.0.0. Polygons saved by 0.3.0-alpha.7 or
alpha.8 with flat ends show their stored pixels, and draw their ends square if
you edit them. Symbols drawn on the grid by earlier releases can sit up to a
sixteenth of a pixel per column off the grid when opened again, as its column
spacing is now an even number of the file's units.

### Added

- **Up** and **Down**, and the up and down arrow keys, move the whole drawing by
  a pixel, or by a grid cell's width with Shift, so that a shape drawn against a
  line can sit on it. One Undo takes back moves made in a row.
- **Flat ends** (T) turns the flat ends of strokes on the grid on and off, and a
  new editor starts with it off, so that a stroke keeps its round ends unless
  you ask for them cut. **Next** keeps it. From 0.3.0-alpha.5 to alpha.8, every
  stroke drawn on the grid was cut.

### Fixed

- A polygon that ended near one of its own sides lost ink from that side.
  Polygons are no longer cut at all: an open polygon's ends stay square on the
  grid, as they are off it. A polygon saved by 0.3.0-alpha.7 or alpha.8 shows
  its stored pixels, and loses its flat ends if you edit it.
- A freehand stroke with Flat ends on could be cut along the wrong grid line,
  when it ended in a short sideways hook or snapped sideways to a grid point at
  either end. The way it runs is now judged over a longer stretch of what you
  drew. A stroke that ends on the grid point it started on is no longer cut.
- `main.js` now carries the licence notice of perfect-freehand, which it
  bundles, and the README credits it. Earlier releases left the notice out.
- A shape drawn with the eraser, with Ellipse or Polygon, can now be seen while
  it is drawn: it is tinted over the drawing, even where there is no ink to take
  away, and the tint isn't part of the symbol.
- Keep the edges of **Make ink** sharp on a dim picture, such as a dark
  screenshot of a game
  ([dim screenshots](https://github.com/viell-dev/slop-inkline/issues/135)). The
  ink's edge now narrows with the contrast between the two sides of the
  threshold; its fixed width spanned most of the levels of such a picture, and
  left its edges as soft as they were. A picture whose ink and ground are mostly
  pure black and white makes the same ink as before; other pictures, such as
  screenshots of small text, get slightly sharper edges. A picture with any
  transparency keeps the whole ramp, and its soft edges. Symbols made before
  keep their ink; make ink of the picture again to sharpen one.

### Changed

- **Fill** is now **Toggle fill**, with a new icon, as it is a switch for the
  shapes drawn next and not a paint bucket to click a shape with.
- The toolbar has three rows: the drawing tools; the brush sizes, Undo, Redo and
  Clear; then the view and saving. Zoom keeps them all in view, growing less
  tall in a window too short for it.
- **Next** has the same colour as **Save**, and **Fit**'s tooltip says what it
  does.
- **Copy from** shows each symbol's picture beside its name, as the list of
  symbols to insert does.
- The Grid size slider shows only its number, which had wrapped onto two lines
  with its unit, and the guide settings say "shown in purple" and so on rather
  than "by default", as the colours aren't a choice there.
- **Zoom** doubles the grid as well as the drawing: while zoomed it has twice as
  many cells each way, so the default 5 cells across the x-height become 10.
  Every point of the usual grid stays a point of the finer one, so a drawing
  started in either view lines up in the other, and the usual grid comes back
  where it was, however much was drawn while zoomed. **Grid size** keeps its
  range, and saved symbols are not affected. To keep the finer grid on whole
  file units, column spacing is now an even number of them, which moves it by at
  most 1/16 pixel.
- Simplify documentation navigation and maintenance guidance, clarify the draft
  format's verification limits, and make the existing stable-publication hold
  explicit in the release guide.

## 0.3.0-alpha.8 - 2026-10-29

This alpha fills the shapes from the 0.1.1-rc.1 feedback
([filled shapes](https://github.com/viell-dev/slop-inkline/issues/122)), which
the [shape tools](https://github.com/viell-dev/slop-inkline/issues/73) left
open.

### Added

- **Fill** (B) in the editor draws ellipses, and polygons closed on their first
  corner, solid: shapes such as ● ▲ ■ ◆ with the pen, and holes of their shape
  with the eraser. A filled shape's edges run through its corners, so on the
  grid it sits within its lines, whatever the brush size. It works with Ellipse
  and Polygon, and **Next** keeps it. Symbols with filled shapes record them in
  a new optional stroke `fill` field; earlier versions show them as saved, but
  draw an outline instead if they edit the symbol.

### Fixed

- **Fit** and the image's edges shown while drawing reach as far as a polygon's
  sharp corners, which could reach past them.

## 0.3.0-alpha.7 - 2026-10-29

This alpha completes the shape tools from the 0.1.1-rc.1 feedback
([shape tools](https://github.com/viell-dev/slop-inkline/issues/73)) with shapes
that have straight sides and sharp corners, which the owner asked for with a
lightning bolt as the example.

### Added

- **Polygon** (Y) in the editor draws shapes with straight sides and sharp
  corners, such as triangles, rectangles, and lightning bolts: click each
  corner, then click the first corner again to close the shape, or the last
  corner, or press Enter, to leave it open. Undo takes back a corner and Esc
  drops the shape. On the grid, corners snap to it and an open shape's ends stop
  flush with the grid line. Symbols with polygons record them in a new optional
  stroke `kind` field; earlier versions show them as saved, but draw a polygon
  as a smoothed stroke through its corners if they edit the symbol.

## 0.3.0-alpha.6 - 2026-10-28

This alpha brings the first of the shape tools from the 0.1.1-rc.1 feedback
([shape tools](https://github.com/viell-dev/slop-inkline/issues/73)); the
straight-sided shapes with sharp corners follow. Public stable publication
remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Added

- **Ellipse** (O) in the editor makes dragging draw an ellipse across the box
  dragged, with the pen or the eraser at its brush size; hold Shift for a
  circle. On the grid, the box's corners snap to it, a circle's along its longer
  side. Press it again to draw freehand; **Next** keeps it on. An ellipse is an
  ordinary stroke in the file.

## 0.3.0-alpha.5 - 2026-10-28

This alpha follows the owner's comment that a stroke drawn to a grid line spills
past it in a round end, to be erased by hand
([flat ends](https://github.com/viell-dev/slop-inkline/issues/117)), and the
independent review of 0.3.0-alpha.4, which found the pressed buttons' text hard
to read ([contrast](https://github.com/viell-dev/slop-inkline/issues/118)).
Public stable publication remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Changed

- With the grid on, a stroke's ends stop flush with the grid line they lie on,
  instead of rounding past it: a row for a stroke that comes in at 45° or
  steeper, as the legs of an A come down to the baseline, and a column for a
  flatter one. Dots, and ends drawn with the grid off, stay round; the eraser is
  cut the same way. Symbols with such strokes record the cuts in a new optional
  `cut` field; earlier versions show them as saved, but draw those ends round
  again if they edit the symbol.

### Fixed

- A pressed editor button, such as the chosen tool, draws its text at 4.5:1 or
  better against its background with Obsidian's accent colours, where the
  default accent gave 3.43:1 in the light theme.

## 0.3.0-alpha.4 - 2026-10-28

This alpha follows the 0.1.1-rc.1 suggestion of familiar drawing-tool icons on
the editor's buttons
([icons](https://github.com/viell-dev/slop-inkline/issues/74)). Public stable
publication remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Added

- The editor's buttons show an icon from Obsidian's own set beside their names,
  by default. **Editor buttons** in the settings chooses **Icons and text**,
  **Icons only**, which keeps the toolbar to one row in a wide editor, or **Text
  only**, as before. The brush sizes keep their letters, and the bar that Make
  ink opens keeps its words. Under every choice, tooltips and screen readers
  give each button's name, and its shortcut where it has one.

## 0.3.0-alpha.3 - 2026-10-28

This alpha follows the 0.1.1-rc.2 report that detailed symbols are hard to draw
in the wide, shallow drawing area
([zoom](https://github.com/viell-dev/slop-inkline/issues/87)). Public stable
publication remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Added

- **Zoom** (Z) in the editor shows the drawing twice as large in a taller
  drawing area, for fine detail, as far as the window has room. The wheel or the
  left and right arrow keys move along the drawing; Fit centres it; Next keeps
  the zoom. Saved symbols stay the same size in notes.

## 0.3.0-alpha.2 - 2026-10-28

This alpha follows the owner's request for a button that opens a picture to
trace over
([choose picture](https://github.com/viell-dev/slop-inkline/issues/110)). Public
stable publication remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Added

- **Choose picture…** in the editor's picture bar opens your system's file
  dialog, which reaches files in the vault and outside it, and traces the
  picture you choose as a pasted one is. The bar's hint now reads "Paste, drop,
  or choose a picture to trace over it."

## 0.3.0-alpha.1 - 2026-10-28

This alpha follows the 0.1.1-rc.2 report that saving an edited symbol changed it
in every note without a choice
([save choices](https://github.com/viell-dev/slop-inkline/issues/85)).
Pre-releases are now named as alphas, as their features and file format can
still change; the version moves to 0.3.0 so that it comes after 0.2.0-rc.1.
Public stable publication remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Changed

- Releases are alphas for now, and until the first stable release the
  [file format](https://viell-dev.github.io/slop-inkline/file-format#versions)
  is a draft: a later alpha may change what symbol files hold, and need not open
  files an earlier one saved. The changelog says when that happens; this alpha
  opens every file the earlier releases saved.

### Added

- Saving a changed symbol that your notes use more than once asks first whether
  to **Replace** it everywhere, or to keep editing. Closing with unsaved changes
  asks the same in one question, with Discard. For a variant that leaves the
  symbol as it is, start a new symbol with **Copy from**.

## 0.2.0-rc.1 - 2026-10-28

This candidate follows the rc.2 report that the grid met the baseline but none
of the font's other lines, and could be finer
([grid](https://github.com/viell-dev/slop-inkline/issues/84)). Candidates now
number from 0.2.0, as the 0.1.1 candidates since rc.2 have added features as
well as fixes. Public stable publication remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Changed

- The editor's grid is laid out on your note's font: its rows pass through the
  baseline and each guide line chosen in the settings, and divide the space
  between two lines evenly, so that strokes can start and end on the x-height
  and cap height as well as the baseline. It is finer by default, with 5 cells
  across the x-height where 1/8 em gave just over 4 in a font such as Inter.
  Shift with an arrow key moves a picture by one column of this grid.

### Added

- A **Grid size** setting chooses how many grid cells span the x-height, from 2
  to 10.

## 0.1.1-rc.10 - 2026-10-27

This candidate follows the rc.1 report that the drawing guides were hard to tell
apart and could only be shown or hidden together
([guides](https://github.com/viell-dev/slop-inkline/issues/72)). Public stable
publication remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Added

- Each guide line has a colour of its own, from your theme: ascender purple, cap
  height blue, x-height green, baseline orange, and descender pink, named in
  Help and the settings. Light themes draw the green and orange darker, for
  contrast. A CSS snippet can change them.
- A **Guides** group in the settings turns each font line on or off. The setting
  that shows guides in a new editor is now **Show in a new editor**, in the same
  group; G still shows or hides the chosen lines.

## 0.1.1-rc.9 - 2026-10-27

This candidate follows the rc.2 report that new symbols land in the vault's top
folder ([symbol folder](https://github.com/viell-dev/slop-inkline/issues/86)).
Public stable publication remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Added

- A **Symbol folder** setting names a folder in the vault for new symbols, such
  as `Symbols`. Inkline makes it, with any folders it is in, when it saves the
  first symbol there. Empty, the default, keeps them where Obsidian puts a
  note's new attachments. Symbols already in the vault stay where they are.

## 0.1.1-rc.8 - 2026-10-27

This candidate narrows Inkline to the setup it is built and tested for, as the
owner decided in [#101](https://github.com/viell-dev/slop-inkline/issues/101):
desktop Obsidian with a mouse or a trackpad. The pen-device support it removes
is kept on the
[pen-input branch](https://github.com/viell-dev/slop-inkline/tree/pen-input).
Public stable publication remains on hold, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Removed

- Pen pressure, a pen's eraser end, palm rejection, and the **Pen pressure**
  setting. A drawing tablet's pen or a touchscreen now draws as a mouse does,
  one pointer at a time, at the brush's width. Symbols drawn with pressure in
  earlier versions keep it and look the same, and saving them again leaves those
  strokes as they are.

## 0.1.1-rc.7 - 2026-10-27

This candidate follows the rc.2 report that the brush sizes did not match the
weight of text
([pen weights](https://github.com/viell-dev/slop-inkline/issues/88)). No human
check is requested for this candidate; comfort feedback is welcome. Public
stable publication remains on hold, and a human pass covering these sizes is
required before any stable release, as the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) records.

### Changed

- Match the brush sizes to the weight of text. **M** now draws about as thick as
  regular text and **L** near bold text, where M was about 1.4 times as heavy as
  text. **S** is about half the weight of text, for fine detail, and **XL**
  heavier still. Each size is three quarters of what it was, for the Pen and the
  Eraser alike; the keys, labels and the default size are unchanged. Strokes
  already drawn keep their width, so new strokes added to an older symbol can
  look lighter than its earlier ones of the same size.

## 0.1.1-rc.6 - 2026-10-27

This candidate follows the rc.3 report that **Make ink** gave a symbol blurry
edges
([automatic conversion softness](https://github.com/viell-dev/slop-inkline/issues/92)).
The rc.5 brush circle is unchanged, and no further human check is needed for
this objective pixel fix. Public stable publication remains on hold, with the
earlier [workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5)
tracked separately.

### Fixed

- Keep the edges of **Make ink** sharp when the picture is shown larger than its
  own pixels, such as a small screenshot scaled up to a capital's height. The
  picture is sampled at the drawing's finer resolution before the threshold
  applies, rather than each thresholded pixel being enlarged, which spread every
  edge across several pixels. Symbols made before keep their ink; make ink of
  the picture again to sharpen one. A picture with transparency still keeps the
  soft edges of that transparency
  ([#96](https://github.com/viell-dev/slop-inkline/issues/96)).

## 0.1.1-rc.5 - 2026-10-27

The rc.4 report confirmed that the brush cursor's shape stays fixed, but its
white halo looked too heavy on dark backgrounds. This candidate addresses that
[contrast feedback](https://github.com/viell-dev/slop-inkline/issues/90), with
automated pixel checks and screenshot review. Further comfort feedback is
welcome; it does not block continued prereleases. Public stable publication
remains on hold, with the earlier
[workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5) and
[automatic conversion softness](https://github.com/viell-dev/slop-inkline/issues/92)
tracked separately.

### Fixed

- Keep the brush circle and centre dot thin on both themes and over ink or
  tracing pictures. Their colour adapts to the background without the extra
  white halo, preserving the fixed shape and selected brush size.

## 0.1.1-rc.4 - 2026-10-27

This candidate follows the
[rc.3 cursor report and focused retest](https://github.com/viell-dev/slop-inkline/issues/90).
The remaining practical checks passed; the changed cursor still needs a focused
human pass. Public stable publication remains on hold.
[Automatic conversion softness](https://github.com/viell-dev/slop-inkline/issues/92)
is tracked separately, alongside the earlier
[drawing-workflow feedback](https://github.com/viell-dev/slop-inkline/issues/5).

### Fixed

- Keep the brush cursor's shape fixed during movement. A bitmap replaces the
  repainted outline, with the selected brush diameter at the current zoom and
  display scale. Its black ring, centre dot and white halo remain visible on
  both themes and tracing pictures; a crosshair provides a visible fallback.

## 0.1.1-rc.3 - 2026-10-26

This candidate has a focused
[brush-cursor test request](https://github.com/viell-dev/slop-inkline/issues/90).
The previous candidate's practical pass is complete.
[Grid alignment](https://github.com/viell-dev/slop-inkline/issues/84),
[save choices](https://github.com/viell-dev/slop-inkline/issues/85),
[attachment folders](https://github.com/viell-dev/slop-inkline/issues/86),
[editing zoom](https://github.com/viell-dev/slop-inkline/issues/87) and
[pen weights](https://github.com/viell-dev/slop-inkline/issues/88) remain
tracked for later candidates.

### Fixed

- Use one brush ring with a centre dot while drawing, removing the competing
  system crosshair. Restore the ordinary cursor when the brush indicator is
  hidden, and keep the grab cursor when moving a tracing picture.

## 0.1.1-rc.2 - 2026-10-26

### Added

- A circle showing the mouse or pen brush's nominal size, scaled with the
  drawing area. Pen pressure can change the stroke width.
- A Help button with a built-in quick start and explanations of the guides.
- Separate Pen and Eraser sizes while the editor is open and through Next. Each
  newly opened editor starts both at the configured default size.

### Fixed

- Refresh existing symbol instances after their file changes, without reopening
  the note, in both text-colour and stored-grey display modes.
- Keep the editor's close control clear of the symbol name in both themes.
- Remove the drawing area's redundant hover tooltip, keeping its accessible
  name.

## 0.1.1-rc.1 - 2026-10-25

### Added

- A versioned install ZIP that extracts directly into `.obsidian/plugins/`, with
  the same three plugin files as the loose release assets. Both forms have
  checksums and verified build provenance.

### Changed

- Manual installation and updates are the documented path, without a separate
  installer plugin. The guide includes the expected directory layout and how to
  preserve preferences and drawings during updates.
- Release candidates have explicit SemVer prerelease versions. The published
  `0.1.0` tag and assets remain unchanged.
- Documentation corrections deploy from `main` with their build commit recorded
  on every page.

## 0.1.0 - 2026-10-24

### Added

- Native PDF export shows symbols inline with the text, preserving size,
  baseline, colour preferences, and explicit embed sizes.
- **Rename** in the symbol library edits a symbol's name directly in its row,
  using the same name rules as its drawing editor and Obsidian's link updates.
  Enter or Save applies it; Esc or Cancel keeps the old name. Errors keep the
  entered name for correction or retry. Renaming leaves the PNG bytes as they
  are and refuses a file deleted and replaced while its name is being edited.
- **Settings → Inkline:** symbol size from 50% to 200% of the usual line height,
  text colour or stored grey, the insert trigger, the starting brush, pen
  pressure, and guides. Size and colour update open notes and popout windows
  immediately, while explicit embed sizes stay as written. Preferences survive
  reloads; read and write failures show a notice, and rapid changes are stored
  in order.
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
  as the
  [rendering contract](https://viell-dev.github.io/slop-inkline/rendering)
  describes for theme and plugin authors.
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
