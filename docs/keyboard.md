# Keyboard and accessibility

## Commands

Inkline's commands are in Obsidian's command palette. None has a hotkey of its
own; give one any of them under **Settings → Hotkeys**.

| Command                             | What it does                                                               |
| ----------------------------------- | -------------------------------------------------------------------------- |
| **Inkline: Insert symbol**          | Opens the editor for a new symbol, inserted at the cursor once saved.      |
| **Inkline: Insert existing symbol** | Lists your symbols to search, and inserts the one chosen at the cursor.    |
| **Inkline: Edit symbol**            | Opens the symbol whose embed the cursor is on in the editor.               |
| **Inkline: Show symbol library**    | Opens the Symbols view in the right sidebar.                               |
| **Inkline: Recover drafts**         | **Unreleased:** Lists drafts whose symbol's file is gone or does not open. |

The insert commands are offered in a note in editing view, and **Edit symbol**
only with the cursor on a symbol's embed. In a note, the insert trigger, `;;` by
default, and a few letters of a symbol's name, or of a reading or translation,
list your symbols as you type; the arrow keys choose one, Enter inserts it, and
Esc closes the list.

In the library, Tab reaches the filter, the folder selector, each row's symbol,
**Uses**, and **Quick edit** buttons, and the notes in an expanded list. Enter
activates a button or opens a note; Space also activates a button. Inserting
keeps the focus in the library for the next symbol.

**Quick edit** opens a symbol's name, readings, and translations in its row,
with the name selected, and Tab moves on through the readings, translations,
**Save**, and **Cancel**. Enter in the name saves; in the readings or
translations it starts another value. Mod+Enter saves from any field, and Esc
cancels. Afterward focus returns to the symbol's Quick edit button, or to the
filter if the symbol no longer shows.

The row's symbol and **Quick edit** buttons stay above the fields, so Shift+Tab
from the name reaches **Quick edit** and then the symbol; the row's **Uses**
waits with the other rows'. **Quick edit** tells a screen reader that its fields
are open, and Enter, Space, or Esc on it closes them as **Cancel** does, with
the focus staying on it.

While a row is in Quick edit, Tab passes over the other rows' **Uses** and
**Quick edit** buttons and **Show more**, which wait for it to close. A screen
reader names them as before, says that they are unavailable, and says to save or
cancel Quick edit to use them. A click on one leaves the focus where it was.

**Show more** moves the focus to the first of the new rows, so that Tab goes on
from there.

## The editor's keys

Mod is Ctrl, or Cmd on macOS. Each button's tooltip shows its key. The keys that
would also type, the single keys and undo and redo, give way to a text field
that has the focus, such as the name field; the saving keys work anywhere in the
editor.

The drawing area has focus as soon as the editor opens, so a shortcut works
immediately. Select the name field to type a name; Enter returns to drawing.

| Key                       | Button      | What it does                                             |
| ------------------------- | ----------- | -------------------------------------------------------- |
| P                         | Pen         | Draw.                                                    |
| E                         | Eraser      | Take ink away.                                           |
| O                         | Ellipse     | Draw ellipses by dragging, or freehand again.            |
| Y                         | Polygon     | Draw shapes by clicking their corners, or freehand.      |
| Enter                     |             | End a polygon being drawn, leaving it open.              |
| B                         | Toggle fill | Fill ellipses and closed polygons, or not.               |
| 1, 2, 3, 4                | S, M, L, XL | Choose the brush size.                                   |
| Mod+Z                     | Undo        | Undo the last change, or a polygon's last corner.        |
| Mod+Shift+Z, or Mod+Y     | Redo        | Redo it.                                                 |
| Delete, or Backspace      | Clear       | Clear the drawing; Undo brings it back.                  |
| G                         | Guides      | Show or hide the guides.                                 |
| Shift+G                   | Grid        | Show or hide the grid, a guide that Shift snaps to.      |
| T                         | Flat ends   | End strokes that Shift put on the grid flat, or round.   |
| Shift, held while drawing |             | Draw a straight line, and snap to the grid if it is on.  |
| V                         | Copy from   | Start a new symbol from a copy of another.               |
| F                         | Fit         | Centre the drawing; out of Zoom, show a wide one whole.  |
| ArrowUp                   | Up          | Move the drawing up a pixel; Shift, a grid cell's width. |
| ArrowDown                 | Down        | Move it down the same way.                               |
| Z                         | Zoom        | Show the drawing twice as large, or as usual again.      |
| M                         | Move        | Move and scale the picture being traced, or draw again.  |
| I                         | Make ink    | Turn the picture being traced into ink.                  |
| Mod+Enter                 | Save        | Save and close.                                          |
| Mod+S                     |             | Save and keep drawing.                                   |
| Mod+Shift+Enter           | Next        | Save, insert, and start the symbol that follows.         |
| Esc                       |             | Drop a polygon being drawn, or else close the editor.    |

