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

Inkline also watches the document in a frame as soon as the frame is in a
watched document, and each new document the frame loads, and stops as the frame
goes. So a canvas text card's own editor is watched as Obsidian moves it into
its frame, before it takes the focus, and one already open as Inkline starts is
watched at once. It watches only frames whose window Obsidian has prepared, as
it does for a card's editor: a frame that a note embeds, and frames from another
origin, stay out of its reach.

When a symbol file changes, Inkline refreshes its tagged images in every watched
document. The image source and mask use a fresh resource URL, including a cache
key so that consecutive saves with the same file timestamp still reload. Note
text and explicit image sizes stay unchanged.

Inkline also remembers, for each image element it has tagged, how many times its
symbol file had been refreshed when it last saw the image. An element that was
out of every watched document as a refresh ran, as when Obsidian takes part of
Reading view out and puts the same images back, or moves a card's editor into
its frame, takes the latest refresh's address as it comes back, if it still has
the address it had then. One whose address changed meanwhile, as Obsidian gives
once the file changes again, keeps it. An image element that Obsidian makes anew
is new to Inkline, and keeps the address it comes with: if that is an address
from before the refresh, as when Obsidian draws an embed again from an address
it kept, it shows what the page holds for that address until the note is shown
again. A symbol file deleted, made, or moved starts afresh, so that an element
of the file before keeps its own address and an element of the new one never
gets the old one's.

## What a tagged image gets

- The class `inkline-symbol`.
- The custom property `--inkline-mask`, a CSS `url()` of the image's own
  address, which masks its background, so that its ink shows in the text's
  colour.
- Once the image has loaded, the custom property `--inkline-ratio`, its own
  width over its height, from which its mask is sized.
- For an image with a size of its own, as `![[x.ink.png|24]]` gives, the custom
  property `--inkline-drop`, how far below the baseline its bottom lies. Without
  it the drop is `-0.375em` times the configured scale, for an image 1.5 em tall
  at the default 100%. For a size of only a width, as `|1000` gives, also
  `--inkline-width`, that width in pixels, from which a narrower space lessens
  the drop, as below.
- In Live Preview, where the image is a block inside the editor's embed, that
  embed gets the class `inkline-symbol-embed`, and takes the drop in place of
  the image, and the properties above with it. The resize handle Obsidian puts
  on an image embed there is hidden, as it is larger than a symbol at text size,
  and so are the buttons it shows on an image 80 pixels or wider, Zoom in and
  Edit this block. What Obsidian does with a selected image stays, but for a
  double-click: a later, separate click on the selected image opens its image
  viewer, where Obsidian has one, as it does since 1.13.2, and `+`, `-`, and `0`
  resize it, while a double-click opens the symbol in Inkline's editor instead,
  as [Edit a symbol](./notes.md#edit-a-symbol) says. A drag that starts on a
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
evenly smaller, with `object-fit: contain` for its pixels and its mask sized as
below, at `0 75%`: three quarters of the way down the height left over, which
keeps its baseline on the text's. A line can't break inside a symbol as it can
inside a long word, and a symbol that overflowed would be cut off at a preview's
or a page's edge. In 0.9.2 only its width gave way, so such a symbol showed
squeezed sideways. An image with an explicit size is as wide as Obsidian makes
it. A snippet that gives `img.inkline-symbol` a width of its own gets the same:
the ink whole and in its own shape, at the left of the box and three quarters of
the way down, rather than stretched to fill it. A symbol that fits is drawn as
before to within a pixel: exactly where its box lands on whole pixels, and
elsewhere with its ink up to half a pixel off.

The mask is sized from its box's width rather than with `contain`:
`min(100%, …)` of it, where the second value is the symbol's width at the line's
height, `1.5em` times the scale times `--inkline-ratio`, and as tall as that
width gives. Chromium works out a percentage of the box from its exact width,
but `contain` from its size rounded to whole pixels, and then rounds it again,
so where a symbol fell in the line moved its ink. In 16-pixel text, a box 10.5
pixels wide drawn 10 wide drew its ink 0.75 pixels higher than one drawn 11
wide, and in 17-pixel text the symbols of a line were up to 0.69 pixels apart.
So the ink of a symbol that fits is drawn at its box's own size wherever the box
falls, and in a box wider than the symbol at the line's height, as a snippet's,
whole at that height and at the left. Its height is the line's times
`--inkline-scale`, the Symbol size setting: a snippet that gives
`img.inkline-symbol` a `height` of its own gets a box that tall, with the ink
still at the line's height in it, three quarters of the way down the height left
over, and so not on the baseline. In 16-pixel text, at the default 100% and at
150%, and zoomed to 200%, a symbol's baseline is on the baseline of the letters
beside it, which Obsidian draws on whole pixels too. At other text sizes, Symbol
sizes, and zoom levels, the letters' baseline and the box's top each land on a
whole pixel, and the ink's baseline lies three quarters of the way down the box,
so it stands off the letters' baseline by up to about a pixel at 100% zoom (1.06
measured), and at other zoom levels by up to 1.75 pixels in Obsidian 1.13.4 and
1.00 in 1.15.1 as measured, where `contain` reached 1.94 and 1.25. The symbols
of a line then stand within half a pixel of each other at 100% zoom, and within
a pixel at other zoom levels: as measured, up to 0.94 apart in Obsidian 1.15.1
and 0.31 in 1.13.4. Until the image has loaded, the box's width alone sizes the
mask.

