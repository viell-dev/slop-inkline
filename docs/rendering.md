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

Inkline watches every window, popouts included, and tags images as Obsidian adds
them or changes their address or size. Disabling Inkline removes every tag, and
symbols show as the plain images they are.

## What a tagged image gets

- The class `inkline-symbol`.
- The custom property `--inkline-mask`, a CSS `url()` of the image's own
  address, which masks its background, so that its ink shows in the text's
  colour.
- For an image with a size of its own, as `![[x.ink.png|24]]` gives, the custom
  property `--inkline-drop`, how far below the baseline its bottom lies. Without
  it the drop is `-0.375em`, for an image 1.5 em tall.
- In Live Preview, where the image is a block inside the editor's embed, that
  embed gets the class `inkline-symbol-embed`, and takes the drop in place of
  the image. The resize handle Obsidian puts on an image embed there is hidden,
  as it is larger than a symbol at text size, and so are the buttons it shows on
  an image 80 pixels or wider, Zoom in and Edit this block; on 1.14.4, a second
  click on a selected image still opens Obsidian's image viewer. A drag that
  starts on a symbol is Obsidian's drag of an image, which puts a copy of its
  embed where it ends.
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

Inkline's styles paint the ink with `background-color: currentColor`. To colour
symbols differently from the text around them, set `color` on
`img.inkline-symbol`.

## Symbols in a view of your own

`MarkdownRenderer.render` does not add `markdown-rendered` to the element it
renders into, so symbols in a view that renders a note's text with it show as
pictures. Add the class `inkline-text` to that element, or to one around it, for
symbols to show as text there, without Obsidian's own styles for rendered notes;
`markdown-rendered` works as well, with them.
