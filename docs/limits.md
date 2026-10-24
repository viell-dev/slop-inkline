# Known limits

What Inkline does not do yet, or does not do everywhere, and what to do instead.
The [issues](https://github.com/viell-dev/slop-inkline/issues) track each one.

## Not there yet

- **No release.** Inkline is under development; see [Install](./install.md).
- **Desktop only.** Obsidian's mobile apps do not offer Inkline.
- **No symbol library.** A sidebar view of all your symbols, with how many notes
  use each, is planned. Meanwhile, the file explorer lists the files ending in
  `.ink.png`, and a symbol file's backlinks list the notes that use it.
- **Printing and PDF export** of notes with symbols have not been checked yet.

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
- Every symbol shows in notes at the size and baseline Inkline saves, whatever
  geometry another tool wrote into its file.
- Images from outside the vault are left as they are, even when their names end
  in `.ink.png`.

## Rare cases

- If a symbol's file is renamed elsewhere while its editor is saving a rename of
  its own, the status can say "Saved, but not renamed" though the rename
  happened; the file keeps the name it was given last
  ([#43](https://github.com/viell-dev/slop-inkline/issues/43)).