An explicit size of only a width that is wider than the symbol's space, as
`|1000` in a hover preview, also keeps the symbol's baseline on the text's.
Obsidian shrinks such an image evenly to its space, with `max-width: 100%`, its
height following, while its drop is worked out for the height the size asks for.
A bottom margin takes back a quarter of the height that shrinking took away:
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
shortening the line. Without the margin, such a symbol sat below the baseline by
the difference: about 3.6 pixels with a 700-pixel line, and 7.5 in a hover
preview, for a symbol 4,000 × 192 at `|1000`.

With text colour on, Inkline's styles paint the ink with
`background-color: currentColor`. To colour symbols differently from the text
around them, set `color` on `img.inkline-symbol`. With text colour off, the mask
and background are removed and the image's own pixels show in the same layout.

## Symbols in a PDF

**Unreleased.** With text colour on, a symbol in Obsidian's PDF export window
prints from a copy of its own pixels in the colour its text prints in, rather
than through its mask. Chromium writes a CSS mask into a PDF as a fill drawn
twice, the first time through a soft mask that adds nothing, and PDF viewers
that anti-alias the two draws apart can leave a faint line, a pixel wide, along
the symbol's box at some zoom levels
([#255](https://github.com/viell-dev/slop-inkline/issues/255)). A symbol in its
stored colour is an image with its own alpha, drawn once, and shows none; the
copy prints the same way.

- In the export window, Inkline's Markdown post-processor returns a promise for
  the symbols in what Obsidian gives it: the note's text, and each section of a
  note it embeds. Obsidian 1.13.4 and 1.15.1 print once every post-processor's
  promise has resolved, and 200 ms more. The promise resolves once each symbol
  shows its copy or keeps its mask, or once no copy has got any further for 10
  seconds: an export that keeps the main window busy can take longer than that,
  and a read that never ends holds the export no longer.
- The copy is made from the symbol's file, read from the vault, at the file's
  own size, in the image's computed `color` as it prints: Inkline reads it with
  the page's media queries for print in force and those for the screen out of
  it, for a moment, as the page is not printing yet. So a note's text, which
  Obsidian's print styles give `color: initial`, prints black where the screen
  shows the theme's text colour, and links and callout titles keep their own.
  Media features, such as a width, are read as the export window has them.
  Meanwhile each symbol, and each element it takes its colour from, has an
  inline `transition-property: none !important`, taken away again after, so that
  a transition on `color` does not answer with the screen's colour, which the
  print would not show. Before that, Inkline waits for the window's stylesheet
  links to load, as Obsidian copies them into it while it renders the note.
- The image's `src` becomes the copy's `blob:` address. Its mask goes on
  painting it until the copy has loaded, and only then does it get the class
  `inkline-print-copy`, which shows its pixels as text colour off does. A symbol
  whose copy cannot be made, as from a file that cannot be read or decoded, or
  is not ready in time, keeps its mask and prints as before. So does one whose
  file says which way up it shows, in an `eXIf` chunk, which Inkline never
  writes: Chromium 150 turns its image and mask to match, and a copy would not.
- When the window closes, each image gets its own address back and loses the
  class, and the copies are let go.

## Symbols in a view of your own

`MarkdownRenderer.render` does not add `markdown-rendered` to the element it
renders into, so symbols in a view that renders a note's text with it show as
pictures. Add the class `inkline-text` to that element, or to one around it, for
symbols to show as text there, without Obsidian's own styles for rendered notes;
`markdown-rendered` works as well, with them.
