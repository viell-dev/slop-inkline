// The drawing being edited: strokes and an optional base layer, in the
// editor's coordinates, which use the line box and extend left and right.
// Saving crops it to its ink and makes a record.

import {
  limits,
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

function inRange(value: number): boolean {
  return Math.abs(value) <= limits.coordinate;
}

/**
 * Whether a document's coordinates, sizes, and base scale are all within the
 * format's limits, as a record's must be.
 */
export function fitsFormat(document: InkDocument): boolean {
  const strokesFit = document.strokes.every((stroke) => {
    const stride = stroke.pressure ? 3 : 2;
    return (
      Number.isInteger(stroke.size) &&
      stroke.size >= 1 &&
      stroke.size <= limits.strokeSize &&
      stroke.points.every(
        (value, index) => index % stride === 2 || inRange(value),
      )
    );
  });
  const { base } = document;
  return (
    strokesFit &&
    (base === undefined ||
      (inRange(base.x) &&
        inRange(base.y) &&
        base.scale >= limits.baseScale.min &&
        base.scale <= limits.baseScale.max))
  );
}

function mapPoints(
  stroke: Stroke,
  x: (value: number) => number,
  y: (value: number) => number,
): readonly number[] {
  const stride = stroke.pressure ? 3 : 2;
  return stroke.points.map((value, index) =>
    index % stride === 0 ? x(value) : index % stride === 1 ? y(value) : value,
  );
}

/** Moves a document by a whole number of pixels, which loses nothing. */
export function moveDocument(
  document: InkDocument,
  dxPixels: number,
): InkDocument {
  return documentMover(dxPixels)(document);
}

/**
 * A function that moves documents by a whole number of pixels, as
 * {@link moveDocument} does, keeping what they share shared: a stroke or base
 * layer in several documents is moved once, and the same document always
 * moves to the same one, so that moving a whole history copies each stroke
 * once.
 */
export function documentMover(
  dxPixels: number,
): (document: InkDocument) => InkDocument {
  if (!Number.isInteger(dxPixels)) throw new Error("moves are in whole pixels");
  const dx = dxPixels * unitsPerPixel;
  const documents = new Map<InkDocument, InkDocument>();
  const strokes = new Map<Stroke, Stroke>();
  const bases = new Map<BaseLayer, BaseLayer>();
  const moveStroke = (stroke: Stroke): Stroke => {
    let moved = strokes.get(stroke);
    if (moved === undefined) {
      moved = {
        ...stroke,
        points: mapPoints(
          stroke,
          (value) => value + dx,
          (value) => value,
        ),
      };
      strokes.set(stroke, moved);
    }
    return moved;
  };
  const moveBase = (base: BaseLayer): BaseLayer => {
    let moved = bases.get(base);
    if (moved === undefined) {
      moved = { ...base, x: base.x + dx };
      bases.set(base, moved);
    }
    return moved;
  };
  return (document) => {
    let moved = documents.get(document);
    if (moved === undefined) {
      const movedStrokes = document.strokes.map(moveStroke);
      moved =
        document.base === undefined
          ? { strokes: movedStrokes }
          : { strokes: movedStrokes, base: moveBase(document.base) };
      documents.set(document, moved);
    }
    return moved;
  };
}

/**
 * The document a record holds, in the editor's line box, or undefined when
 * it cannot be edited there. A record with the same scale and baseline is
 * used exactly, as any valid record can be. One with another, which other
 * tools may write, is scaled to the line box and aligned on its baseline,
 * rounding coordinates to whole units; if that would leave the format's
 * limits, it is refused rather than clamped, so that no stroke is lost
 * unnoticed.
 */
export function documentFromRecord(record: InkRecord): InkDocument | undefined {
  const { box } = record;
  if (box.pxPerEm === lineBox.pxPerEm && box.baseline === lineBox.baseline) {
    return record.base === undefined
      ? { strokes: record.strokes }
      : { strokes: record.strokes, base: record.base };
  }
  const scale = lineBox.pxPerEm / box.pxPerEm;
  const dy = (lineBox.baseline - box.baseline * scale) * unitsPerPixel;
  const strokes = record.strokes.map((stroke) => ({
    ...stroke,
    size: Math.max(1, Math.round(stroke.size * scale)),
    points: mapPoints(
      stroke,
      (value) => Math.round(value * scale),
      (value) => Math.round(value * scale + dy),
    ),
  }));
  const document: InkDocument =
    record.base === undefined
      ? { strokes }
      : {
          strokes,
          base: {
            ...record.base,
            x: Math.round(record.base.x * scale),
            y: Math.round(record.base.y * scale + dy),
            scale: record.base.scale * scale,
          },
        };
  return fitsFormat(document) ? document : undefined;
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
