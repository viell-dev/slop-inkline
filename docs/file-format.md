# Inkline file format, version 1

Revision 1, 7 November 2026

An Inkline symbol is a PNG file. Its pixels show the symbol, so a program that
shows PNG images shows it. One chunk inside the PNG holds the strokes the symbol
was drawn with, so that it can be edited again without loss, and text chunks can
hold what a person says about it. This document specifies that file completely,
so that it can be read, drawn, and written without any other part of Inkline.

## Conformance

- A **file** is a PNG that follows this document.
- A **writer** is a program that makes files.
- A **reader** is a program that takes the record out of a file.
- An **editor** is a program that reads a file's record and replaces it.

A program that only shows the image is none of these, and needs only
[Geometry](#geometry) to place it in text. Nor is one that only reads or changes
[text about a symbol](#text-about-a-symbol), which needs only that section and
step 1 of [Reading a file](#reading-a-file).

The words "must", "must not", "should", and "may" are used as in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174), in lowercase. A reader
**refuses** a record by treating it as unusable, as
[Reading a file](#reading-a-file) describes; a reader that refuses a record has
not failed, and the file may still be shown.

Everything here is normative, except the sections marked informative. Any change
to the normative text makes a new revision of this document, numbered under its
title; a revision is not a [version](#versions) of the format. PNG means the
third edition of the
[PNG specification](https://www.w3.org/TR/2025/REC-png-3-20250624/), the W3C
Recommendation of 24 June 2025.

## The file

A file is a PNG whose name ends in `.ink.png`, comparing ASCII letters without
regard to case. Its image is 192 pixels high and from 1 to 4096 pixels wide.

A writer must write the image as 8-bit RGBA (colour type 6), not interlaced,
with no `gAMA`, `cHRM`, `sRGB`, `iCCP`, `cICP`, `mDCV`, `cLLI`, `sBIT`, `bKGD`,
`eXIf`, or `acTL` chunk, any of which can change how its pixels are shown. Every
pixel's colour must be `#7e7e7e`, whatever its alpha: the ink is in the alpha
channel alone, and the colour channels say nothing. A reader must not depend on
any of this, since other programs may store the same image another way: it uses
the image's width and height, and nothing else of it.

The grey has a contrast of about 4:1 against white and against the default dark
backgrounds of Obsidian and GitHub, so the symbol stays legible in programs that
show the image as it is.

### Geometry

The image maps to one line of text, at 128 pixels per em. It is 1.5 em tall, and
the text's baseline lies 144 pixels from its top, 0.375 em above its bottom. To
show it in text, scale it to 1.5 em tall and set its `vertical-align` to
`-0.375em`. Its width, at the same scale, is the space the symbol takes up in
the line, and an image is as wide as its symbol needs.

This is about the height of a line in Obsidian's default theme, with room below
the baseline for the descenders of its default font. Another font or line height
leaves the symbol the same size in em, with its baseline on the text's.

### Pixels and record

The image is what a symbol looks like wherever it is shown. The record is what
an editor edits. A writer must make the image a rendering of the record, as
[Drawing the strokes](#drawing-the-strokes) specifies. An editor draws a usable
record from the record alone, and does not read the image's pixels to do it.

An edit leaves alone what it does not touch. An editor must keep each stroke it
was not asked to change as it was, apart from any field it does not know, in its
order. A base layer it was not asked to change must keep its place, its size,
and the alpha of every pixel of its image, however that image is encoded. On its
own, an editor may move a whole record only across, by a whole number of pixels,
as cropping the image does. A shape depends only on where its stroke's points
lie from one another, so such a stroke keeps its shape exactly, in the same
place on the grid of pixels. The image is still drawn again, so that stroke's
pixels can differ only as two renderings of one shape can, as
[Antialiasing](#antialiasing) describes. An edit also keeps
[text about the symbol](#what-an-editor-keeps).

[The record chunk](#the-record-chunk) is marked so that a program that changes
the image data drops it, but that does not stop the two disagreeing. PNG lets a
program keep the chunk when it changes only ancillary chunks, and `tRNS` or
`eXIf` can change what is shown; a program can also break PNG's rule, and a
writer can be wrong. A file does not say that this has happened. When they do
disagree, the image is what is shown and the record is what is edited: the next
edit draws the image again from the record, and what the other program did to
the image is gone.

## The record chunk

The record is held in a chunk of type `inKL`. By PNG's rules for the letters of
a chunk type, this chunk is:

- ancillary, so that programs that do not know it show the image without it;
- private, as it belongs to this format alone;
- unsafe to copy, as what it holds depends on the image: a program that changes
  any critical chunk must drop the chunk rather than leave a record of something
  else.

An image optimizer that recompresses a file may therefore drop the record, and
many programs drop every chunk they do not know. Either way the file shows the
same symbol, and is left a plain picture, though
[text about it](#text-about-a-symbol) often stays.

A writer must write at most one such chunk, and should place it right after
`IHDR`. A reader must accept it anywhere PNG allows an ancillary chunk.

The chunk's data is:

| Bytes     | Contents                                                 |
| --------- | -------------------------------------------------------- |
| 0 to 3    | The format version, as a big-endian unsigned integer: 1. |
| 4 onwards | The record text in UTF-8, compressed as a zlib stream.   |

The zlib stream follows [RFC 1950](https://www.rfc-editor.org/rfc/rfc1950), with
the deflate method of [RFC 1951](https://www.rfc-editor.org/rfc/rfc1951) and no
preset dictionary, and must end where the chunk ends. The first four bytes are
fixed for every version of this format, as [Versions](#versions) says; what
follows them belongs to the version.

## The record text

The record text is a JSON text as defined by
[RFC 8259](https://www.rfc-editor.org/rfc/rfc8259), with these further rules,
which apply to all of it, including fields a reader does not know:

- It is a single object, with no byte order mark.
- It is well-formed UTF-8, as [RFC 3629](https://www.rfc-editor.org/rfc/rfc3629)
  defines it, and is taken as it stands. Many decoders replace an ill-formed
  sequence and drop a byte order mark, and RFC 8259 lets a parser ignore the
  mark, which a reader must not do here, so that every reader finds the same
  text or none.
- No object holds two members of the same name, compared after decoding their
  escapes.
- No string holds half of a surrogate pair, as an escape such as `\ud83d` can
  spell, since readers would make different text of it.
- Every number is an integer in plain decimal digits, with a leading `-` if it
  is negative, and no fraction or exponent. `-0` is not allowed. It lies between
  -9,007,199,254,740,991 and 9,007,199,254,740,991, which every reader's numbers
  can hold exactly.
- Objects and arrays nest at most 16 deep, the outer object being the first.

Members may come in any order, with any white space that JSON allows. A writer
should write them in the order of this example, with no white space, so that the
same record always gives the same text.

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
downwards. The pixel in column `i` and row `j` of the image is the unit square
from (`i`, `j`) to (`i + 1`, `j + 1`) pixels. Coordinates may lie outside the
image, as where an eraser stroke starts beyond its edge.

### Fields

The record has these fields:

| Field     | Type   | Meaning                                              |
| --------- | ------ | ---------------------------------------------------- |
| `strokes` | array  | The strokes, in the order they are drawn. May be []. |
| `base`    | object | Optional. Imported ink that strokes draw on.         |

Each stroke is an object with a `tool`, `"pen"` to add ink or `"eraser"` to
remove it, and `points`, its points in order, flattened as `x, y, x, y, …`, an
even number of integers, at least two. Its `kind` says what it is, and what else
it holds:

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
with no line breaks, and the bits its padding leaves over zero. Its PNG must be
8-bit RGBA (colour type 6), not interlaced, with a correct CRC on every chunk,
and hold only `IHDR`, `IDAT`, and `IEND` chunks, with nothing after `IEND`. For
an image `w` by `h` pixels, the data of its `IDAT` chunks, joined, must be one
zlib stream, as in [the record chunk](#the-record-chunk), that ends where they
end and decompresses to exactly `h × (1 + 4 × w)` bytes: `h` rows, each starting
with a filter type from 0 to 4. Only its alpha channel is read.

### Limits

| What                                           | Limit                 |
| ---------------------------------------------- | --------------------- |
| Strokes                                        | 10,000                |
| Points, across all strokes                     | 250,000               |
| Absolute coordinate, and `base.x` and `base.y` | 16,777,216 units      |
| `size`                                         | 1 to 65,536 units     |
| `base.width` and `base.height`                 | 1 to 16,777,216 units |
| `base.png`, decoded from base64                | 8 MiB                 |
| Width and height of `base.png`'s image         | 1 to 4096 pixels      |
| Record text, decompressed, in UTF-8            | 16 MiB                |

Each limit applies on its own, and a record must meet them all, so that a record
can reach some of them only by staying well within others.

A record that breaks any rule of [The record text](#the-record-text), including
a limit or a value outside those listed, is invalid. A writer must not write it,
and a reader must refuse it. A field a reader does not know is not a broken
rule: see [Versions](#versions). A value a reader does not know, in a field it
does know, is.

## Drawing the strokes

A record is drawn on a transparent canvas of the image's size, with a point at
(`x`, `y`) units at (`x / 16`, `y / 16`) pixels. Every shape below is filled
with the nonzero rule, in the ink's grey at full opacity; its alpha is what
counts.

1. The base layer, if any: its image's alpha, stretched over the rectangle from
   (`x / 16`, `y / 16`) pixels, `width / 16` by `height / 16` pixels in size. It
   is sampled by bilinear interpolation or a smoother method. In each direction,
   across or down, in which it is drawn smaller than its image, each pixel must
   take in all the source pixels it covers, as area averaging does.
2. Each stroke in order. With `a` the alpha a pixel holds and `c` how much of it
   the stroke's shape covers, each from 0 to 1, a pen stroke leaves
   `a + c × (1 - a)` and an eraser stroke `a × (1 - c)`, the operations a canvas
   calls `source-over` and `destination-out`. A stroke's shape counts once,
   however often it crosses a pixel.

### Smooth strokes

A stroke without a `kind` is drawn as a pointer went, smoothly, with round ends.
Its outline follows from `w = size / 16` and its points, `P`, by the steps
below. The steps measure the points from the stroke's first point, in pixels:
with that point at (`x0`, `y0`) units, a point at (`x`, `y`) units is at
(`(x - x0) / 16`, `(y - y0) / 16`), so that `P[0]` is (0, 0). When the steps are
done, every corner of the outline, or a dot's centre, moves by (`x0 / 16`,
`y0 / 16`). So no rounding in them depends on where a stroke lies, and moving
its points by whole units moves its shape and changes nothing else about it.

With `(x, y)` points, each operation on a point applying to `x` and `y` in turn:

- `(ax, ay) · (bx, by) = ax × bx + ay × by`
- `|a| = sqrt(a · a)`
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
    d = |prev - q|
    if d = 0: go on to the next i
    run = run + d
    if i < m and not steady:
        if run < w: go on to the next i, keeping run
        steady = true
    append { p: q, v: (prev - q) / d, run: run } to S
    prev = q
if S has a second sample: S[0].v = S[1].v
```

**A dot.** If `S` holds one sample, the stroke's shape is a circle of diameter
`w` centred on it, and the steps below do not apply.

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
            append rot(p - o, p, T × k / 13) to L
            append rot(p + o, p, -T × k / 13) to R
        pl = p + o;  pr = p - o
        if nt < 0: after = true
        go on to the next sample
    after = false
    if last:
        o = perp(v) × r
        append p - o to L;  append p + o to R
        go on to the next sample
    o = perp(lerp(nv, v, nt)) × r
    a = p - o
    if i ≤ 1 or (pl - a) · (pl - a) > r × r: append a to L;  pl = a
    b = p + o
    if i ≤ 1 or (pr - b) · (pr - b) > r × r: append b to R;  pr = b
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

Every number in these steps must be an IEEE 754 binary64 value, and a constant
such as `0.575`, `0.0001`, or `π` is the nearest one. Each `+`, `-`, `×`, `/`,
and `sqrt` must be one correctly rounded operation, taken in the order written,
left to right with the usual precedence, and never carried at higher precision
or fused with another. A comparison can land on a tie, as when a stroke turns
through exactly a right angle, and a single rounding there chooses between
shapes pixels apart, so these rules make every comparison come out the same in
every reader. `sin` and `cos` are the exception: no comparison depends on them,
and any accurate implementation will do.

The files in
[test/fixtures/outline](https://github.com/viell-dev/slop-inkline/tree/main/test/fixtures/outline)
give the outline of a stroke for each path through these steps, in pixels to
three decimal places, from the strokes in `strokes.ts` there, and the shapes of
the polygons and cut strokes of the golden files. The steps are adapted from
`getStroke` of
[perfect-freehand](https://github.com/steveruizok/perfect-freehand) 1.2.3, by
Steve Ruiz, under the MIT licence.

### Cut ends

A stroke's `cut` makes its ends flat, for strokes that stop on a horizontal
line, such as the baseline. Each cut end takes away what lies past the
horizontal line through it, in a box. For an end at (`X`, `Y`) pixels, with
`b = size / 16 + 1` pixels, the box spans:

| Cut      | Across             | Down           |
| -------- | ------------------ | -------------- |
| `"down"` | `X - b` to `X + b` | `Y` to `Y + b` |
| `"up"`   | `X - b` to `X + b` | `Y - b` to `Y` |

The box reaches past the end's round cap, with a pixel to spare for the soft
edge. The end's own ink there is what the cut removes, but another part of the
stroke can pass through the box, as when it comes back near its end. So a cut
stroke's shape is two parts together:

1. Its shape without cuts, everywhere outside its boxes.
2. Inside its boxes, the shape of the rest of the stroke, if there is any.

The rest is a smooth stroke of the same `tool` and `size`, without cuts, through
the stroke's points between its two ends, and its steps start from its own first
point. An end that is not cut is the stroke's own. A cut end's is found by
walking in from it: starting at the cut end, step from point to point, adding up
each step's length `|a|` in units, in the arithmetic of
[Smooth strokes](#smooth-strokes), until the sum is at least `2 × size`; the
point reached is that end of the rest. Points outside the two ends are dropped.
There is no rest if a walk runs off the far end of the stroke, or if the two
walks pass one another.

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

The shapes above are exact, and how a renderer covers the pixels at their edges
is up to it. A pixel that no edge of a shape crosses should hold exactly what
the shapes give it. A pixel an edge crosses may hold anything between what lies
on the edge's two sides, so that two conforming renderers can differ by that
much there, along a cut as along any edge. A shape filled in pieces may also
leave a seam where its pieces meet, such as the parts of a cut stroke. A base
layer differs more, most where it is drawn smaller than its image. A file's
stored alpha is one such rendering, and a redraw need not match it pixel for
pixel.

## Reading a file

A reader takes these steps in order, on any PNG it is given:

1. **Check the PNG's structure.** It must have PNG's signature; every chunk a
   length that fits and a type of four letters; one valid `IHDR` first, with a
   correct CRC; `PLTE` at most once and before the first `IDAT`, where PNG
   requires it and never in a greyscale image; at least one `IDAT`, all of them
   consecutive; an empty `IEND` last; and no critical chunk PNG does not define.
   A PNG that fails any of this, as one cut short does, holds no symbol, and
   nothing is read from it. An ancillary chunk a reader does not know is not a
   failure, whatever its letters, and bytes after `IEND` are ignored.
2. **Find the record.** With no `inKL` chunk, the PNG has no record: its image
   is all there is to draw.
3. **Read the version.** If any `inKL` chunk whose CRC is correct has at least
   four bytes and a version higher than the reader knows, the file is **from a
   later version**. This comes before any other check, and before any limit is
   applied to the rest of the chunk.
4. **Read the record.** It is **unusable** if the PNG has more than one `inKL`
   chunk, if the chunk has a bad CRC, holds fewer than four bytes, or has
   version 0, if the image is not 192 pixels high or is more than 4096 wide, if
   the text does not decompress, does not end where the chunk ends, is longer
   than its limit, or is not UTF-8, or if it breaks
   [The record text](#the-record-text), which includes a base layer's image
   data.

A reader does not decode the file's own image data, and must not treat damage to
it as a fault in the record, whether or not that damage leaves a wrong CRC on a
critical chunk other than `IHDR`. So a record, which has a CRC of its own,
outlives an image that can no longer be shown, and the next edit draws one
again.

A PNG with no record may be opened as a picture, and saving it adds a record.

A record from a later version, or an unusable one, holds something the reader
cannot see, or may hold it: the strokes in a damaged file may yet be recovered,
as may those of a file that failed step 1, since a file cut short can still hold
its whole record. An editor must therefore not replace any of these. A program
may still show the image, and an editor may offer to make a new file from the
image, leaving the original as it is.

## Text about a symbol

What a person says about a symbol, such as how it is read and what it means, is
held in PNG's text chunks, `tEXt`, `zTXt`, and `iTXt`, and never in the record.
It is not part of the drawing, and stays true of the symbol whatever becomes of
the image. So PNG's mark of safe to copy is right for it, as the mark of unsafe
is right for the record, and many programs that drop the record keep it. A file
needs none.

### Readings and translations

A symbol's readings and translations are held under these keywords, compared
byte for byte:

| Keyword               | Holds                      |
| --------------------- | -------------------------- |
| `Inkline reading`     | The symbol's readings.     |
| `Inkline translation` | The symbol's translations. |

A **reading** is how a symbol is read aloud, written down in any way, as a
transcription or a transliteration: the sign た might have the reading `TA`. A
**translation** is what a symbol means, in words of any language. Each is what
someone takes the symbol to be, which may be uncertain, and a symbol can have
several of either. With no such chunk, nothing of that kind is recorded, which
does not say that the symbol has no reading or no meaning.

A chunk's text is a list of values, the main one first. A line feed, U+000A,
alone separates two values, and none follows the last; no other character ends a
value. They share one chunk because programs that meet a keyword twice can keep
only one of its chunks, or reverse them. The text must follow these rules:

- It is at most 4,096 bytes long in UTF-8, and does not start with a byte order
  mark, U+FEFF.
- No value is empty.
- No value holds a control character, from U+0000 to U+001F or from U+007F to
  U+009F, or a line or paragraph separator, U+2028 or U+2029.

A value is plain text, and nothing else about it is fixed: no language, script,
system of transcription, letter case, or Unicode normalization, and no way of
comparing two values. Readings and translations are separate lists, and a
value's place in one says nothing about the other. They change nothing about how
a record draws or how its symbol sits in text, and a program need not read them.

The file's name is neither a reading nor a translation. The name says which file
this is, and they say what someone takes its symbol to be, so a difference
between them is no error, and renaming a file changes no text chunk. A program
must not fill in a value from the name, a name from a value, or keep the two in
step, unless a person asks it to.

### Reading the text

A program that reads such text takes it from any file that passes step 1 of
[Reading a file](#reading-a-file), with or without a record it can use. It looks
through every `tEXt`, `zTXt`, and `iTXt` chunk, wherever it lies and compressed
or not, since other programs move them and turn one kind into another.

A chunk is **usable** for a keyword if its CRC is correct, its text follows
[the rules above](#readings-and-translations), and its data is that keyword,
byte for byte, then a zero byte, then:

- In `tEXt`, the text.
- In `zTXt`, a compression method of 0, then the text, compressed.
- In `iTXt`, a compression flag and a compression method, a byte each, then a
  language tag and a translated keyword, each ending with a zero byte, then the
  text. With a flag of 0 the text is not compressed, and the method is ignored.
  With a flag of 1 it is compressed, and the method must be 0. No other flag is
  allowed. The language tag and the translated keyword are ignored, whatever
  they hold.

Compressed text must be one zlib stream, as in
[the record chunk](#the-record-chunk), that ends where the chunk ends. The text
of `tEXt` and `zTXt` is Latin-1, each byte being the character of that code
point, so that bytes `0x80` to `0x9F` are control characters, not the printable
characters of windows-1252, which many decoders give under that name. The text
of `iTXt` must be well-formed UTF-8, as
[RFC 3629](https://www.rfc-editor.org/rfc/rfc3629) defines it, and is taken as
it stands. The decoding PNG recommends replaces an ill-formed sequence and drops
a byte order mark, which a program must not do here, so that every program finds
the same values in a chunk, or none.

For each keyword, a program uses the first usable chunk. Any other chunk with
that keyword counts for nothing, and is no fault in the file or the record.

### Changing the text

A change to the text changes no critical chunk, so PNG lets a program keep the
record chunk without reading it, and it must. A program that changes such text
changes only a file that passes step 1 of [Reading a file](#reading-a-file). It
leaves every other chunk as it was, byte for byte, in its order and with its
CRC, right or wrong: the image data, the record chunk, whether or not it can use
it, and the text of every other keyword.

For the keyword it changes, it replaces every usable chunk with at most one, and
with none when no value remains. A chunk of that keyword that is not usable may
hold what the program cannot see, such as a list that a later revision allows.
So it keeps such a chunk, unless a person asks it to remove it, and places its
own before every chunk of that keyword it keeps, so that the value a person gave
is the one read.

A program must write such a chunk as `iTXt`, uncompressed, with a compression
method of 0 and an empty language tag and translated keyword, as its values need
not share a language. It should place it before the image data, as PNG
recommends for small text.

### What an editor keeps

When it writes a file again, with or without a record before, an editor must
keep every text chunk with a correct CRC, byte for byte and in their order,
unless a person asks it to change or remove one. This covers every keyword, and
a chunk that is not usable. When it changes a reading or a translation, it does
so as [Changing the text](#changing-the-text) says.

So a keyword needs no version: a program ignores one it does not know, and one
that changes the file keeps it. Keywords beginning `Inkline ` belong to this
document.

A copy of a file holds the same text, and the two can then differ. Dropping a
text chunk harms nothing else in the file, but the text is gone: it is held
nowhere else, and neither the record nor the file's name can give it back.

## Versions

The version in the record chunk is the format's own, and has nothing to do with
any version of Inkline.

### What every version keeps

These hold for every version of this format, now and later, so that a reader of
any version can recognise a file of any other:

- A file is a PNG whose name ends in `.ink.png`, comparing ASCII letters without
  regard to case, and whose image shows the symbol.
- Its image is shown in text 1.5 em tall, with the text's baseline 0.375 em
  above its bottom, whatever its size in pixels, and a program that reads no
  version gives it its own width at that scale.
- Its record is in the `inKL` chunk, marked unsafe to copy.
- The first four bytes of that chunk's data are its version, a big-endian
  unsigned integer from 1, that no two versions share.
- [Text about a symbol](#text-about-a-symbol) is in PNG's text chunks, outside
  the record, with the keywords and meanings defined there, and an editor or a
  program that changes the text keeps it.

Everything else may change between versions, including everything after those
four bytes, however large it gets.

### When the version changes

The version must increase for any change that a reader of an earlier version
would get wrong by ignoring it. That is any change to how an existing record
draws or to the space a symbol takes up in a line of text, to the meaning, type,
or range of a field, or to a limit, any new value of `tool`, `kind`, or `cut`,
and any new information in the record that must survive editing.

Without changing the version, a later revision of this document may add only a
field that changes nothing about how a record draws or how its symbol sits in
text, and that may be lost without harm. It may also add a keyword for
[text about a symbol](#text-about-a-symbol), or loosen what a keyword's text may
hold. Neither changes how a record draws or a symbol sits, a program reading
text reads no version, and one that cannot use a chunk keeps it. A reader must
ignore a field it does not know, and an editor must not keep such a field when
it writes the record again.

So a change such as a symbol wider than the space it takes up, overlapping the
text after it, raises the version. A reader of version 1 then shows the image at
its own width, without the overlap, and refuses to edit it, which loses nothing.

### Readers and writers of later versions

Every version's files stay readable: a program of a later version must read
every lower version, either directly or through a converter that comes with it.
A file it can do neither with is treated like one from a later version, so an
editor must not replace it. A version's rules for drawing stay specified for as
long as files of it may exist, as a converter needs them. A writer should write
the lowest version that can hold what it saves, so that a file stays editable by
as many readers as it can.

### Converters

A converter writes a new file of another version, leaving the original as it is,
with the symbol looking the same and sitting the same in text, and it keeps the
file's text chunks as an editor does. Going to a lower version, it can draw what
that version cannot express into the base layer, which keeps the ink and loses
the editing of what was flattened. That works only for what the lower version
can place: a symbol wider than the space it takes up, or an image beyond that
version's limits, cannot come through unchanged. A converter must then refuse,
or say what will change before it writes.

## Security considerations

Files are untrusted input. The limits above bound what a reader must hold in
memory. A reader should stop decompressing as soon as the text passes its limit,
should check the text's nesting depth before parsing it, and should read a base
layer's width and height from its `IHDR` before decoding it.

Drawing costs more than reading, and the limits do not bound how long it takes.
A smooth stroke that doubles back at every point has about 28 corners of outline
for each of them, so the limit on points bounds the size of what a renderer
builds, at millions of corners from a record of a few kilobytes. It does not
bound the time to fill that. A stroke or polygon that turns back at nearly every
point crosses itself many times in the same few rows, and a renderer can take
time that grows with the square of its points, wherever they lie: hours at the
limit on points, even in a patch a few pixels wide. Ordinary drawing does not
come near this, as a pointer does not turn back at every point. So no limit on
distance or length can prevent it, and a limit on turns would have to be defined
by these drawing steps.

A program should expect that when it draws a file it did not make, and should
not build every stroke's outline at once. A program may decline a file it judges
too costly to read or draw. It then treats the file like one with an unusable
record, so an editor must not replace it.

Text about a symbol is untrusted too. A program should read a chunk's keyword
first and decompress only the text of a keyword it wants, should stop
decompressing as soon as the text passes its limit, and must treat a value as
plain text, never as markup, a link, or a path. A value can hold bidirectional
controls, which can make it look like another value and can reorder what follows
it, so a program should isolate a value it shows among other text, as HTML's
`bdi` element does.

A record keeps every stroke and all of the base layer, including ink that later
strokes erased or that lies outside the image, so sharing a file can show more
than its image does. Text chunks go with a file too, and any PNG tool shows
them.

## What Inkline does

This section is informative: it describes Inkline's own choices, which another
program need not share.

With Flat ends on, Inkline cuts an end that Shift put on its grid and that
crosses the row through it at 45° or steeper, so that it stops flush with the
row: a stroke that comes down to the baseline has the end `"down"`. Every other
end stays round, so a line along the baseline stays whole.

A file says nothing of Inkline's grid, which belongs to the note's font and the
Grid size setting rather than to the symbol. A stroke's points are stored
exactly, so a stroke Shift placed stays where it was. On opening a symbol again,
Inkline lays the rows out on the font, and places the columns where the most
stroke ends on those rows lie, which decides only where the next Shift lands.

Inkline saves symbols with a width of whatever the ink needs. It crops the image
to the columns that hold ink inside the line, adds a side bearing of 8 pixels on
each side, as a font spaces its glyphs, and widens a narrower result as evenly
as whole pixels allow to 48 pixels, so that a dot stays easy to click. A drawing
with no ink is 48 pixels wide. It looks for the ink by drawing at most 4096
pixels across at a time, so that strokes far away cost no large canvas, each
stroke once for every such span it reaches. It then draws the image from the
cropped record on a canvas of its own, as the next paragraph says, and adjusts
the crop until that drawing confirms it or four attempts have gone by, which
keeps the last, so that opening and saving a file Inkline saved, in the same
browser, changes neither its record nor its pixels. A file from another writer
takes this crop on its first save, which can change its width, and show ink its
image had cut off. A base layer drawn smaller than its image is first brought
down to the whole pixels it falls on, each the exact mean of the area it covers,
as no browser's smoothing can be relied on to take in what it covers; this is
done separately each way, and a way it is not smaller keeps its pixels. Strokes
that leave no visible ink stay in the record. A crop wider than the image can be
is refused, and so is one that would move a stroke past the coordinate limit.

Every save draws the whole image again, so an edit that moves the crop moves the
strokes it left alone. Their shapes stay the same and their pixels nearly so. A
browser flattens a curve differently where a canvas's side cuts it, so Inkline
draws on a canvas that holds every stroke reaching the line, up to 16,384 pixels
across; a wider drawing keeps to the crop. The canvas starts at the image's left
edge, or at the stroke furthest past it, such as a line whose far end was
erased. While that stroke stays furthest, or when an edit moves only the image's
right edge, the strokes keep their place on the canvas and their pixels do not
change at all. Otherwise, as a browser works in 32-bit numbers, a shape's
rendering depends a little on where it falls: most saves change no pixel of
those strokes, and the rest change a few along their edges by a few levels. A
different browser version can change them more.

Inkline sets no limit on how long drawing may take, and does not decline a
record for its cost. A record built to be costly keeps the editor's window busy
until it is done or closed, which changes no file. Notes show the image and do
not draw the record, so only opening such a file for editing does this.

When it saves over a file, Inkline keeps text chunks, and other chunks PNG marks
safe to copy that the new image does not have, each on the side of the image
data it was on, other than `eXIf`, which can turn an image, and chunks with a
bad CRC. It places the ones that come before the image data after the record. If
the file changed while it was open, and the person keeps their drawing, those
are the chunks the changed file holds.

Inkline shows a symbol's readings and translations in its editor and library,
changes them from both, and finds a symbol by them. The library changes a file
as [Changing the text](#changing-the-text) says, whatever its record holds. The
editor does the same to the file a save writes, for a field a person changed,
and carries any other as it was. Inkline removes the spaces around a value
typed, and blank lines, from a field a person changed, and leaves a value alone
otherwise. It offers no way to remove a chunk it cannot use. Copy from takes
only the drawing, so a symbol keeps its own text, and a new one starts with
none.

Inkline's search compares a key made from each value: its compatibility
decomposition in lower case, without its marks unless what was typed holds some.
It keeps these keys in memory, read in the background each time Obsidian starts,
and so declines to search a file of over 32 MiB, or one with more than 16 chunks
of a keyword before a usable one, which it treats as saying nothing. Reading
such a file for a person, as the library's fields do, sets no limit.

Inkline declines a file or a base layer's PNG of more than 65,536 chunks, and
does not save a file that would have more, which leaves the old file as it was.
It ignores any `eXIf` chunk and colour chunks when it decodes an image, and
bytes after a file's `IEND`.

A file whose record is unusable or from a later version does not open for
editing. Copy from can start a new symbol from an unusable one's image.

Inkline opens a file with no record as a picture: its pixels become a base layer
at their own resolution, stretched to the line's height and proportional across,
from the left edge. It opens pictures up to 4096 pixels a side, when their ink
encodes to a PNG within the base image limit. A picture's ink is its alpha
channel when any pixel is not fully opaque; otherwise it is 255 minus each
pixel's luminance (0.2126 R + 0.7152 G + 0.0722 B, rounded), so that dark ink on
a light ground, as in a screenshot, becomes ink.

The files in
[test/fixtures/format](https://github.com/viell-dev/slop-inkline/tree/main/test/fixtures/format)
are real saved symbols, one for each part of this document, with the drawing
each was saved from in `records.ts` there. The tests read them on every change,
and redraw them against their stored pixels. From the first stable release they
never change.
