// The drawing being edited: strokes and an optional base layer, in the
// editor's coordinates, which use the line box and extend left and right
// without limit. Saving crops it to its ink and makes a record.

import {
  maxPressure,
  unitsPerPixel,
  type BaseLayer,
  type InkRecord,
  type Stroke,
} from "../format/record.ts";
import { lineBox } from "./geometry.ts";

export interface InkDocument {
  readonly strokes: readonly Stroke[];
  readonly base?: BaseLayer;
}

export const emptyDocument: InkDocument = { strokes: [] };

/** A coordinate in pixels as the integer units the format stores. */
export function toUnits(pixels: number): number {
  return Math.round(pixels * unitsPerPixel);
}

/** Pressure from 0 to 1 as the integer the format stores. */
export function toPressure(pressure: number): number {
  return Math.round(Math.min(1, Math.max(0, pressure)) * maxPressure);
}

function moveStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  const stride = stroke.pressure ? 3 : 2;
  return {
    ...stroke,
    points: stroke.points.map((value, index) =>
      index % stride === 0
        ? value + dx
        : index % stride === 1
          ? value + dy
          : value,
    ),
  };
}

function scaleStroke(stroke: Stroke, scale: number, dy: number): Stroke {
  const stride = stroke.pressure ? 3 : 2;
  return {
    ...stroke,
    size: Math.max(1, Math.round(stroke.size * scale)),
    points: stroke.points.map((value, index) =>
      index % stride === 0
        ? Math.round(value * scale)
        : index % stride === 1
          ? Math.round(value * scale + dy)
          : value,
    ),
  };
}

/** Moves a document by a whole number of pixels, which loses nothing. */
export function moveDocument(
  document: InkDocument,
  dxPixels: number,
): InkDocument {
  if (!Number.isInteger(dxPixels)) throw new Error("moves are in whole pixels");
  const dx = dxPixels * unitsPerPixel;
  const strokes = document.strokes.map((stroke) => moveStroke(stroke, dx, 0));
  return document.base === undefined
    ? { strokes }
    : { strokes, base: { ...document.base, x: document.base.x + dx } };
}

/**
 * The document a record holds, in the editor's line box. A record with the
 * same geometry is used exactly. One with another scale or baseline, which
 * other tools may write, is scaled to the line box and aligned on its
 * baseline, rounding coordinates to whole units.
 */
export function documentFromRecord(record: InkRecord): InkDocument {
  const { box } = record;
  if (box.pxPerEm === lineBox.pxPerEm && box.baseline === lineBox.baseline) {
    return record.base === undefined
      ? { strokes: record.strokes }
      : { strokes: record.strokes, base: record.base };
  }
  const scale = lineBox.pxPerEm / box.pxPerEm;
  const dy = (lineBox.baseline - box.baseline * scale) * unitsPerPixel;
  const strokes = record.strokes.map((stroke) =>
    scaleStroke(stroke, scale, dy),
  );
  if (record.base === undefined) return { strokes };
  return {
    strokes,
    base: {
      ...record.base,
      x: Math.round(record.base.x * scale),
      y: Math.round(record.base.y * scale + dy),
      scale: record.base.scale * scale,
    },
  };
}

/**
 * The record for a document cropped to `width` pixels from `left`, a whole
 * pixel in the editor's coordinates: everything moves left by `left`, so
 * that the image starts at 0.
 */
export function recordFromDocument(
  document: InkDocument,
  left: number,
  width: number,
): InkRecord {
  const moved = moveDocument(document, -left);
  const box = { ...lineBox, width };
  return moved.base === undefined
    ? { box, strokes: moved.strokes }
    : { box, strokes: moved.strokes, base: moved.base };
}
