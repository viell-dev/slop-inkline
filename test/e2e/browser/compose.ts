// Prototype for #167 §4, not product code: building a symbol from other
// symbols, scaled and placed. Two ways are tried side by side:
//
// - Copying a part in: its strokes, moved and scaled, become strokes of the
//   new symbol, which stays a version-1 record.
// - Linking a part: the new symbol's record names the part, and drawing it
//   draws the part's own record on a layer of its own, then puts that layer
//   on the symbol. That needs a later format version.
//
// Either way, the file's pixels are the symbol as drawn, so notes show it as
// any other symbol.

import { deflate, readChunks, writeChunks } from "../../../src/format/png.ts";
import {
  unitsPerPixel,
  type BaseLayer,
  type InkRecord,
  type Stroke,
} from "../../../src/format/record.ts";
import { recordChunkType } from "../../../src/format/ink-file.ts";
import {
  drawableBase,
  encodePixels,
  readPixels,
} from "../../../src/ink/canvas.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { greyInk, inkBounds } from "../../../src/ink/pixels.ts";
import { drawInk, type DrawableBase } from "../../../src/ink/render.ts";
import type { PartRef } from "./compose-graph.ts";

/** Where a part goes: its top left corner, in pixels, and its scale. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /**
   * `"scale"` scales a stroke's width with its points, as a picture would
   * shrink. `"keep"` keeps the width, as fonts' composed forms keep their
   * stroke weight; a fill has no width and shrinks either way.
   */
  readonly weight: "scale" | "keep";
}

/** A part and where it goes. */
export interface Placed {
  readonly record: InkRecord;
  readonly placement: Placement;
}

/** A unit coordinate placed: scaled from the part's origin and moved. */
function placedUnit(value: number, origin: number, scale: number): number {
  return Math.round(origin * unitsPerPixel + value * scale);
}

/** A stroke of a part, moved and scaled into the composite. */
export function placeStroke(stroke: Stroke, placement: Placement): Stroke {
  const { x, y, scale, weight } = placement;
  const points = stroke.points.map((value, index) =>
    placedUnit(value, index % 2 === 0 ? x : y, scale),
  );
  if (stroke.kind === "fill") return { ...stroke, points };
  const size =
    weight === "keep"
      ? stroke.size
      : Math.max(1, Math.round(stroke.size * scale));
  return { ...stroke, points, size };
}

/** A part's base layer, moved and scaled into the composite. */
export function placeBase(base: BaseLayer, placement: Placement): BaseLayer {
  const { x, y, scale } = placement;
  return {
    ...base,
    x: placedUnit(base.x, x, scale),
    y: placedUnit(base.y, y, scale),
    width: Math.max(1, Math.round(base.width * scale)),
    height: Math.max(1, Math.round(base.height * scale)),
  };
}

/** A part's record, moved and scaled. */
export function placeRecord(record: InkRecord, placement: Placement): InkRecord {
  const strokes = record.strokes.map((stroke) => placeStroke(stroke, placement));
  return record.base === undefined
    ? { strokes }
    : { strokes, base: placeBase(record.base, placement) };
}

