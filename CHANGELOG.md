# Changelog

Notable changes to Inkline, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers are
plain `x.y.z` from 0.9.0 on, where an odd minor version is a pre-release and an
even one a public release; earlier pre-releases carry a suffix such as
`-alpha.N`. Each release's section is also its
[GitHub release](https://github.com/viell-dev/slop-inkline/releases)'s notes.

## Unreleased

### Fixed

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
