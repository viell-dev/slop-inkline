// Prototype for #167 §4.1, not for release: drawing a layout of parts, and
// making one version-1 record of it. Copying parts' strokes in lets a part's
// eraser reach the parts drawn before it; drawing each part on a layer of its
// own does not. With at most four parts, every order can be tried, to find
// one in which no eraser reaches another part. Parts traced from pictures
// bring a base layer each, and a record holds one, so theirs are drawn into
// one new base layer, which keeps every part's strokes as strokes.

import {
  limits,
  unitsPerPixel,
  type BaseLayer,
  type InkRecord,
} from "../format/record.ts";
import { drawableBase, encodePixels, readPixels } from "../ink/canvas.ts";
import { lineBox } from "../ink/geometry.ts";
import { greyInk } from "../ink/pixels.ts";
import { drawInk, type DrawableBase } from "../ink/render.ts";
import {
  copyStrokes,
  orders,
  placeStroke,
  type Arrangement,
  type Part,
  type Weight,
} from "./layouts.ts";

/** A part, with its base layer decoded when it has one. */
export interface DrawnPart extends Part {
  readonly base?: DrawableBase;
}

/** Room left of the parts on a drawing canvas, for a part's overhang. */
export const margin = 32;

function surface(width: number): {
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
} {
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width)), lineBox.height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D context");
  return { canvas, context };
}

/** A decoded base layer placed as its part is. */
function placedBase(
  base: DrawableBase,
  placement: Arrangement["placements"][number],
  dx: number,
): DrawableBase {
  const { x, y, scale } = placement;
  return {
    image: base.image,
    x: Math.round((x + dx) * unitsPerPixel + base.x * scale),
    y: Math.round(y * unitsPerPixel + base.y * scale),
    width: Math.max(1, Math.round(base.width * scale)),
    height: Math.max(1, Math.round(base.height * scale)),
  };
}

function present(parts: readonly (DrawnPart | undefined)[]): DrawnPart[] {
  return parts.filter((part): part is DrawnPart => part !== undefined);
}

/** The canvas width that holds the arrangement with a margin each side. */
export function canvasWidth(arrangement: Arrangement): number {
  return Math.ceil(arrangement.width) + 2 * margin;
}

/**
 * Draws each part on a layer of its own, then that layer over the others, so
 * that its erasers remove only its own ink: how the parts look apart.
 */
export function drawLayered(
  parts: readonly (DrawnPart | undefined)[],
  arrangement: Arrangement,
  weight: Weight,
): OffscreenCanvas {
  const width = canvasWidth(arrangement);
  const { canvas, context } = surface(width);
  const list = present(parts);
  for (const [index, placement] of arrangement.placements.entries()) {
    const part = list[index];
    if (part === undefined) continue;
    const moved = { ...placement, x: placement.x + margin };
    const strokes = part.record.strokes.map((stroke) =>
      placeStroke(stroke, moved, weight),
    );
    const layer = surface(width);
    drawInk(
      layer.context,
      strokes,
      part.base === undefined ? undefined : placedBase(part.base, placement, margin),
    );
    context.drawImage(layer.canvas, 0, 0);
  }
  return canvas;
}

/** Draws a record as a save would, `dx` pixels right. */
export function drawRecord(
  record: InkRecord,
  base: DrawableBase | undefined,
  width: number,
): OffscreenCanvas {
  const { canvas, context } = surface(width);
  drawInk(context, record.strokes, base);
  return canvas;
}

export interface Difference {
  /** Pixels whose alpha differs by more than 16 of 255. */
  readonly differing: number;
  /** Pixels at least three-quarters inked in the first, a quarter in the other. */
  readonly lost: number;
}

/** How two drawings of the same size differ, by alpha. */
export function difference(
  a: OffscreenCanvas,
  b: OffscreenCanvas,
): Difference {
  const first = readPixels(a).data;
  const second = readPixels(b).data;
  let differing = 0;
  let lost = 0;
  for (let index = 3; index < first.length; index += 4) {
    const one = first[index] ?? 0;
    const two = second[index] ?? 0;
    if (Math.abs(one - two) > 16) differing++;
    if (one >= 192 && two <= 64) lost++;
  }
  return { differing, lost };
}

/** How many pixels are at least half inked. */
export function inked(canvas: OffscreenCanvas): number {
  const { data } = readPixels(canvas);
  let count = 0;
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 0) >= 128) count++;
  }
  return count;
}

/**
 * One base layer holding every traced part's base layer, placed, drawn at a
 * resolution that keeps the finest of them, within the format's 4096 pixels
 * a side. Undefined when no part has one.
 */
