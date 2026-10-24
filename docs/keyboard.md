# Keyboard and accessibility

## Commands

Inkline's commands are in Obsidian's command palette. None has a hotkey of its
own; give one any of them under **Settings → Hotkeys**.

| Command                             | What it does                                                            |
| ----------------------------------- | ----------------------------------------------------------------------- |
| **Inkline: Insert symbol**          | Opens the editor for a new symbol, inserted at the cursor once saved.   |
| **Inkline: Insert existing symbol** | Lists your symbols to search, and inserts the one chosen at the cursor. |
| **Inkline: Edit symbol**            | Opens the symbol whose embed the cursor is on in the editor.            |
| **Inkline: Show symbol library**    | Opens the Symbols view in the right sidebar.                            |

The insert commands are offered in a note in editing view, and **Edit symbol**
only with the cursor on a symbol's embed. In a note, `;;` and a few letters of a
symbol's name list your symbols as you type; the arrow keys choose one, Enter
inserts it, and Esc closes the list.

In the library, Tab reaches the name filter, folder selector, symbol buttons,
usage counts, and the notes in an expanded list. Enter activates a button or
opens a note; Space also activates a button. Inserting keeps the focus in the
library for the next symbol.

**Rename** edits a name in its row. Enter saves it, and Esc cancels it; the
**Save** and **Cancel** buttons do the same. Afterward focus returns to the
symbol's Rename button, or to the name filter if the symbol no longer shows.

## The editor's keys

Mod is Ctrl, or Cmd on macOS. Each button's tooltip shows its key. The keys that
would also type, the single keys and undo and redo, give way to a text field
that has the focus, such as the name field; the saving keys work anywhere in the
editor.

| Key                       | Button      | What it does                                            |
| ------------------------- | ----------- | ------------------------------------------------------- |
| P                         | Pen         | Draw.                                                   |
| E                         | Eraser      | Take ink away.                                          |
| 1, 2, 3, 4                | S, M, L, XL | Choose the brush size.                                  |
| Mod+Z                     | Undo        | Undo the last change.                                   |
| Mod+Shift+Z, or Mod+Y     | Redo        | Redo it.                                                |
| Delete, or Backspace      | Clear       | Clear the drawing; Undo brings it back.                 |
| G                         | Guides      | Show or hide the guides.                                |
| Shift+G                   | Grid        | Show or hide the grid, which snaps the ends of strokes. |
| Shift, held while drawing |             | Draw a straight line.                                   |
| V                         | Copy from   | Start a new symbol from a copy of another.              |
| F                         | Fit         | Fit the drawing in view.                                |
| M                         | Move        | Move and scale the picture being traced, or draw again. |
| I                         | Make ink    | Turn the picture being traced into ink.                 |
| Mod+Enter                 | Save        | Save and close.                                         |
| Mod+S                     |             | Save and keep drawing.                                  |
| Mod+Shift+Enter           | Next        | Save, insert, and start the symbol that follows.        |
| Esc                       |             | Close, asking first if something is unsaved.            |

While **Move** is on, the arrow keys move the picture, with Shift in larger
steps, and + and − scale it. Copy from and Next are only in the editor for a new
symbol. Make ink's threshold is a slider, which its arrow keys move; **Light
ink**, **Apply**, and **Cancel** are buttons, as is **Remove picture**.

## Accessibility

- Every control has a label, which screen readers read and its tooltip shows,
  and the pen, the eraser, the brush sizes, the guides, the grid, Move, Make
  ink, and Light ink say whether they are on.
- The editor's status line, such as "Saving…", "Saved", or "Not saved" and why,
  is announced as it changes.
- The editor puts the focus on the drawing area when it opens, and drawing puts
  it back there, so that its keys work again after typing elsewhere.
- Hovering a symbol in a note shows its name, which screen readers read as the
  image's name.
- Drawing itself needs a pointer: a mouse, a pen, a trackpad, or touch. Make ink
  turns a pasted picture into a symbol without drawing, with the keyboard moving
  and scaling the picture.
