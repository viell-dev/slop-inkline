# Settings

Open **Settings → Inkline** to change these choices:

| Setting        | Default                     | What it changes                                                                           |
| -------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| Symbol size    | 100%                        | Height relative to the usual line height, from 50% to 200%, in steps of 5%.               |
| Text colour    | On                          | Symbols take the colour of the surrounding text. Off, they show their stored grey pixels. |
| Insert trigger | `;;`                        | These characters and a few letters of a name list symbols to insert.                      |
| Brush size     | M, the second of four sizes | The brush an editor starts with.                                                          |
| Pen pressure   | On                          | A pen's new strokes follow its pressure. Off, their thickness follows the brush alone.    |
| Guides         | Shown                       | Whether an editor starts with the text's lines shown. G still toggles them there.         |

Size and colour apply at once to existing symbols in open notes, including
Reading view, Live Preview, and popout windows. At 100%, symbols are 1.5 times
the text's size, the usual line height. A size written in an embed, as in
`![[tower.ink.png|24]]`, stays as written. These settings change how symbols
show, leaving the PNG files and their strokes as they are.

The trigger changes at once. It has one to eight characters, no whitespace or
`[`, `]`, or `|`, and at least one character that is not a letter or digit. An
invalid trigger is refused, keeping the last valid one.

Brush size and guides apply when an editor opens. **Next** keeps the previous
editor's tools instead. Pen pressure applies when each stroke starts; changing
it leaves existing strokes as drawn. A mouse's strokes have no pen pressure.

Settings are kept in the vault's Inkline plugin data and survive reloading
Obsidian. Unreadable or invalid preferences use defaults. If a write fails, a
notice says the change applies for the session; the next successful change
stores the current choices together.

Where new symbols go is Obsidian's own setting, under **Settings → Files and
links → Default location for new attachments**.
