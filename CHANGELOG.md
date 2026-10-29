# Changelog

Notable changes to Inkline, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers are
SemVer versions; pre-releases carry a suffix such as `-alpha.N`. Each release's
section is also its
[GitHub release](https://github.com/viell-dev/slop-inkline/releases)'s notes.

## Unreleased

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
  [file format](https://viell-dev.github.io/slop-inkline/file-format#compatibility)
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
