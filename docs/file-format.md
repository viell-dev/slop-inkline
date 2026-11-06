# Inkline file format, version 1

An Inkline symbol is a PNG file. Its pixels show the symbol, so a program that
shows PNG images shows it. One chunk inside the PNG holds the strokes the symbol
was drawn with, so that it can be edited again without loss. This document
specifies that file completely, so that it can be read, drawn, and written
without any other part of Inkline.

## Conformance

- A **file** is a PNG that follows this document.
- A **writer** is a program that makes files.
- A **reader** is a program that takes the record out of a file.
- An **editor** is a program that reads a file's record and replaces it.

A program that only shows the image is none of these, and needs nothing here.

The words "must", "must not", "should", and "may" are used as in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174), in lowercase. A reader
**refuses** a record by treating it as unusable, as
[Reading a file](#reading-a-file) describes; a reader that refuses a record has
not failed, and the file may still be shown.

Everything here is normative, except the sections marked informative. PNG means
the [PNG specification](https://www.w3.org/TR/png-3/), ISO/IEC 15948.

## The file

A file is a PNG whose name ends in `.ink.png`, in any letter case. Its image is
192 pixels high and from 1 to 4096 pixels wide.

A writer must write the image as 8-bit RGBA (colour type 6), not interlaced,
with no chunk that changes how its pixels are shown, such as `gAMA`, `iCCP`, or
`eXIf`. Every pixel's colour must be `#7e7e7e`, whatever its alpha: the ink is
in the alpha channel alone, and the colour channels say nothing. A reader must
not depend on any of this, since other programs may store the same image another
way: it uses the image's width and height, and nothing else of it.

The grey has a contrast of about 4:1 against white and against the default dark
backgrounds of Obsidian and GitHub, so the symbol stays legible in programs that
show the image as it is.

### Geometry

The image maps to one line of text, at 128 pixels per em. It is 1.5 em tall, and
the text's baseline lies 144 pixels from its top, 0.375 em above its bottom. To
show it in text, scale it to 1.5 em tall and set its `vertical-align` to
`-0.375em`. The width has no fixed meaning: an image is as wide as its symbol
needs.

This is about the height of a line in Obsidian's default theme, with room below
the baseline for the descenders of its default font. Another font or line height
leaves the symbol the same size in em, with its baseline on the text's.

### Pixels and record

The image is what a symbol looks like wherever it is shown. The record is what
an editor edits. A writer must make the image a rendering of the record, as
[Drawing the strokes](#drawing-the-strokes) specifies. An editor draws from the
record and never reads the image, so the two can only disagree if something
changes the image and keeps the record, which PNG forbids:
[the record chunk](#the-record-chunk) is marked to prevent it. When they do
disagree, the image is what is shown and the record is what is edited.

## The record chunk

The record is held in a chunk of type `inKL`. By PNG's rules for the letters of
a chunk type, this chunk is:

- ancillary, so that programs that do not know it show the image without it;
- private, as it belongs to this format alone;
- unsafe to copy, as what it holds depends on the image: a program that changes
  the image must drop the chunk rather than leave a record of something else.

An image optimizer that recompresses a file may therefore drop the record, and
many programs drop every chunk they do not know. Either way the file shows the
same symbol, and is left a plain picture.

A file holds at most one such chunk. A writer should place it right after
`IHDR`. A reader must accept it anywhere PNG allows an ancillary chunk.

The chunk's data is:

| Bytes     | Contents                                                 |
| --------- | -------------------------------------------------------- |
| 0 to 3    | The format version, as a big-endian unsigned integer: 1. |
| 4 onwards | The record text in UTF-8, compressed as a zlib stream.   |

The zlib stream follows [RFC 1950](https://www.rfc-editor.org/rfc/rfc1950), with
the deflate method of [RFC 1951](https://www.rfc-editor.org/rfc/rfc1951) and no
preset dictionary, and ends where the chunk ends. The first four bytes are fixed
for every version of this format, as [Versions](#versions) says; what follows
them belongs to the version.

## The record text

The record text is a JSON text as defined by
[RFC 8259](https://www.rfc-editor.org/rfc/rfc8259), with these further rules,
which apply to all of it, including fields a reader does not know:

- It is a single object, with no byte order mark.
- No object holds two members of the same name, compared after decoding their
  escapes.
- Every number is an integer in plain decimal digits, with a leading `-` if it
  is negative, and no fraction or exponent. `-0` is not allowed.
- Objects and arrays nest at most 16 deep, the outer object being the first.

Members may come in any order, with any white space that JSON allows. A writer
should write them in the order shown here with no white space, so that the same
record always gives the same text.

```json
{
  "strokes": [
    { "tool": "pen", "size": 160, "points": [160, 800, 1600, 200] },
    { "tool": "pen", "size": 96, "points": [512, 1024], "kind": "polygon" },
    { "tool": "eraser", "points": [0, 0, 80, 0, 40, 64], "kind": "fill" },
    {
      "tool": "eraser",
      "size": 96,
      "points": [128, 512, 128, 2304],
      "cut": { "start": "up", "end": "down" }
    }
  ],
  "base": { "x": 160, "y": 320, "width": 64, "height": 64, "png": "iVBORw0K…" }
}
```

### Units and coordinates

Coordinates and sizes are integers in _units_ of one sixteenth of an image
pixel. The origin is the image's top left corner, with x to the right and y
downwards. Coordinates may lie outside the image, as where an eraser stroke
starts beyond its edge.

### Fields

The record has these fields:

| Field     | Type   | Meaning                                              |
| --------- | ------ | ---------------------------------------------------- |
| `strokes` | array  | The strokes, in the order they are drawn. May be []. |
| `base`    | object | Optional. Imported ink that strokes draw on.         |

Each stroke is an object with a `tool`, `"pen"` to add ink or `"eraser"` to
remove it, and `points`, the points it goes through in order, flattened as
`x, y, x, y, …`, with at least one point. Its `kind` says what it is, and what
else it holds:

| `kind`      | Is                         | `size`   | `cut`    | Points    |
| ----------- | -------------------------- | -------- | -------- | --------- |
| absent      | A smooth stroke            | Required | Optional | 1 or more |
| `"polygon"` | Straight sides             | Required | None     | 1 or more |
| `"fill"`    | The area inside its points | None     | None     | 3 or more |

`size` is the stroke's width, in units. `cut` is an object with `start` or `end`
or both, for the stroke's first and last point, each `"up"` or `"down"`: the way
from that point across the horizontal line through it, past which the end's ink
is cut away, as [Cut ends](#cut-ends) describes.

The base layer is an object:

| Field    | Type    | Meaning                                        |
| -------- | ------- | ---------------------------------------------- |
| `x`      | integer | Its left edge, in units.                       |
| `y`      | integer | Its top edge, in units.                        |
| `width`  | integer | The width it is drawn at, in units.            |
| `height` | integer | The height it is drawn at, in units.           |
| `png`    | string  | Its image: a PNG file, in base64 with padding. |

`png` follows [RFC 4648](https://www.rfc-editor.org/rfc/rfc4648), section 4,
with no line breaks. Its PNG must be 8-bit RGBA (colour type 6), not interlaced,
and hold only `IHDR`, `IDAT`, and `IEND` chunks. Only its alpha channel is read.

### Limits

| What                                           | Limit                 |
| ---------------------------------------------- | --------------------- |
| Strokes                                        | 10,000                |
| Points, across all strokes                     | 1,000,000             |
| Absolute coordinate, and `base.x` and `base.y` | 16,777,216 units      |
| `size`                                         | 1 to 65,536 units     |
| `base.width` and `base.height`                 | 1 to 16,777,216 units |
| `base.png`, decoded from base64                | 8 MiB                 |
| Width and height of `base.png`'s image         | 1 to 4096 pixels      |
| Record text, decompressed, in UTF-8            | 16 MiB                |

Each limit applies on its own, and a record must meet them all, so that a record
can reach some of them only by staying well within others.

A record that breaks any rule of this section, including a limit or a value
outside those listed, is invalid. A writer must not write it, and a reader must
refuse it. A field a reader does not know is not a broken rule: see
[Versions](#versions). A value a reader does not know, in a field it does know,
is.

## Drawing the strokes

A record is drawn on a transparent canvas of the image's size, with a point at
(`x`, `y`) units at (`x / 16`, `y / 16`) pixels. Every shape below is filled
with the nonzero rule, in the ink's grey at full opacity; its alpha is what
counts.

1. The base layer, if any: its image's alpha, stretched over the rectangle from
   (`x / 16`, `y / 16`) pixels, `width / 16` by `height / 16` pixels in size,
   and smoothed by any method at least as good as bilinear.
2. Each stroke in order: a pen stroke over what is there, and an eraser stroke
   removing what is there by its own alpha (the compositing operations
   `source-over` and `destination-out`). All of a stroke's shape is filled at
   once, so that it covers each pixel a single time.

### Smooth strokes

A stroke without a `kind` is drawn as a pointer went, smoothly, with round ends.
Its outline follows from its points, `P`, in pixels, and `w = size / 16`, by the
steps below. With `(x, y)` points, `|a|` the length of `a`, and `a · b` the dot
product:

- `lerp(a, b, t) = a + (b - a) × t`
- `perp((x, y)) = (y, -x)`
- `rot(p, c, θ)` is `p` turned about `c`: with `(x, y) = p - c`, it is
  `c + (x cos θ - y sin θ, x sin θ + y cos θ)`.

**The path.** The points are smoothed into a path `S` of samples, each with a
point `p`, a unit vector `v` back along the path, and a running length `run`:

```text
Q = P
if P has 2 points: Q = P[0], lerp(P[0], P[1], k / 4) for k = 1, 2, 3, P[1]
m = the last index of Q
S = [ { p: Q[0], v: (0, 0), run: 0 } ]
prev = Q[0];  run = 0;  steady = false
for i = 1 to m:
    q = Q[m] if i = m, otherwise lerp(prev, Q[i], 0.575)
    if q = prev: go on to the next i
    run = run + |prev - q|
    if i < m and not steady:
        if run < w: go on to the next i, keeping run
        steady = true
    append { p: q, v: (prev - q) / |prev - q|, run: run } to S
    prev = q
if S has a second sample: S[0].v = S[1].v
```

**A dot.** If `S` holds one sample, the stroke never left its first point. Its
shape is a circle of diameter `w` centred on that point, and the steps below do
not apply.

**The sides.** Points to each side of the path make two lists, `L` and `R`, with
`T = π + 0.0001`, `r = w / 2`, and `E` the last sample of `S`:

```text
L = [];  R = []
pv = S[0].v;  pl = S[0].p;  pr = S[0].p;  after = false
for each sample { p, v, run } of S, with i its index:
    last = (i is the last index of S)
    if not last and E.run - run < 3: go on to the next sample
    nv = v if last, otherwise S[i + 1].v
    nt = 1 if last, otherwise v · nv
    corner = (v · pv < 0) and not after
    if corner or nt < 0:
        o = perp(pv) × r
        for k = 0 to 13:
            pl = rot(p - o, p, T × k / 13);  append pl to L
            pr = rot(p + o, p, -T × k / 13);  append pr to R
        if nt < 0: after = true
        go on to the next sample
    after = false
    if last:
        o = perp(v) × r
        append p - o to L;  append p + o to R
        go on to the next sample
    o = perp(lerp(nv, v, nt)) × r
    a = p - o
    if i ≤ 1 or |pl - a|² > r²: append a to L;  pl = a
    b = p + o
    if i ≤ 1 or |pr - b|² > r²: append b to R;  pr = b
    pv = v
```

**The outline.** The ends close the two sides into one polygon:

```text
A = rot(R[0], S[0].p, T × k / 13) for k = 1 to 13
tip = E.p + perp(-E.v) × r
B = rot(tip, E.p, 3 × T × k / 29) for k = 1 to 29
outline = L, then B, then R reversed, then A
```

The polygon is drawn as a closed curve: from the midpoint of its first edge, a
quadratic curve to the midpoint of each following edge, with the corner between
them as the control point, and so back to the start. The curve crosses itself
wherever the stroke does, and the nonzero rule fills it solid.

These steps are computed in IEEE 754 binary64 or better. The files in
[test/fixtures/outline](../test/fixtures/outline) give the outlines of a stroke
for each path through them, in pixels to three decimal places, from the strokes
in `strokes.ts` there. The steps are adapted from `getStroke` of
[perfect-freehand](https://github.com/steveruizok/perfect-freehand) 1.2.3, by
Steve Ruiz, under the MIT licence.

### Cut ends

A stroke's `cut` makes its ends flat, for strokes that stop on a horizontal
line, such as the baseline. Each cut end takes away what lies past the
horizontal line through it, in a box. For an end at (`X`, `Y`) pixels, with
`r = size / 16 + 1` pixels, the box spans:

| Cut      | Across             | Down           |
| -------- | ------------------ | -------------- |
| `"down"` | `X - r` to `X + r` | `Y` to `Y + r` |
| `"up"`   | `X - r` to `X + r` | `Y - r` to `Y` |

The box reaches past the end's round cap, with a pixel to spare for the soft
edge. The end's own ink there is what the cut removes, but another part of the
stroke can pass through the box, as when it comes back near its end. So a cut
stroke is drawn in two parts:

1. Its outline, everywhere outside its boxes.
2. Inside its boxes, the outline of the rest of the stroke, if there is any.

The rest is a smooth stroke of the same `tool` and `size`, without cuts, through
the stroke's points between two points found by walking in from each cut end.
Starting at the cut end, step from point to point, adding up the distance in
units, until the sum is at least `2 × size`; the point reached is that end of
the rest. The rest of the points are dropped. There is no rest if a walk runs
off the far end of the stroke, or if the two walks pass one another.

### Polygons

A stroke of kind `"polygon"` is drawn through its corners, its points in pixels
leaving out each point equal to the one before it, `w = size / 16` pixels wide.
It is closed if at least four points are left and the last equals the first,
which is then left out too, and the sides go round from the last corner back to
the first; otherwise it is open. Its shape is these pieces, each wound the same
way, so that the nonzero rule fills everything any of them covers:

- Each side is a rectangle `w` wide, centred on the line between its corners. An
  open polygon's first and last sides reach `w / 2` past its end corners, so
  that its ends are square.
- Each corner where two sides meet and turn, every corner of a closed polygon
  and all but the ends of an open one, has a wedge on the outer side of the
  turn: from the corner point to the two sides' outer edges, and out along them
  to where they meet. Where they meet more than `2 × w` from the corner point,
  as at a corner sharper than about 29°, the wedge stops at a line square to the
  corner's bisector, `2 × w` from the corner point. A side that doubles back on
  the one before turns 180°, and its wedge is a rectangle `w` wide that goes on
  from the corner point, in the first side's direction, for `2 × w`.
- A polygon with a single corner is a square `w` wide, centred on it, with its
  sides along the axes.

### Fills

A stroke of kind `"fill"` is the polygon through its points in pixels, leaving
out each point equal to the one before it, from the last back to the first.
Nothing is drawn along the points, so a filled shape on a grid lies within the
lines its corners are on. A polygon that crosses itself, such as a five-pointed
star drawn in one line, fills its middle too.

### Antialiasing

The shapes above are exact. How a renderer covers the pixels at their edges is
up to it, and so is how it smooths a base layer, so that two conforming
renderers can differ a little at the edges of the ink, and more inside an
enlarged base layer. A file's stored alpha is one such rendering, and a redraw
need not match it pixel for pixel.

## Reading a file

A reader takes these steps in order:

1. **Check the PNG.** A file that PNG calls invalid is not a symbol, and is
   refused whole. That includes one with a bad CRC in a critical chunk, or with
   a critical chunk PNG does not define.
2. **Find the record.** With no `inKL` chunk, the file has no record: its image
   is all there is.
3. **Read the version.** If any `inKL` chunk whose CRC is correct has at least
   four bytes and a version higher than the reader knows, the file is **from a
   later version**. This comes before any other check, and before any limit is
   applied to the rest of the chunk.
4. **Read the record.** It is **unusable** if the file has more than one `inKL`
   chunk, if the chunk has a bad CRC, holds fewer than four bytes, or has
   version 0, if the image is not 192 pixels high and at most 4096 wide, if the
   text does not decompress, is longer than its limit, or is not UTF-8, if it
   breaks [The record text](#the-record-text), or if the base layer's image does
   not decode.

A file with no record may be opened as a picture, and saving it adds a record.

A record from a later version, or an unusable one, holds something the reader
cannot see, or may hold it: the strokes in a damaged file may yet be recovered.
An editor must therefore not replace it. A program may still show the image, and
an editor may offer to make a new file from the image, leaving the original as
it is.

## Versions

The version in the record chunk is the format's own, and has nothing to do with
any version of Inkline.

### What every version keeps

These hold for every version of this format, now and later, so that a reader of
any version can recognise a file of any other:

- A file is a PNG whose image shows the symbol.
- Its record is in the `inKL` chunk, marked unsafe to copy.
- The first four bytes of that chunk's data are its version, a big-endian
  unsigned integer from 1, that no two versions share.

Everything else may change between versions, including everything after those
four bytes, however large it gets.

### When the version changes

The version must increase for any change that a reader of an earlier version
would get wrong by ignoring it. That is any change to how an existing record
draws or where a symbol sits in a line of text, to the meaning, type, or range
of a field, or to a limit, any new value of `tool`, `kind`, or `cut`, and any
new information that must survive editing.

Without changing the version, a later revision of this document may add only a
field that changes nothing about how a record draws or how its symbol sits in
text, and that may be lost without harm. A reader must ignore a field it does
not know. An editor drops it: a field it does not know is not kept when it
writes the record again.

So a change such as a symbol wider than the space it takes up, overlapping the
text after it, raises the version. A reader of version 1 then shows the image at
its own width, without the overlap, and refuses to edit it, which loses nothing.

### Readers and writers of later versions

A reader of a version must read every lower version, and a version's rules for
drawing stay specified for as long as files of it may exist. A writer should
write the lowest version that can hold what it saves, so that a file stays
editable by as many readers as it can.

### Converters

A converter turns a file of one version into a file of another without changing
how it looks. It writes a new file, and may be needed where a later version
cannot read an earlier one's file by itself. Going to a lower version, it can
always draw what the lower version cannot express into the base layer, which
keeps the look and loses the editing of what was flattened.

## Security considerations

Files are untrusted input. The limits above bound what a reader must hold in
memory. A reader should stop decompressing as soon as the text passes its limit,
should check the record's structure before parsing it, and should read a base
layer's width and height from its `IHDR` before decoding it.

A record keeps every stroke and all of the base layer, including ink that later
strokes erased or that lies outside the image, so sharing a file can show more
than its image does.

## What Inkline does

This section is informative: it describes Inkline's own choices, which another
program need not share.

With Flat ends on, Inkline cuts an end that Shift put on its grid and that
crosses the row through it at 45° or steeper, so that it stops flush with the
row: a stroke that comes down to the baseline has the end `"down"`. Every other
end stays round, so a line along the baseline stays whole.

Inkline saves symbols with a width of whatever the ink needs. It crops the image
to the columns that hold ink inside the line, adds a side bearing of 8 pixels on
each side, as a font spaces its glyphs, and widens a narrower result as evenly
as whole pixels allow to 48 pixels, so that a dot stays easy to click. A drawing
with no ink is 48 pixels wide. It looks for the ink by drawing at most 4096
pixels across at a time, so that strokes far away cost no large canvas, then
draws the image from the cropped record, and adjusts the crop until that drawing
confirms it, so that opening and saving a file again changes neither its record
nor its pixels. Strokes that leave no visible ink stay in the record. A crop
wider than the image can be is refused, and so is one that would move a stroke
past the coordinate limit.

When it saves over a file, Inkline keeps the chunks PNG marks safe to copy, such
as text, each on the side of the image data it was on, other than `eXIf`, which
can turn an image, and chunks with a bad CRC. It places the ones that come
before the image data after the record.

Inkline reads at most 65,536 chunks from a file. It ignores any `eXIf` chunk and
colour chunks when it decodes an image, and bytes after `IEND`.

A file whose record is unusable or from a later version does not open for
editing. Copy from can start a new symbol from an unusable one's image.

Inkline opens a file with no record as a picture: its pixels become a base layer
at their own resolution, stretched to the line's height and proportional across,
from the left edge. It opens pictures up to 4096 pixels a side, when their ink
encodes to a PNG within the base image limit. A picture's ink is its alpha
channel when any pixel is not fully opaque; otherwise it is 255 minus each
pixel's luminance (0.2126 R + 0.7152 G + 0.0722 B, rounded), so that dark ink on
a light ground, as in a screenshot, becomes ink.

The files in [test/fixtures/format](../test/fixtures/format) are real saved
symbols, one for each part of this document, with the drawing each was saved
from in `records.ts` there. The tests read them on every change, and redraw them
against their stored pixels. From the first stable release they never change.
