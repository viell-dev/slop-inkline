# Inkline file format, version 1

An Inkline symbol is a PNG file whose name ends in `.ink.png`. Its pixels show
the symbol, so any program that shows PNG images shows it. A chunk inside the
PNG holds the strokes the symbol was drawn with, so that Inkline can edit it
again without loss. This document specifies that chunk and how to read it, for
anyone writing a tool that reads or writes Inkline files.

The words "must", "must not", "should", and "may" are used as in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

> The sections on the pixels, the geometry of the line box, and how strokes are
> rendered follow with Inkline's drawing core
> ([#2](https://github.com/viell-dev/slop-inkline/issues/2)).

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
chunks, including other `iTXt` chunks, are not part of the format; a writer that
rewrites a file should keep them.

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

## Compatibility

A reader must ignore fields it does not know, so that a later version can add
optional fields without changing `version`. A change that a version 1 reader
could not handle correctly increases `version`. A reader must not edit a file
whose record has a higher version than it knows, since writing it would lose
what that version recorded; it may still show the file's pixels.

Inkline keeps reading every version 1 file. The files in
[test/fixtures/format](../test/fixtures/format) pin what version 1 files hold,
and its tests read them on every change.

## Files without a usable record

A file has no usable record when it has no `inkline` chunk, when the chunk is
malformed or its text does not decompress, when the record breaks this format,
or when `box.width` and `box.height` differ from the image's size, as after
another program resized it. Inkline then opens the file's pixels as a base
layer, and saving it writes a new record. A file whose record has a higher
version is not edited, as [Compatibility](#compatibility) requires.
