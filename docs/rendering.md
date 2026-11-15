# How Inkline shows symbols in text

For theme and plugin authors: what Inkline changes in Obsidian's pages to show
symbols as characters, and how a view of your own can show them so.

## Which images

Inkline tags an image when its address is a file in the vault whose name ends in
`.ink.png`, and it lies inside text: an element with the class
`markdown-rendered`, as Reading view, embedded notes, hover previews, and canvas
cards have; the editor's `.cm-content`; or an element with the class
`inkline-text`. Any other image of a symbol file, as in the file's own tab or a
canvas's image node, stays a picture at its own size. Images from outside the
vault, and other images, are left as they are.

Inkline watches the main window, workspace popouts, and documents Obsidian
renders Markdown into, including its temporary PDF export windows. It tags
images as Obsidian adds them or changes their address or size. Closing a window
stops its observer and removes its display settings. Disabling Inkline removes
every tag, and symbols show as the plain images they are.

Inkline also watches a document in a frame from when the frame takes the focus,
as a canvas text card's own editor does as it opens. So a card's editor already
open as Inkline starts shows plain images until it takes the focus again. Frames
from another origin stay out of its reach.

When a symbol file changes, Inkline refreshes its tagged images in every watched
document. The image source and mask use a fresh resource URL, including a cache
key so that consecutive saves with the same file timestamp still reload. Note
text and explicit image sizes stay unchanged.

## What a tagged image gets

- The class `inkline-symbol`.
- The custom property `--inkline-mask`, a CSS `url()` of the image's own
  address, which masks its background, so that its ink shows in the text's
  colour.
- **Unreleased:** once the image has loaded, the custom property
  `--inkline-ratio`, its own width over its height, from which its mask is
  sized.
- For an image with a size of its own, as `![[x.ink.png|24]]` gives, the custom
  property `--inkline-drop`, how far below the baseline its bottom lies. Without
  it the drop is `-0.375em` times the configured scale, for an image 1.5 em tall
  at the default 100%. **Unreleased:** for a size of only a width, as `|1000`
  gives, also `--inkline-width`, that width in pixels, from which a narrower
  space lessens the drop, as below.
- In Live Preview, where the image is a block inside the editor's embed, that
  embed gets the class `inkline-symbol-embed`, and takes the drop in place of
  the image, and, **Unreleased**, the properties above with it. The resize
  handle Obsidian puts on an image embed there is hidden, as it is larger than a
  symbol at text size, and so are the buttons it shows on an image 80 pixels or
  wider, Zoom in and Edit this block. What Obsidian does with a selected image
  stays: a second click opens its image viewer, where Obsidian has one, as it
  does since 1.13.2, and `+`, `-`, and `0` resize it. A drag that starts on a
  symbol is Obsidian's drag of an image, which puts a copy of its embed where it
  ends.
- The attribute `aria-label` with a name, which screen readers read as the
  image's name and Obsidian shows as a tooltip, above the image, once the
  pointer is on it: the text the embed's author wrote for the image, as a wiki
  link's alias or a Markdown link's alt text, or else the symbol's name, its
  file's name without `.ink.png`. A size, as `|24` gives, or the link as
  written, which Obsidian puts there of itself, is no such text. With it,
  `data-inkline-name` holding the same, and `data-tooltip-position="top"` unless
  the image had a position, with `data-inkline-placed`, so that untagging
  removes only what Inkline gave. An image with `aria-hidden="true"`, as a
  picture beside its name in a list, or with an `aria-label` of its own keeps it
  as it is. In a canvas card that is not being edited, Obsidian keeps the
  pointer off the card's content, so only screen readers get the name there.

Each watched document's root has `--inkline-scale`, the symbol size as a factor,
1 by default. Symbols without an explicit size use it for their height and drop;
explicit sizes keep their own height and drop. The root also has
`inkline-stored-color` when text colour is off. Both are removed when Inkline
stops watching the document.

