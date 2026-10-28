# Settings

Open **Settings → Inkline** to change these choices:

| Setting        | Default                     | What it changes                                                                           |
| -------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| Symbol size    | 100%                        | Height relative to the usual line height, from 50% to 200%, in steps of 5%.               |
| Text colour    | On                          | Symbols take the colour of the surrounding text. Off, they show their stored grey pixels. |
| Insert trigger | `;;`                        | These characters and a few letters of a name list symbols to insert.                      |
| Symbol folder  | Empty                       | The folder in the vault for new symbols. Empty puts them where new attachments go.        |
| Brush size     | M, the second of four sizes | The starting size for both Pen and Eraser.                                                |
| Grid size      | 5 cells                     | How many of the grid's cells span the font's x-height, from 2 to 10.                      |
| Editor buttons | Icons and text              | What the editor's buttons show: icons and text, icons only, or text only.                 |
| Guides         | Shown, with every line      | Whether an editor starts with the guides shown, and which font lines they show.           |

Size and colour apply at once to existing symbols in open notes, including
Reading view, Live Preview, and popout windows. At 100%, symbols are 1.5 times
the text's size, the usual line height. A size written in an embed, as in
`![[tower.ink.png|24]]`, stays as written. These settings change how symbols
show, leaving the PNG files and their strokes as they are.

The trigger changes at once. It has one to eight characters, no whitespace or
`[`, `]`, or `|`, and at least one character that is not a letter or digit. An
invalid trigger is refused, keeping the last valid one.

Brush size sets both Pen and Eraser when an editor opens. Each tool then keeps
its own chosen size, including through **Next**. Under **Guides**, **Show in a
new editor** applies when an editor opens, and **Next** keeps the current
visibility; G still shows or hides the guides there. One toggle for each font
line, ascender, cap height, x-height, baseline and descender, chooses whether
the guides include it, and applies the next time the drawing area redraws.

**Grid size** sets how many cells of the editor's grid span the x-height of your
note's font: more cells make a finer grid. The grid's rows also pass through
each font line turned on under **Guides**, whether the guides are shown or not,
and divide the space between two lines evenly;
[Drawing](./drawing.md#straight-lines-and-the-grid) explains the grid. Both
apply the next time the drawing area redraws.

**Editor buttons** chooses what the editor's buttons show when an editor opens:
**Icons and text**, an icon from Obsidian's own set beside each button's name,
as by default; **Icons only**, which keeps the toolbar to one row in a wide
editor; or **Text only**. The brush sizes keep their letters, and the bar that
**Make ink** opens keeps its words, under every choice. Each button's tooltip
still gives its name and shortcut, and screen readers read the same names.

Settings are kept in the vault's Inkline plugin data and survive reloading
Obsidian. Unreadable or invalid preferences use defaults. If a write fails, a
notice says the change applies for the session; the next successful change
stores the current choices together.

New symbols go where Obsidian puts a note's new attachments, as **Settings →
Files and links → Default location for new attachments** says, unless **Symbol
folder** names a folder in the vault from its top, such as `Symbols` or
`Conlang/Signs`. Empty, or just `/`, follows Obsidian. Inkline makes the folder,
and any folder it is in, when it saves the first symbol there; a folder there
already whose name differs only in letter case is used instead. Symbols already
in the vault stay where they are.

The folder is stored as you type. Text that cannot name a folder in the vault
isn't stored, and the box says why: `.` or `..`, a name starting with a dot,
which hides it from Obsidian, or characters a file name cannot hold. If a file
stands where the folder would be, the save stops with a message and the drawing
stays open.
