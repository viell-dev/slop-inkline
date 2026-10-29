# Inkline file format, version 1

An Inkline symbol is a PNG file whose name ends in `.ink.png`. Its pixels show
the symbol, so any program that shows PNG images shows it. A chunk inside the
PNG holds the strokes the symbol was drawn with, so that Inkline can edit it
again without loss. This document specifies the pixels, that chunk, and how
strokes are drawn, for anyone writing a tool that reads or writes Inkline files.

The words "must", "must not", "should", and "may" are used as in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## Pixels

The image is the symbol in one grey, `#7e7e7e`, with the ink in the alpha
channel: fully transparent where there is no ink. The grey has a contrast of
about 4:1 against white and against the default dark backgrounds of Obsidian and
GitHub, so the symbol stays legible in programs that show the image as it is.
Inkline itself paints the alpha channel in the colour of the surrounding text
and ignores the colour channels.

## Geometry

The image maps to one line of text. Version 1 writes:

- 128 pixels per em;
- a height of 192 pixels, 1.5 em, which is Obsidian's default line height, so a
  symbol does not widen the line it sits in;
- the baseline 144 pixels from the top, 0.375 em above the bottom, which leaves
  room for the descenders of Obsidian's default font.

The width is whatever the symbol needs: when saving, Inkline crops the image to
the columns that hold ink, adds a side bearing of 8 pixels (1/16 em) on each
side, as a font spaces its glyphs, and widens a narrower result evenly to 48
pixels (3/8 em), so that a dot stays easy to click. A drawing with no ink is 48
pixels wide.

To show the image in text, scale it to `height / pxPerEm` em tall and set its
`vertical-align` to `-(height - baseline) / pxPerEm` em; its baseline then lies
on the text's. For version 1 files that is 1.5 em and -0.375 em. Inkline itself
shows every symbol in a note at version 1's size and baseline, since it tells
symbols apart by their addresses, without reading the files; a file written with
another geometry, which Inkline never writes, shows at version 1's.

## File structure

