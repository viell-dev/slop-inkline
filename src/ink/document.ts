// The drawing being edited: strokes and an optional base layer, in the
// editor's coordinates, which use the line box and extend left and right.
// Saving crops it to its ink and makes a record.

import {
  limits,
  unitsPerPixel,
  type BaseLayer,
  type InkRecord,
  type Stroke,
} from "../format/record.ts";
import { strokeBounds } from "./outline.ts";

/** A drawing holds what a record holds, in the editor's coordinates. */
export type InkDocument = InkRecord;

export const emptyDocument: InkDocument = { strokes: [] };

/** A coordinate in pixels as the integer units the format stores. */
export function toUnits(pixels: number): number {
  return Math.round(pixels * unitsPerPixel);
}

function inRange(value: number): boolean {
  return Math.abs(value) <= limits.coordinate;
}

/**
 * Whether a document's coordinates and sizes are all within the format's
 * limits, as a record's must be.
 */
export function fitsFormat(document: InkDocument): boolean {
  const strokesFit = document.strokes.every(
    (stroke) =>
      (stroke.size === undefined ||
        (Number.isInteger(stroke.size) &&
          stroke.size >= 1 &&
          stroke.size <= limits.strokeSize)) &&
      stroke.points.every(inRange),
  );
  const { base } = document;
  return (
    strokesFit &&
    (base === undefined ||
      (inRange(base.x) &&
        inRange(base.y) &&
        base.width >= 1 &&
        base.height >= 1 &&
        inRange(base.width) &&
        inRange(base.height)))
  );
}

/**
 * How far a document reaches across, in pixels: from the left edge of its
 * leftmost stroke or base layer to the right edge of its rightmost, each
 * stroke widened by its radius; a polygon or a filled stroke, whose ink can
 * reach farther or less far, by its bounds. Undefined for an empty document.
 */
export function documentSpan(
  document: InkDocument,
): { left: number; right: number } | undefined {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const stroke of document.strokes) {
    if (stroke.kind !== undefined) {
      const bounds = strokeBounds(stroke);
      if (bounds !== undefined) {
        left = Math.min(left, bounds.left * unitsPerPixel);
        right = Math.max(right, bounds.right * unitsPerPixel);
      }
      continue;
    }
    const radius = stroke.size / 2;
    for (let index = 0; index < stroke.points.length; index += 2) {
      const x = stroke.points[index] ?? 0;
      left = Math.min(left, x - radius);
      right = Math.max(right, x + radius);
    }
  }
  const { base } = document;
  if (base !== undefined) {
    left = Math.min(left, base.x);
    right = Math.max(right, base.x + base.width);
  }
  return left > right
    ? undefined
    : { left: left / unitsPerPixel, right: right / unitsPerPixel };
}

/**
 * The stroke `next` adds to `previous`, when that is all that changed: the
 * same base layer and the very same strokes in order, with one more after
 * them. Anything else gives undefined, however it came about, as an undo, a
 * move, which makes new strokes, or a replaced document all do. Strokes draw
 * in order, so this stroke drawn over what `previous` left is what `next`
 * leaves.
 */
export function addedStroke(
  previous: InkDocument,
  next: InkDocument,
): Stroke | undefined {
  const { strokes } = next;
  if (
    next.base !== previous.base ||
    strokes.length !== previous.strokes.length + 1
  ) {
    return undefined;
  }
  return previous.strokes.every((stroke, index) => stroke === strokes[index])
    ? strokes.at(-1)
    : undefined;
}

/**
 * Moves a document across by a whole number of pixels, and up or down by a
 * whole number of units, which loses nothing.
 */
export function moveDocument(
  document: InkDocument,
  dxPixels: number,
  dyUnits = 0,
): InkDocument {
  return documentMover(dxPixels, dyUnits)(document);
}

/**
 * A function that moves documents as {@link moveDocument} does, keeping what
 * they share shared: a stroke or base layer in several documents is moved
 * once, and the same document always moves to the same one, so that moving a
 * whole history copies each stroke once.
 */
export function documentMover(
  dxPixels: number,
  dyUnits = 0,
): (document: InkDocument) => InkDocument {
  if (!Number.isInteger(dxPixels)) throw new Error("moves are in whole pixels");
  if (!Number.isInteger(dyUnits)) throw new Error("moves are in whole units");
  const dx = dxPixels * unitsPerPixel;
  const documents = new Map<InkDocument, InkDocument>();
  const strokes = new Map<Stroke, Stroke>();
  const bases = new Map<BaseLayer, BaseLayer>();
  const moveStroke = (stroke: Stroke): Stroke => {
    let moved = strokes.get(stroke);
    if (moved === undefined) {
      moved = {
        ...stroke,
        points: stroke.points.map((value, index) =>
          index % 2 === 0 ? value + dx : value + dyUnits,
        ),
      };
      strokes.set(stroke, moved);
    }
    return moved;
  };
  const moveBase = (base: BaseLayer): BaseLayer => {
    let moved = bases.get(base);
    if (moved === undefined) {
      moved = { ...base, x: base.x + dx, y: base.y + dyUnits };
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
 * The record for a document cropped to start at `left`, a whole pixel in the
 * editor's coordinates: everything moves left by `left`, so that the image
 * starts at 0.
 */
export function recordFromDocument(
  document: InkDocument,
  left: number,
): InkRecord {
  return moveDocument(document, -left);
}
