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
- For an image with a size of its own, as `![[x.ink.png|24]]` gives, the custom
  property `--inkline-drop`, how far below the baseline its bottom lies. Without
  it the drop is `-0.375em` times the configured scale, for an image 1.5 em tall
  at the default 100%.
- In Live Preview, where the image is a block inside the editor's embed, that
  embed gets the class `inkline-symbol-embed`, and takes the drop in place of
  the image. The resize handle Obsidian puts on an image embed there is hidden,
  as it is larger than a symbol at text size, and so are the buttons it shows on
  an image 80 pixels or wider, Zoom in and Edit this block. What Obsidian does
  with a selected image stays: a second click opens its image viewer, where
  Obsidian has one, as it does since 1.13.2, and `+`, `-`, and `0` resize it. A
  drag that starts on a symbol is Obsidian's drag of an image, which puts a copy
  of its embed where it ends.
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