The file is a PNG as defined by the
[PNG specification](https://www.w3.org/TR/png-3/). Inkline refuses a file whose
chunks are not well formed: a bad signature, length, chunk type, or CRC; an
`IHDR` that is missing, not first, repeated, or invalid; a missing, misplaced,
repeated, or forbidden `PLTE`, or one that does not hold 1 to 256 whole RGB
entries, or more than the bit depth can index; no `IDAT` or `IDAT` chunks that
are not consecutive; or a missing or non-empty `IEND`. It ignores bytes after
`IEND`. When Inkline saves a symbol, it writes the image as 8-bit RGBA (colour
type 6), not interlaced, with no colour chunks.

Inkline adds one chunk:

- type `iTXt` (international textual data);
- keyword `inkline`;
- compression flag 1 and compression method 0, so the text is compressed with
  zlib;
- an empty language tag and an empty translated keyword;
- as text, the record described below, as JSON in UTF-8.

A writer must write at most one such chunk, should place it right after `IHDR`,
and must compress it. A reader must accept the chunk anywhere a PNG allows an
`iTXt` chunk, must use the first one, and should also accept uncompressed text
(compression flag 0), ignoring the compression method as PNG requires. Other
chunks, including other `iTXt` chunks, are not part of the format. A writer that
rewrites a file with new pixels should keep the ancillary chunks that PNG marks
safe to copy (a lowercase first and fourth letter, such as `tEXt` and `pHYs`),
each on the side of the image data it was on, as PNG's rules for editors
require, with `pHYs` and `eXIf` before it as PNG requires of them; and it should
drop those it marks unsafe to copy, such as `gAMA` and `iCCP`, which describe
the old pixels. Inkline does so, placing those before the image data after the
record, keeping text chunks alongside its own, and keeping other types only when
the new image has none.

A writer must not write a record that a reader would refuse, including one whose
text is longer than the limit below, and must not replace a record with a higher
version than it knows (see [Compatibility](#compatibility)).

Because the record is an ancillary chunk, programs that do not know it keep
showing the image. Some image optimizers and converters remove ancillary chunks;
the file then shows the same symbol but holds no record (see
[Files without a usable record](#files-without-a-usable-record)).

## The record

The record is a JSON object. Inkline writes its fields in the order shown, with
no spaces, so that the same record always produces the same text; readers must
not depend on the order or on whitespace.

```json
{
  "format": "inkline",
  "version": 1,
  "box": { "pxPerEm": 128, "width": 64, "height": 192, "baseline": 144 },
  "strokes": [
    {
      "tool": "pen",
      "size": 160,
      "pressure": true,
      "points": [160, 800, 128, 480, 1600, 200]
    },
    { "tool": "eraser", "size": 320, "pressure": false, "points": [-80, 1200] }
  ],
  "base": { "x": 160, "y": 320, "scale": 2, "png": "iVBORw0KGgo…" }
}
```

### Units and coordinates

Coordinates and stroke sizes are integers in _units_ of one sixteenth of an
image pixel. The origin is the image's top left corner, with x to the right and
y downwards. Coordinates may lie outside the image, for example where an eraser
stroke starts beyond the edge.

### Fields

| Field          | Type    | Meaning                                                       |
| -------------- | ------- | ------------------------------------------------------------- |
| `format`       | string  | Always `"inkline"`.                                           |
| `version`      | integer | The record version, 1 for this document.                      |
| `box`          | object  | The image's geometry, in pixels.                              |
| `box.pxPerEm`  | integer | Image pixels per em of the text the symbol sits in.           |
| `box.width`    | integer | The image's width; must equal the width in `IHDR`.            |
| `box.height`   | integer | The image's height; must equal the height in `IHDR`.          |
| `box.baseline` | integer | The text baseline, in pixels from the top; at most `height`.  |
| `strokes`      | array   | The strokes, in the order they were drawn. May be empty.      |
| `base`         | object  | Optional. Imported pixels that the strokes draw on and erase. |

Each stroke is an object:

| Field      | Type    | Meaning                                                                               |
| ---------- | ------- | ------------------------------------------------------------------------------------- |
| `tool`     | string  | `"pen"` adds ink; `"eraser"` removes it.                                              |
| `size`     | integer | The stroke's diameter, in units.                                                      |
| `pressure` | boolean | Whether each point carries pressure, as from a pen in versions before 0.1.1-rc.8.     |
| `points`   | array   | The points in drawing order, flattened: `x, y` per point, or `x, y, p` with pressure. |
| `kind`     | string  | Optional. `"polygon"` for straight sides between the points, as below.                |
| `cut`      | object  | Optional. The ends cut flat at a line through them, as below.                         |

Pressure `p` is an integer from 0 to 255. A stroke has at least one point; a
single point is a dot, round, or square for a polygon.

A stroke without `kind` is drawn as the pointer went, smoothly, with round ends.
With `kind` `"polygon"`, its points are the corners of a polygon, joined by
straight sides with sharp corners and square ends; one whose last point is its
first, with at least three corners, is closed. A polygon has no pressure: its
`pressure` must be `false`. A reader must refuse any other `kind`.

A stroke's `cut` has an optional `start` and an optional `end`, for its first
and last point, each `"up"`, `"down"`, `"left"`, or `"right"`: the way from that
point across the line through it, horizontal for `"up"` and `"down"` and
vertical for `"left"` and `"right"`, past which the end's ink is cut away.
Inkline writes them for strokes drawn on its grid, whose ends lie on grid lines,
so that they stop flush with the line: a stroke that comes down to the baseline
has the end `"down"`. An empty `cut` is the same as none. Inkline writes `false`
for every new stroke, as it no longer records pen pressure, but reads and draws
strokes with pressure as before, and saving a symbol again keeps them as they
are.

The base layer is an object:

| Field   | Type    | Meaning                                                                                    |
| ------- | ------- | ------------------------------------------------------------------------------------------ |
| `x`     | integer | The base image's left edge, in units.                                                      |
| `y`     | integer | The base image's top edge, in units.                                                       |
| `scale` | number  | Image pixels per base image pixel, from 1/64 to 64.                                        |
| `png`   | string  | A well-formed PNG file in base64 (RFC 4648, with padding), whose alpha channel is the ink. |

### Limits

A reader must refuse a record that breaks a type or range above, and should
refuse one beyond these limits, which Inkline applies:

| Limit                                    | Value             |
| ---------------------------------------- | ----------------- |
| `box.pxPerEm`                            | 16 to 1024        |
| `box.width`, `box.height`                | 1 to 8192         |
| Strokes                                  | 10,000            |
| Points, across all strokes               | 1,000,000         |
| Absolute coordinate                      | 2²⁴ units         |
| Stroke size                              | 1 to 65,536 units |
| Base image file                          | 8 MiB             |
| Base image width and height              | 1 to 4096 pixels  |
| Record text, compressed or not, in UTF-8 | 16 MiB            |

## Drawing the strokes

The pixels are a rendering of the record, so a reader that redraws the strokes
gets the same image, up to antialiasing. Inkline draws on a transparent canvas
of the image's size, with the record's coordinates as they are:

1. The base layer, if any: its PNG decoded without colour management (ignoring
   `gAMA`, `iCCP`, and similar chunks), its colours replaced by the grey and its
   alpha kept, drawn at (`x / 16`, `y / 16`) pixels at `scale` times its own
   size, `width × scale` by `height × scale` pixels, with the canvas's
   high-quality image smoothing.
2. Each stroke in order: its outline, or a polygon's pieces, filled in the grey,
   over what is there for `"pen"` and removing it for `"eraser"` (the canvas
   compositing operations `source-over` and `destination-out`). A stroke with a
   `cut` is filled in two parts: its outline, or its pieces, everywhere except
   in a box for each cut end, and then, inside those boxes only, those of the
   rest of the stroke, below.

For a cut end at the point (`x / 16`, `y / 16`) pixels, with reach
`r = size / 16 + 1` pixels, the box spans:

| Cut       | Across             | Down               |
| --------- | ------------------ | ------------------ |
| `"down"`  | `x − r` to `x + r` | `y` to `y + r`     |
| `"up"`    | `x − r` to `x + r` | `y − r` to `y`     |
| `"right"` | `x` to `x + r`     | `y − r` to `y + r` |
| `"left"`  | `x − r` to `x`     | `y − r` to `y + r` |

The box reaches past the end's round cap, a radius of `size / 32` pixels, with a
pixel to spare for the soft edge. The end's own ink there is the spill the cut
removes, but another part of the stroke can pass through the box, as when it
comes back near its end. So the rest of the stroke is drawn in the boxes again:
the stroke's points without, from each cut end, those whose distance from it
along the stroke, point to point, is less than `2 × size` units. It is drawn
with the same options and its own round ends, which lie clear of the boxes when
the stroke comes straight into its cut ends, and not at all when no points are
left. The rest of a polygon is described with polygons, below.

A stroke's outline is the polygon that
[perfect-freehand](https://github.com/steveruizok/perfect-freehand) 1.2.3's
`getStroke` returns for its points, with each point given as
`[x / 16, y / 16, p / 255]`, or `[x / 16, y / 16, 0.5]` without pressure, and
these options:

| Option             | Value                        |
| ------------------ | ---------------------------- |
| `size`             | `size / 16`                  |
| `thinning`         | 0.5 with pressure, 0 without |
| `smoothing`        | 0.5                          |
| `streamline`       | 0.5                          |
| `simulatePressure` | false                        |
| `start`, `end`     | `{ cap: true, taper: 0 }`    |
| `last`             | true                         |

The polygon is filled as a closed curve: starting at the midpoint of its first
edge, a quadratic curve to the midpoint of each following edge, with the corner
between them as the control point, back to the start. A single point draws a
round dot; a polygon's single corner draws a square, as below.

### Polygons

A polygon `w = size / 16` pixels wide is drawn through its corners at (`x / 16`,
`y / 16`) pixels, leaving out each point equal to the one before it. It is
closed if at least four points are left and the last equals the first, which is
then left out too, and the sides go round from the last corner back to the
first; otherwise it is open. Its pieces are all filled together, with the
nonzero rule, each wound the same way, so that the fill covers each piece once:

- Each side is a rectangle `w` wide, centred on the line between its corners. An
  open polygon's first and last sides reach `w / 2` past its end corners, so
  that its ends are square.
- Each corner where two sides meet and turn, every corner of a closed polygon
  and all but the ends of an open one, has a wedge on the outer side of the
  turn: from the corner point to the two sides' outer edges, and out along them
  to where they meet. Where they meet more than `2 × w` from the corner point,
  as at a corner sharper than about 29°, the wedge stops at a line square to the
  corner's bisector, `2 × w` from the corner point. A side that doubles back on
  the one before turns 180°, and its wedge is the rectangle `w` wide from the
  corner point `2 × w` along the first side.
- A polygon with a single corner is a square `w` wide, centred on it, with its
  sides along the axes.

This is the shape of an SVG 2 stroke with `stroke-linejoin: miter-clip`,
`stroke-miterlimit: 4`, and `stroke-linecap: square`. A closed polygon has no
ends, so a `cut` on it has no effect. For an open polygon with a `cut`, the rest
drawn in its cut boxes is the polygon from `2 × size` units along its sides from
each cut end, drawn by the same rules but with flat ends where it was cut
(`stroke-linecap: butt`); nothing when no length is left.

### Antialiasing

How a canvas antialiases curves and resamples images is up to each
implementation, so another renderer, or another version of Chromium, may differ
by a little at the edges of the ink; the record, the base layer's alpha, and the
stored pixels are exact. Partly transparent pixels are stored premultiplied by
canvases, so their grey can vary by a step or two; the alpha is what counts.

## Compatibility

Until Inkline's first stable release, this format is a draft, as every release
so far is an alpha. It can change in any way a feature needs, with or without a
new `version`, and a later alpha need not open files an earlier one wrote;
Inkline converts them where that is cheap, and the changelog says which files
stop opening or look different. From the first stable release on, the rules
below hold for the format that release writes.

A reader must ignore fields it does not know, so that a later version can add
optional fields without changing `version`. Stroke `cut` was added so, in
0.3.0-alpha.5: earlier versions open files with it and show their stored pixels,
but draw those ends round again once they edit the symbol. Stroke `kind` was
added so too, in 0.3.0-alpha.7: earlier versions show a polygon's stored pixels,
but draw it as a stroke through its corners, smoothed and with round corners,
once they edit the symbol. A change that a version 1 reader could not handle
correctly increases `version`. A reader must not edit a file whose record has a
higher version than it knows, since writing it would lose what that version
recorded; it may still show the file's pixels.

The files in [test/fixtures/format](../test/fixtures/format) pin what files hold
now, and the tests read them on every change. Until the first stable release, a
change to the format changes them in the same pull request; from then on,
Inkline keeps reading every file of the format released, and they never change.

A record whose geometry differs from what version 1 writes, as another tool may
write it, is still valid. Inkline edits it by scaling it to 128 pixels per em
and moving it so that the baselines meet, rounding coordinates to whole units
and sizes to whole units of at least 1, and saves it with version 1's geometry.

If that scaling would take a coordinate, size, or base scale past the format's
limits, Inkline opens the file from its pixels instead, as for a file without a
usable record, rather than clamp or drop strokes. A record with version 1's
geometry always opens as it is.

## Files without a usable record

A file has no usable record when it has no `inkline` chunk, when the chunk is
malformed or its text does not decompress, when the record breaks this format,
when `box.width` and `box.height` differ from the image's size, as after another
program resized it, or when its base layer's image does not decode. Inkline then
opens the file's pixels as a base layer, and saving it writes a new record. A
file whose record has a higher version is not edited, as
[Compatibility](#compatibility) requires.

The base layer keeps the file's pixels at their own resolution, decoded without
colour management, scaled so that the image fills the line box's height, from
the left edge. A picture under 3 pixels high would need a scale above the limit
of 64, so each of its pixels is repeated 3 times (1 pixel high) or twice (2
pixels high), across and down, which keeps what it shows. Its ink is:

- the alpha channel, when any pixel is not fully opaque;
- otherwise 255 minus each pixel's luminance (0.2126 R + 0.7152 G + 0.0722 B,
  rounded), so that dark ink on a light ground, as in a screenshot, becomes ink.

Files saved by Inkline's prototype, before this format, are opaque grey ink on
white, as tall as its stored size: 192 pixels by default, which is the same
scale as version 1, so they open unscaled.

Inkline opens such pictures up to 4096 pixels a side, including after repeating
their pixels, and only when their ink encodes to a PNG within the base image
limit of 8 MiB, since a base layer beyond it could not be saved.

## Cropping

When Inkline saves, it looks for the ink the drawing leaves inside the line box,
drawing at most 4096 pixels across at a time, so that strokes far away, below or
above the line box, or erased cost no large canvas. It crops to that ink as
[Geometry](#geometry) describes, then draws the image from the cropped record
and checks the crop there, adjusting it until the record's own drawing confirms
it. The stored pixels are therefore exactly what the record draws, and opening
and saving a file again changes neither. Strokes that leave no visible ink stay
in the record. A crop wider than 8192 pixels, the largest image, is refused, and
so is one that would move a stroke past the coordinate limit, which only a
stroke about a million pixels from the ink comes near.
