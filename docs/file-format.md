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
on the text's. For version 1 files that is 1.5 em and -0.375 em.

## File structure

The file is a PNG as defined by the
[PNG specification](https://www.w3.org/TR/png-3/). Inkline refuses a file whose
chunks are not well formed: a bad signature, length, chunk type, or CRC; an
`IHDR` that is missing, not first, repeated, or invalid; a missing, misplaced,
repeated, or forbidden `PLTE`, or one that does not hold 1 to 256 whole RGB
entries, or more than the bit depth can index; no `IDAT` or `IDAT` chunks that
are not consecutive; or a missing or non-empty `IEND`. It ignores bytes after
`IEND`.

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
after the record, and drop those it marks unsafe to copy, such as `gAMA` and
`iCCP`, which describe the old pixels. Inkline does so, keeping text chunks
alongside its own and other types only when the new image has none.

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
| `pressure` | boolean | Whether each point carries pressure, as from a pen; a mouse records none.             |
| `points`   | array   | The points in drawing order, flattened: `x, y` per point, or `x, y, p` with pressure. |

Pressure `p` is an integer from 0 to 255. A stroke has at least one point; a
single point is a dot.

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
2. Each stroke in order: its outline, filled in the grey, over what is there for
   `"pen"` and removing it for `"eraser"` (the canvas compositing operations
   `source-over` and `destination-out`).

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
round dot.

How a canvas antialiases curves and resamples images is up to each
implementation, so another renderer, or another version of Chromium, may differ
by a little at the edges of the ink; the record, the base layer's alpha, and the
stored pixels are exact. Partly transparent pixels are stored premultiplied by
canvases, so their grey can vary by a step or two; the alpha is what counts.

## Compatibility

A reader must ignore fields it does not know, so that a later version can add
optional fields without changing `version`. A change that a version 1 reader
could not handle correctly increases `version`. A reader must not edit a file
whose record has a higher version than it knows, since writing it would lose
what that version recorded; it may still show the file's pixels.

Inkline keeps reading every version 1 file. The files in
[test/fixtures/format](../test/fixtures/format) pin what version 1 files hold,
and its tests read them on every change.

A record whose geometry differs from what version 1 writes, as another tool may
write it, is still valid. Inkline edits it by scaling it to 128 pixels per em
and moving it so that the baselines meet, rounding coordinates to whole units
and sizes to whole units of at least 1, and saves it with version 1's geometry.

Inkline keeps every coordinate it edits within a quarter of the format's limit,
2²² units, so that cropping can never move one beyond the limit. It opens a
record whose coordinates, after any scaling, lie outside that range, or whose
sizes or base scale would leave the format's limits, from its pixels instead, as
for a file without a usable record, rather than clamp or drop strokes.

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
their pixels.

## Cropping

When Inkline saves, it looks for the ink the drawing leaves inside the line box,
drawing at most 4096 pixels across at a time, so that strokes far away, below or
above the line box, or erased cost no large canvas. It crops to that ink as
[Geometry](#geometry) describes, then draws the image from the cropped record
and checks the crop there, adjusting it until the record's own drawing confirms
it. The stored pixels are therefore exactly what the record draws, and opening
and saving a file again changes neither. Strokes that leave no visible ink stay
in the record. A crop wider than 8192 pixels, the largest image, is refused.