Shift held while drawing snaps to the grid at a press, a release, and each
polygon corner you click. With the grid on, Shift with Ellipse snaps the box's
corners; with the grid off, it makes a circle.
[Drawing](./drawing.md#straight-lines-and-the-grid) says what Shift does at each
moment.

Closing the editor with unsaved changes asks first. While **Move** is on, the
arrow keys move the picture, with Shift by one column of the grid, and + and −
scale it. Otherwise, the up and down arrow keys move the drawing, and while
**Zoom** is on, the left and right arrow keys, and the wheel, move along it. Tab
goes from the name field to the button that shows the readings and translations;
Enter or Space on it opens their fields and moves there, where Enter starts
another value. A second press closes them and returns to the drawing.

Copy from and Next are only in the editor for a new symbol. Make ink's threshold
is a slider, which its arrow keys move; **Light ink**, **Apply**, and **Cancel**
are buttons, as are **Choose picture…**, which opens the system's file dialog,
and **Remove picture**.

**Zoom** also shows the grid with twice as many cells each way, so while it is
on, Shift with an arrow key moves the picture by a column of that finer grid.

The **Help** button opens a quick start and guide explanations. Esc closes Help
and returns focus to the drawing area.

## Accessibility

- Every control has a label which screen readers read, whether its button shows
  an icon, a name, or both. Toolbar tooltips also include their shortcuts. The
  pen, the eraser, Ellipse, Polygon, Toggle fill, the brush sizes, the guides,
  the grid, Zoom, Move, Make ink, and Light ink say whether they are on.
- The drawing area keeps its accessible name without a hover tooltip.
- The library's list of symbols and its Quick edit area keep their names for
  screen readers without showing a tooltip where the pointer rests.
- The fields for readings and translations have labels, and say when a list
  cannot be saved. Each value in a list shows in its own direction, so
  right-to-left text reads as it should beside other text.
- In a right-to-left interface, as Obsidian's in Hebrew, Inkline's screens are
  mirrored with Obsidian's, and its English, which it does not translate, keeps
  its full stops and ellipses where English puts them, in the editor and its
  Help, the library, the settings, its tooltips, and its notices.
- The editor's status line, such as "Saving…", "Saved", or "Not saved" and why,
  is announced as it changes. It speaks only for the last thing you did: a key
  or button with nothing to say, such as **Fit**, empties it without a word,
  rather than leave an earlier message to read as its result, and the buttons
  that turn something on or off say so themselves.
- The editor puts the focus on the drawing area when it opens, and drawing puts
  it back there, so that its keys work again after typing elsewhere.
- Hovering a symbol in a note shows its name, which screen readers read as the
  image's name.
- Drawing itself needs a pointer, such as a mouse or a trackpad. Make ink turns
  a pasted picture into a symbol without drawing, with the keyboard moving and
  scaling the picture.