export async function mergedBase(
  parts: readonly (DrawnPart | undefined)[],
  arrangement: Arrangement,
): Promise<{ layer: BaseLayer; drawable: DrawableBase } | undefined> {
  const list = present(parts);
  const placed: { base: DrawableBase; source: DrawableBase }[] = [];
  for (const [index, placement] of arrangement.placements.entries()) {
    const part = list[index];
    if (part?.base === undefined) continue;
    placed.push({ base: placedBase(part.base, placement, margin), source: part.base });
  }
  if (placed.length === 0) return undefined;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let resolution = 1;
  for (const { base } of placed) {
    left = Math.min(left, base.x);
    top = Math.min(top, base.y);
    right = Math.max(right, base.x + base.width);
    bottom = Math.max(bottom, base.y + base.height);
    // Image pixels per drawn unit, to keep.
    resolution = Math.max(
      resolution,
      (base.image.width / base.width) * unitsPerPixel,
      (base.image.height / base.height) * unitsPerPixel,
    );
  }
  const unitsWide = right - left;
  const unitsHigh = bottom - top;
  const side = Math.max(unitsWide, unitsHigh) / unitsPerPixel;
  resolution = Math.min(resolution, limits.baseSize / side);
  const width = Math.max(1, Math.round((unitsWide / unitsPerPixel) * resolution));
  const height = Math.max(1, Math.round((unitsHigh / unitsPerPixel) * resolution));
  const merged = new OffscreenCanvas(width, height);
  const context = merged.getContext("2d");
  if (context === null) throw new Error("no 2D context");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const k = width / unitsWide;
  for (const { base } of placed) {
    context.drawImage(
      base.image,
      (base.x - left) * k,
      (base.y - top) * k,
      base.width * k,
      base.height * k,
    );
  }
  const pixels = readPixels(merged);
  greyInk(pixels.data);
  const layer: BaseLayer = {
    x: left - margin * unitsPerPixel,
    y: top,
    width: unitsWide,
    height: unitsHigh,
    png: await encodePixels(pixels),
  };
  return { layer, drawable: await drawableBase(layer) };
}

export interface Composed {
  /** The record, its parts' left edge at 0, as a symbol's record starts. */
  readonly record: InkRecord;
  readonly base?: DrawableBase;
  /** The order the parts' strokes went in, by the layout's slots present. */
  readonly order: readonly number[];
  /** Copied in the natural order, against the parts on their own layers. */
  readonly natural: Difference;
  /** Copied in the chosen order, against the parts on their own layers. */
  readonly chosen: Difference;
  /** How many orders were tried. */
  readonly tried: number;
  /** How many parts' base layers went into one. */
  readonly mergedBases: number;
}

/**
 * The parts copied into one version-1 record, in the first order in which
 * no part's eraser takes ink from another, or else the order that loses
 * least.
 */
export async function compose(
  parts: readonly (DrawnPart | undefined)[],
  arrangement: Arrangement,
  weight: Weight,
): Promise<Composed> {
  const width = canvasWidth(arrangement);
  const merged = await mergedBase(parts, arrangement);
  const reference = drawLayered(parts, arrangement, weight);
  const shifted = {
    ...arrangement,
    placements: arrangement.placements.map((placement) => ({
      ...placement,
      x: placement.x + margin,
    })),
  };
  const drawBase =
    merged === undefined
      ? undefined
      : { ...merged.drawable, x: merged.drawable.x + margin * unitsPerPixel };
  const candidates = orders(arrangement.placements.length);
  let natural: Difference | undefined;
  let best: { order: number[]; difference: Difference } | undefined;
  let tried = 0;
  for (const order of candidates) {
    tried++;
    const strokes = copyStrokes(parts, shifted, weight, order);
    const drawn = drawRecord({ strokes }, drawBase, width);
    const found = difference(reference, drawn);
    natural ??= found;
    if (
      best === undefined ||
      found.lost < best.difference.lost ||
      (found.lost === best.difference.lost &&
        found.differing < best.difference.differing)
    ) {
      best = { order, difference: found };
    }
    if (found.differing === 0) break;
  }
  if (best === undefined || natural === undefined) {
    throw new Error("no parts");
  }
  const strokes = copyStrokes(parts, arrangement, weight, best.order);
  const record: InkRecord =
    merged === undefined
      ? { strokes }
      : { strokes, base: merged.layer };
  return {
    record,
    ...(merged === undefined
      ? {}
      : { base: merged.drawable }),
    order: best.order,
    natural,
    chosen: best.difference,
    tried,
    mergedBases: present(parts).filter((part) => part.base !== undefined)
      .length,
  };
}