export type CopyResult =
  | { readonly ok: true; readonly record: InkRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * Copies parts into one version-1 record, in order: their strokes, one part
 * after another. A record holds one base layer, so two parts that each have
 * one cannot be copied in as they are.
 */
export function copyIn(parts: readonly Placed[]): CopyResult {
  const placed = parts.map(({ record, placement }) =>
    placeRecord(record, placement),
  );
  const bases = placed.flatMap((each) =>
    each.base === undefined ? [] : [each.base],
  );
  if (bases.length > 1) {
    return {
      ok: false,
      reason: `${String(bases.length)} parts have a base layer, and a record holds one`,
    };
  }
  const strokes = placed.flatMap((each) => each.strokes);
  const [base] = bases;
  return { ok: true, record: base === undefined ? { strokes } : { strokes, base } };
}

/** A canvas of the line box's height. */
function surface(width: number): {
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
} {
  const canvas = new OffscreenCanvas(width, lineBox.height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D context");
  return { canvas, context };
}

async function drawable(
  base: BaseLayer | undefined,
): Promise<DrawableBase | undefined> {
  return base === undefined ? undefined : drawableBase(base);
}

/** Draws a record on a canvas `width` pixels wide, as a save would. */
export async function drawRecord(
  record: InkRecord,
  width: number,
): Promise<OffscreenCanvas> {
  const { canvas, context } = surface(width);
  drawInk(context, record.strokes, await drawable(record.base));
  return canvas;
}

/**
 * Draws parts as linked parts would be drawn: each on a layer of its own,
 * placed as {@link placeRecord} places it, so that its erasers remove only
 * its own ink, then the layer over what is there. `then` are the composite's
 * own strokes, drawn last over everything.
 */
export async function drawLayered(
  parts: readonly Placed[],
  width: number,
  then: readonly Stroke[] = [],
): Promise<OffscreenCanvas> {
  const { canvas, context } = surface(width);
  for (const { record, placement } of parts) {
    const placed = placeRecord(record, placement);
    const layer = surface(width);
    drawInk(layer.context, placed.strokes, await drawable(placed.base));
    context.globalCompositeOperation = "source-over";
    context.drawImage(layer.canvas, 0, 0);
  }
  drawInk(context, then, undefined);
  return canvas;
}

/**
 * Draws parts scaled as a picture is, by the canvas's own transform, from
 * their records as they are: the exact shape scaled, to compare with strokes
 * whose points were scaled.
 */
export async function drawTransformed(
  parts: readonly Placed[],
  width: number,
): Promise<OffscreenCanvas> {
  const { canvas, context } = surface(width);
  for (const { record, placement } of parts) {
    const layer = surface(width);
    layer.context.setTransform(
      placement.scale,
      0,
      0,
      placement.scale,
      placement.x,
      placement.y,
    );
    drawInk(layer.context, record.strokes, await drawable(record.base));
    context.drawImage(layer.canvas, 0, 0);
  }
  return canvas;
}

/** The alpha channel of a canvas. */
function alpha(canvas: OffscreenCanvas): Uint8ClampedArray {
  const { data } = readPixels(canvas);
  const out = new Uint8ClampedArray(data.length / 4);
  for (let index = 0; index < out.length; index++) {
    out[index] = data[index * 4 + 3] ?? 0;
  }
  return out;
}

export interface Difference {
  /** Pixels whose alpha differs by more than `tolerance`. */
  readonly differing: number;
  /** The largest difference in alpha, 0 to 255. */
  readonly largest: number;
  /** Pixels at least half inked, in each. */
  readonly inkA: number;
  readonly inkB: number;
  /** Pixels inked in `a` and at most faint in `b`: ink that went. */
  readonly lost: number;
  /** The bounds of the differing pixels, if any. */
  readonly bounds?: { left: number; top: number; right: number; bottom: number };
}

/** How two drawings of the same size differ. */
export function difference(
  a: OffscreenCanvas,
  b: OffscreenCanvas,
  tolerance = 16,
): Difference {
  const first = alpha(a);
  const second = alpha(b);
  let differing = 0;
  let largest = 0;
  let inkA = 0;
  let inkB = 0;
  let lost = 0;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let index = 0; index < first.length; index++) {
    const one = first[index] ?? 0;
    const two = second[index] ?? 0;
    if (one >= 128) inkA++;
    if (two >= 128) inkB++;
    if (one >= 192 && two <= 64) lost++;
    const delta = Math.abs(one - two);
    largest = Math.max(largest, delta);
    if (delta > tolerance) {
      differing++;
      const x = index % a.width;
      const y = Math.floor(index / a.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return {
    differing,
    largest,
    inkA,
    inkB,
    lost,
    ...(differing === 0 ? {} : { bounds: { left, top, right, bottom } }),
  };
}

/** A canvas's pixels as a symbol image: the ink's grey, its alpha kept. */
export async function imagePng(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const pixels = readPixels(canvas);
  greyInk(pixels.data);
  return encodePixels(pixels);
}

/** The columns a drawing's ink spans, with Inkline's side bearings. */
export function inkSpan(
  canvas: OffscreenCanvas,
): { left: number; right: number } | undefined {
  const bounds = inkBounds(readPixels(canvas));
  return bounds === undefined
    ? undefined
    : { left: bounds.left, right: bounds.right };
}

/** A canvas cut to columns `left` to `left + width`. */
export function cropCanvas(
  canvas: OffscreenCanvas,
  left: number,
  width: number,
): OffscreenCanvas {
  const { canvas: out, context } = surface(width);
  context.drawImage(canvas, -left, 0);
  return out;
}

/**
 * A prototype version-2 record: the composite's own strokes, and its parts by
 * path, each placed. A snapshot of each part's record could go with it, so
 * that the composite can still be drawn when a part is gone; this prototype
 * leaves it out to show what happens without one.
 */
export interface VersionTwo {
  readonly strokes: readonly unknown[];
  readonly parts: readonly PartRef[];
}

/**
 * A file with a version-2 record: `image` is its pixels, and the record goes
 * in the record chunk after a version of 2, as the format's versions say a
 * later version's must.
 */
export async function versionTwoFile(
  image: OffscreenCanvas,
  record: VersionTwo,
): Promise<Uint8Array> {
  const png = await imagePng(image);
  const text = new TextEncoder().encode(JSON.stringify(record));
  const compressed = await deflate(text);
  const data = new Uint8Array(4 + compressed.length);
  new DataView(data.buffer).setUint32(0, 2);
  data.set(compressed, 4);
  const [header, ...rest] = readChunks(png);
  if (header === undefined) throw new Error("no header");
  return writeChunks([header, { type: recordChunkType, data }, ...rest]);
}

/** Reads the version and record of a file's record chunk, if any. */
export async function recordChunkOf(
  bytes: Uint8Array,
): Promise<{ version: number; record: unknown } | undefined> {
  const chunk = readChunks(bytes).find((each) => each.type === recordChunkType);
  if (chunk === undefined) return undefined;
  const version = new DataView(
    chunk.data.buffer,
    chunk.data.byteOffset,
    4,
  ).getUint32(0);
  const stream = new Blob([chunk.data.slice(4)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const text = await new Response(stream).text();
  return { version, record: JSON.parse(text) as unknown };
}

// The scene the end-to-end prototype uses: synthetic parts, a triangle of
// three of them in one symbol's size, and each way of building it.

const px = (value: number): number => Math.round(value * unitsPerPixel);
const pts = (...values: number[]): number[] => values.map(px);

/**
 * A synthetic sign to use as a part: an arch on the baseline with flat
 * ends, a bar across it, a filled diamond, and a wide eraser stroke that
 * trims the bar's right end, reaching well into the empty space below it, as
 * an eraser often does.
 */
export function markDocument(): InkRecord {
  return {
    strokes: [
      {
        tool: "pen",
        size: px(12),
        points: pts(24, 144, 24, 96, 26, 72, 34, 56, 46, 45, 64, 40, 82, 45),
        cut: { start: "down" },
      },
      {
        tool: "pen",
        size: px(12),
        points: pts(82, 45, 94, 56, 102, 72, 104, 96, 104, 144),
        cut: { end: "down" },
      },
      { tool: "pen", size: px(10), points: pts(8, 100, 128, 100), kind: "polygon" },
      { tool: "pen", points: pts(64, 54, 74, 68, 64, 82, 54, 68), kind: "fill" },
      { tool: "eraser", size: px(32), points: pts(124, 84, 124, 190) },
    ],
  };
}

/** A synthetic picture of a ring, 128 by 192, to trace as a base layer. */
export async function ringPicture(): Promise<Uint8Array> {
  const width = 128;
  const height = 192;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x + 0.5 - 64, y + 0.5 - 92);
      const cover = Math.max(0, Math.min(1, 7 - Math.abs(distance - 40)));
      data.set([0, 0, 0, Math.round(cover * 255)], (y * width + x) * 4);
    }
  }
  return encodePixels({ width, height, data });
}

/**
 * Three parts in a triangle, each at half size, so the whole is one symbol's
 * height: two on the baseline, side by side, and one above them, placed last
 * as a person might place it. `width` is the part's image width.
 */
export function triangle(
  width: number,
  weight: "scale" | "keep",
): Placement[] {
  const scale = 0.5;
  // The parts' side bearings overlap, so their ink just meets.
  const step = width * scale - 8;
  return [
    { x: 0, y: 72, scale, weight },
    { x: step, y: 72, scale, weight },
    { x: step / 2, y: 12, scale, weight },
  ];
}

/** Placements nested `depth` deep, each level a triangle of the one below. */
export function nested(depth: number, width: number): Placement[] {
  let leaves: Placement[] = [{ x: 0, y: 0, scale: 1, weight: "scale" }];
  for (let level = 0; level < depth; level++) {
    const next: Placement[] = [];
    for (const outer of leaves) {
      for (const inner of triangle(width, "scale")) {
        next.push({
          x: outer.x + inner.x * outer.scale,
          y: outer.y + inner.y * outer.scale,
          scale: outer.scale * inner.scale,
          weight: "scale",
        });
      }
    }
    leaves = next;
  }
  return leaves;
}

/** A flattened composite: one base layer of exactly what the parts draw. */
export async function flattened(
  canvas: OffscreenCanvas,
): Promise<{ document: InkRecord; base: DrawableBase }> {
  const layer: BaseLayer = {
    x: 0,
    y: 0,
    width: canvas.width * unitsPerPixel,
    height: lineBox.height * unitsPerPixel,
    png: await imagePng(canvas),
  };
  return {
    document: { strokes: [], base: layer },
    base: await drawableBase(layer),
  };
}

/** A canvas cropped as Inkline crops a save: the ink and its side bearings. */
export function cropped(canvas: OffscreenCanvas): {
  canvas: OffscreenCanvas;
  left: number;
} {
  const span = inkSpan(canvas);
  const left = span === undefined ? 0 : Math.floor(span.left) - 8;
  const right = span === undefined ? 48 : Math.ceil(span.right) + 8;
  return { canvas: cropCanvas(canvas, left, right - left), left };
}

/** The parts of a linked composite, as a version-2 record names them. */
export function partRefs(
  symbol: string,
  placements: readonly Placement[],
  left: number,
): PartRef[] {
  return placements.map((placement) => ({
    symbol,
    x: Math.round((placement.x - left) * unitsPerPixel),
    y: Math.round(placement.y * unitsPerPixel),
    scale: Math.round(placement.scale * 4096),
  }));
}

/** A version-2 record's parts as placements, with their records. */
export function placedRefs(
  parts: readonly PartRef[],
  records: ReadonlyMap<string, InkRecord>,
): Placed[] | { missing: string } {
  const placed: Placed[] = [];
  for (const ref of parts) {
    const record = records.get(ref.symbol);
    if (record === undefined) return { missing: ref.symbol };
    placed.push({
      record,
      placement: {
        x: ref.x / unitsPerPixel,
        y: ref.y / unitsPerPixel,
        scale: ref.scale / 4096,
        weight: "scale",
      },
    });
  }
  return placed;
}
