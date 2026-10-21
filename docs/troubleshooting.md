# Problems and reports

## Common problems

**A symbol shows as a large grey picture.** Inkline is off, or did not load:
check that it is turned on under **Settings → Community plugins**. Inkline shows
only images from the vault whose file names end in `.ink.png` as characters; any
other image stays a picture. A symbol file opened in its own tab stays a picture
too.

**Insert symbol is not in the command palette.** It needs a note open in editing
view, Live Preview or source mode, where there is a cursor to insert at; Reading
view has none.

**Edit symbol is not offered.** The command needs the cursor on a symbol's
embed, outside code and front matter. Some of Obsidian's own menus have no Edit
symbol; [Known limits](./limits.md#menus-without-edit-symbol) lists them and
what to use instead.

**Typing `;;` lists nothing.** The list does not open in code or front matter,
nor when a space follows `;;` straight away. With no symbols in the vault yet,
it says so. Typed with a space, a name matches only symbols whose names hold
what you typed.

**"… was saved by a newer version of Inkline."** Update Inkline, as
[Install](./install.md#update) describes; this version will not edit the symbol,
so that it never loses what the newer one stored.

**"Could not save the symbol: …"** The reason follows the colon, such as a name
refused or a file that could not be written. The editor stays open with the
drawing, which is also kept as a draft: fix what the notice says, and save
again.

**"… is saved, but could not be renamed: …"** The drawing is saved under the old
name, and the new name stays in the editor's name field, for the next save to
try again.

**"The note changed where the symbol was going, so it was added at the end of
…"** The text around the place where you started the symbol changed too much to
be found again. The symbol is at the end of that note; move its embed where it
belongs.

**"Inkline could not keep a draft of the latest changes …"** The vault's local
storage refused the draft, as when it is full. Save the symbol to keep the
changes.

**A symbol has the wrong colour or size.** A theme or a CSS snippet can change
how images in text look. [Rendering in notes](./rendering.md) describes the
classes and properties Inkline gives symbols, for theme and snippet authors.

## Report a problem

Search the
[open and closed issues](https://github.com/viell-dev/slop-inkline/issues?q=is%3Aissue)
first, then open a
[bug report](https://github.com/viell-dev/slop-inkline/issues/new?template=bug.yml)
with:

- the Inkline version, or for a development build the commit it was built from,
  which `git rev-parse --short HEAD` prints in its folder;
- the Obsidian version and installer version, both under **Settings → General**,
  and your operating system;
- what you draw with: a mouse, a trackpad, a pen, or touch;
- numbered steps from a new vault or note, with any theme or other plugin the
  problem needs;
- what happened, with any message, and what you expected instead.

A screenshot, or a `.ink.png` file that shows the problem, helps. Use synthetic
examples only, and leave private notes and drawings out of every report.

Ask a question with the
[question form](https://github.com/viell-dev/slop-inkline/issues/new?template=question.yml),
and suggest a feature with the
[feature form](https://github.com/viell-dev/slop-inkline/issues/new?template=feature.yml).
Report a vulnerability privately, as the
[security policy](https://github.com/viell-dev/slop-inkline/blob/main/SECURITY.md)
describes, never in a public issue.
