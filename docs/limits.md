# Known limits

What Inkline does not do yet, or does not do everywhere, and what to do instead.
The [issues](https://github.com/viell-dev/slop-inkline/issues) track each one.

## Not there yet

- **Prerelease.** Install from GitHub releases, by hand or with BRAT; Inkline is
  not in Obsidian's community directory. See [Install](./install.md).
- **Desktop only.** Obsidian's mobile apps do not offer Inkline. The host tests
  run on Linux; Windows and macOS should work but are not tested.
- **Mouse or trackpad.** A drawing tablet's pen or a touchscreen draws as a
  mouse does: pen pressure and a pen's eraser end are not supported. Symbols
  drawn with pressure in earlier versions keep it.
- **Large libraries** show every matching symbol at once, without paging. Filter
  by name or folder to narrow the list.
- **Library insertion needs a sidebar.** If the library's tab is dragged into
  the main area, move it back to a sidebar to insert into a note.
- **Physical printing** has not been checked. Native
  [PDF export](./notes.md#export-a-note-to-pdf) is verified on Linux.

## Menus without Edit symbol

Where one of Obsidian's own menus takes a right-click on a symbol, that menu has
no **Edit symbol** ([#40](https://github.com/viell-dev/slop-inkline/issues/40)):

- **Callouts and tables in Live Preview**, where Obsidian shows its menu for the
  callout or the table;
- **A text card on a canvas that is not selected**, where the canvas shows its
  menu for the card. Click the card once, and a right-click on the symbol then
  shows the symbol's menu;
- **A canvas text card's own editor**, which does not offer the command
  **Inkline: Edit symbol**.

Instead, right-click the symbol in Reading view, or its file in the file
explorer, or put the cursor on its embed in the note and run **Inkline: Edit
symbol**. A symbol placed on a canvas as a file card has Edit symbol in the
canvas's menu for that file.

## Links Obsidian writes

With **Use \[\[Wikilinks\]\]** off, Obsidian writes Markdown links, and leaves a
`%` or an unbalanced parenthesis in a file name as it is, so that such a link
can lead nowhere or to another file
([#35](https://github.com/viell-dev/slop-inkline/issues/35)). Inkline checks
every embed it inserts: it writes such a `%` as `%25`, and names a symbol whose
link would still lead elsewhere by its path in the vault.

## Files and sizes

- A symbol's pixels changed by another program that keeps Inkline's chunk do not
  show in Inkline's editor, which draws the strokes; see
  [Without Inkline](./without-inkline.md#editing-them-elsewhere).
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
  which cannot say what you want traced, so move the slider where it is wrong. A
  small bright element can draw it away from dim strokes, leaving them no ink
  ([#147](https://github.com/viell-dev/slop-inkline/issues/147)).
  **Unreleased:** that now happens mainly where the element is larger or lies
  close to the strokes, where the strokes are thick or run off the picture's
  edge, or where noise blurs the picture's two tones. The opposite mistake is
  also possible, as the two look the same: a small symbol off to one side of a
  dim thin shape, such as an outline, is taken for a label beside strokes. The
  symbol stays whole and the shape becomes ink too. Move the slider towards the
  symbol's own tone to leave the shape out, or move the picture so that the
  symbol is in the middle.
- **Unreleased:** **Make ink** counts a picture's transparency as its ground
  where more than a third of what the drawing area shows is clear, as around a
  glyph. A capture of a window with a wide shadow can fall on that side when all
  of it is in view, and then starts with its ground as the ink: move or scale
  the picture to bring less of the shadow into view
  ([#148](https://github.com/viell-dev/slop-inkline/issues/148)). The preview of
  a very large capture with dark ink can show a rim along the window's edge,
  which Apply does not make.
- Every symbol shows in notes at the size and baseline Inkline saves, whatever
  geometry another tool wrote into its file.
- Images from outside the vault are left as they are, even when their names end
  in `.ink.png`.