A symbol without an explicit size is no wider than the space it is in, with
`max-width: 100%`, as Obsidian's own styles give an image in a note. Where that
space is narrower than the symbol, as a very wide one's can be in a hover
preview, a table cell, a narrow pane, or a PDF page, its box takes the space's
width and keeps its height and drop, and its ink is drawn in the box whole and
evenly smaller, with `object-fit: contain` for its pixels and
`mask-size: contain` for its mask, at `0 75%`: three quarters of the way down
the height left over, which keeps its baseline on the text's. A line can't break
inside a symbol as it can inside a long word, and a symbol that overflowed would
be cut off at a preview's or a page's edge. In 0.9.2 only its width gave way, so
such a symbol showed squeezed sideways. An image with an explicit size is as
wide as Obsidian makes it. A snippet that gives `img.inkline-symbol` a width of
its own gets the same: the ink whole and in its own shape, at the left of the
box and three quarters of the way down, rather than stretched to fill it. A
symbol that fits is drawn as before to within a pixel: exactly where its box
lands on whole pixels, and elsewhere with its ink up to half a pixel off.

**Unreleased:** the mask is sized from its box's width rather than with
`contain`: `min(100%, …)` of it, where the second value is the symbol's width at
the line's height, `1.5em` times the scale times `--inkline-ratio`, and as tall
as that width gives. Chromium works out a percentage of the box from its exact
width, but `contain` from its size rounded to whole pixels, and then rounds it
again, so where a symbol fell in the line moved its ink. In 16-pixel text, a box
10.5 pixels wide drawn 10 wide drew its ink 0.75 pixels higher than one drawn 11
wide, and in 17-pixel text the symbols of a line were up to 0.69 pixels apart.
Now the ink of a symbol that fits is drawn at its box's own size wherever the
box falls, and in a box wider than the symbol at the line's height, as a
snippet's, whole at that height and at the left. Its height is the line's times
`--inkline-scale`, the Symbol size setting: a snippet that gives
`img.inkline-symbol` a `height` of its own gets a box that tall, with the ink
still at the line's height in it, three quarters of the way down the height left
over, and so not on the baseline. In 16-pixel text, at the default 100% and at
150%, and zoomed to 200%, a symbol's baseline is on the baseline of the letters
beside it, which Obsidian draws on whole pixels too. At other text sizes, Symbol
sizes, and zoom levels, the letters' baseline and the box's top each land on a
whole pixel, and the ink's baseline lies three quarters of the way down the box,
so it stands within about a pixel of the letters' baseline. The symbols of a
line then stand within half a pixel of each other at 100% zoom, and within a
pixel at other zoom levels: 0.69 apart at 120% in Obsidian 1.15.1. Until the
image has loaded, the box's width alone sizes the mask.

**Unreleased:** an explicit size of only a width that is wider than the symbol's
space, as `|1000` in a hover preview, also keeps the symbol's baseline on the
text's. Obsidian shrinks such an image evenly to its space, with
`max-width: 100%`, its height following, while its drop is worked out for the
height the size asks for. A bottom margin takes back a quarter of the height
that shrinking took away:
`calc(max(0px, var(--inkline-width) - 100%) / var(--inkline-ratio) / 4)`. Its
percentage is of the same width as Obsidian's `max-width`, the space's, so the
drop follows the height shown wherever the symbol is laid out. That includes PDF
export, which lays the note out again at the page's width: `|1000` of a symbol
that the export window showed 921 pixels wide printed about 650 wide, so a drop
worked out by script from the window's layout would be wrong on the page.
Inkline declares the image's `max-width: 100%` too, as the margin is right only
with it. In Live Preview the embed takes the margin. Every embed there of a size
of only a width, whether it fits or not, is an inline block that clips what
overflows it, around a block-level flex box holding the image, so that it lines
up by its bottom margin edge, rather than Obsidian's inline flex box, which
lines up by its image's bottom whatever its margin; where the size fits, the
margin is none and the embed sits as before. A plain block in place of the flex
box, tried in a probe, put the image twice as far below the baseline. The line
keeps room below its baseline for the drop the size asks for, a quarter of that
height: the margin raises the image within the room the drop makes rather than
shortening the line. In 0.9.3 such a symbol sat below the baseline by the
difference: about 3.6 pixels with a 700-pixel line, and 7.5 in a hover preview,
for a symbol 4,000 × 192 at `|1000`.

With text colour on, Inkline's styles paint the ink with
`background-color: currentColor`. To colour symbols differently from the text
around them, set `color` on `img.inkline-symbol`. With text colour off, the mask
and background are removed and the image's own pixels show in the same layout.

## Symbols in a view of your own

`MarkdownRenderer.render` does not add `markdown-rendered` to the element it
renders into, so symbols in a view that renders a note's text with it show as
pictures. Add the class `inkline-text` to that element, or to one around it, for
symbols to show as text there, without Obsidian's own styles for rendered notes;
`markdown-rendered` works as well, with them.
