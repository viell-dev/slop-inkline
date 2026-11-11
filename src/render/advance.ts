// PROTOTYPE for #167 §1, not for release: a symbol whose advance, the room it
// takes in a line, is narrower than its image, so that ink past the advance
// lies under what comes next, as a font's glyph can overhang its neighbours.
//
// The advance comes from a hypothetical version 2 record chunk, which puts it
// before the compressed record so that a renderer can read it without
// inflating anything:
//
//   bytes 0 to 3    the version, 2
//   bytes 4 to 7    the advance's left edge, a big-endian signed integer, units
//   bytes 8 to 11   the advance's right edge, likewise
//   bytes 12 on     the record text, compressed, as in version 1
//
// Nothing here is part of the format; docs/file-format.md is version 1 only.

import { recordChunkType } from "../format/ink-file.ts";
import { imageHeader, readChunks } from "../format/png.ts";
import { lineBox } from "../ink/geometry.ts";

/** The prototype's version number. */
export const advanceVersion = 2;

/** Units per image pixel, as in version 1. */
const unitsPerPixel = 16;

/**
 * The columns of a symbol's image that it takes up in a line, in image
 * pixels, and the image's whole width.
 */
export interface Advance {
  readonly start: number;
  readonly end: number;
  readonly width: number;
}

/** Whether `advance` leaves ink outside the room the symbol takes. */
export function overhangs(advance: Advance): boolean {
  return advance.start > 0 || advance.end < advance.width;
}

/**
 * The advance a file records, or undefined for a file without one, as every
 * version 1 file is, or one that cannot be read.
 */
export function readAdvance(bytes: Uint8Array): Advance | undefined {
  let width: number;
  let data: Uint8Array | undefined;
  try {
    const chunks = readChunks(bytes, (type) => type === recordChunkType);
    ({ width } = imageHeader(chunks));
    const records = chunks.filter((chunk) => chunk.type === recordChunkType);
    const [chunk] = records;
    if (records.length !== 1 || chunk === undefined) return undefined;
    if (chunk.damaged === true) return undefined;
    data = chunk.data;
  } catch {
    return undefined;
  }
  if (data.length < 12) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, 12);
  if (view.getUint32(0) !== advanceVersion) return undefined;
  const start = view.getInt32(4) / unitsPerPixel;
  const end = view.getInt32(8) / unitsPerPixel;
  if (!(start >= 0 && end > start && end <= width)) return undefined;
  return { start, end, width };
}

/** The custom properties that place an overhanging symbol, as CSS lengths. */
export interface OverhangStyle {
  readonly "--inkline-left": string;
  readonly "--inkline-right": string;
  readonly "--inkline-advance-width": string;
  readonly "--inkline-full-width": string;
  readonly "--inkline-spread": string;
  readonly "--inkline-height": string;
}

/**
 * The lengths for `advance`, for a symbol at the text's size, in em times the
 * symbol scale, or at an explicit `height` in CSS pixels.
 */
export function overhangStyle(
  advance: Advance,
  height?: number,
): OverhangStyle {
  const length = (pixels: number): string =>
    height === undefined
      ? `calc(${String(pixels / lineBox.pxPerEm)}em * var(--inkline-scale, 1))`
      : `${String((pixels * height) / lineBox.height)}px`;
  const left = advance.start;
  const right = advance.width - advance.end;
  return {
    "--inkline-left": length(left),
    "--inkline-right": length(right),
    "--inkline-advance-width": length(advance.end - advance.start),
    "--inkline-full-width": length(advance.width),
    "--inkline-spread": length(Math.max(left, right)),
    "--inkline-height": length(lineBox.height),
  };
}
