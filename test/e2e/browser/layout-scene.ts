// Prototype for #167 §4.1, not product code: synthetic parts for composing by
// layout, and the comparisons the end-to-end investigation makes.

import {
  unitsPerPixel,
  type InkRecord,
  type Stroke,
} from "../../../src/format/record.ts";
import { encodePixels, readPixels } from "../../../src/ink/canvas.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { drawInk, type DrawableBase } from "../../../src/ink/render.ts";
import {
  arrange,
  layoutNamed,
  placeStroke,
  type Band,
  type LayoutName,
  type Part,
  type Weight,
} from "../../../src/editor/layouts.ts";
import {
  canvasWidth,
  compose,
  difference,
  drawLayered,
  drawRecord,
  inked,
  margin,
  type DrawnPart,
} from "../../../src/editor/compose-draw.ts";

export * as layouts from "../../../src/editor/layouts.ts";
export * as composeDraw from "../../../src/editor/compose-draw.ts";

const px = (value: number): number => Math.round(value * unitsPerPixel);
const pts = (...values: number[]): number[] => values.map(px);

/** A circle's points, for a smooth closed stroke. */
function circle(cx: number, cy: number, r: number, count = 24): number[] {
  const out: number[] = [];
  for (let index = 0; index <= count; index++) {
    const angle = (index / count) * 2 * Math.PI;
    out.push(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  return pts(...out);
}

/** The synthetic parts, by name, as records to save. */
export function partDocuments(): Record<string, InkRecord> {
  const pen = (size: number, points: number[], more: Partial<Stroke> = {}) =>
    ({ tool: "pen", size: px(size), points, ...more }) as Stroke;
  return {
    // A ring with a dot, from cap height to the baseline.
    sun: {
      strokes: [pen(12, circle(52, 99, 40)), pen(16, pts(52, 99))],
    },
    // A zigzag at x-height, with sharp corners.
    wave: {
      strokes: [
        pen(10, pts(8, 136, 30, 92, 52, 136, 74, 92, 96, 136), {
          kind: "polygon",
        }),
      ],
    },
    // A stem with two bars.
    tower: {
      strokes: [
        pen(12, pts(40, 56, 40, 144)),
        pen(10, pts(14, 74, 66, 74), { kind: "polygon" }),
        pen(10, pts(22, 112, 58, 112), { kind: "polygon" }),
      ],
    },
    // A stem and a bar whose left end an eraser trims, the eraser running on
    // far to the left, past the image's edge, as erasers often do.
    notch: {
      strokes: [
        pen(14, pts(70, 56, 70, 144)),
        pen(10, pts(30, 96, 104, 96), { kind: "polygon" }),
        { tool: "eraser", size: px(24), points: pts(38, 96, -70, 96) },
      ],
    },
    // The same, mirrored: its eraser runs on to the right.
    notchR: {
      strokes: [
        pen(14, pts(50, 56, 50, 144)),
        pen(10, pts(16, 96, 90, 96), { kind: "polygon" }),
        { tool: "eraser", size: px(24), points: pts(82, 96, 190, 96) },
      ],
    },
    // A stroke with a descender, well below the baseline.
    hook: {
      strokes: [pen(12, pts(30, 60, 30, 156, 38, 174, 58, 178, 74, 168))],
    },
  };
}

/** A synthetic picture to trace: `kind` is a ring or an X. */
export async function picture(kind: "ring" | "cross"): Promise<Uint8Array> {
  const width = 128;
  const height = 192;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = x + 0.5 - 64;
      const cy = y + 0.5 - 99;
      const distance =
        kind === "ring"
          ? Math.abs(Math.hypot(cx, cy) - 40)
          : Math.min(Math.abs(cx - cy), Math.abs(cx + cy)) / Math.SQRT2 +
            Math.max(0, Math.max(Math.abs(cx), Math.abs(cy)) - 40) * 10;
      const cover = Math.max(0, Math.min(1, 7 - distance));
      data.set([0, 0, 0, Math.round(cover * 255)], (y * width + x) * 4);
    }
  }
  return encodePixels({ width, height, data });
}

export interface Built {
  readonly record: InkRecord;
  readonly base?: DrawableBase;
  readonly width: number;
  readonly order: readonly number[];
  readonly natural: { differing: number; lost: number };
  readonly chosen: { differing: number; lost: number };
  readonly tried: number;
  readonly mergedBases: number;
  readonly band: { top: number; bottom: number };
  readonly inked: number;
}

/** A layout of parts composed as the dialog composes it. */
export async function build(
  layout: LayoutName,
  parts: readonly DrawnPart[],
  weight: Weight = "scaled",
  band: Band = "ink",
): Promise<Built> {
  const arrangement = arrange(layoutNamed(layout), parts, band);
  const composed = await compose(parts, arrangement, weight);
  const drawn = drawRecord(
    {
      strokes: composed.record.strokes.map((stroke) =>
        placeStroke(stroke, { x: margin, y: 0, scale: 1 }, "kept"),
      ),
    },
    composed.base === undefined
      ? undefined
      : { ...composed.base, x: composed.base.x + margin * unitsPerPixel },
    canvasWidth(arrangement),
  );
  return {
    record: composed.record,
    ...(composed.base === undefined ? {} : { base: composed.base }),
    width: arrangement.width,
    order: composed.order,
    natural: composed.natural,
    chosen: composed.chosen,
    tried: composed.tried,
    mergedBases: composed.mergedBases,
    band: arrangement.band,
    inked: inked(drawn),
  };
}

/** How far a drawing's ink reaches, in rows, and its inked pixels. */
export function inkExtent(
  record: InkRecord,
  base: DrawableBase | undefined,
  width: number,
): { top: number; bottom: number; inked: number } | undefined {
  const canvas = drawRecord(
    {
      strokes: record.strokes.map((stroke) =>
        placeStroke(stroke, { x: margin, y: 0, scale: 1 }, "kept"),
      ),
    },
    base === undefined
      ? undefined
      : { ...base, x: base.x + margin * unitsPerPixel },
    Math.ceil(width) + 2 * margin,
  );
  const { data, width: w } = readPixels(canvas);
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 0) < 128) continue;
    count++;
    const row = Math.floor((index - 3) / 4 / w);
    top = Math.min(top, row);
    bottom = Math.max(bottom, row + 1);
  }
  return count === 0 ? undefined : { top, bottom, inked: count };
}

/**
 * Two ways to squeeze a part into a tall, narrow box, half as wide and as
 * tall as it is: its strokes' points stretched with one width kept for both
 * directions, as a stroke font's pen would draw them, against the part's
 * drawing stretched as a picture is, which makes a round pen an ellipse and
 * which a version-1 stroke cannot store.
 */
export function stretched(part: Part): {
  skeleton: OffscreenCanvas;
  picture: OffscreenCanvas;
  differing: number;
  lost: number;
  skeletonInk: number;
  pictureInk: number;
} {
  const width = Math.ceil(part.width / 2) + 2 * margin;
  const skeleton = drawRecord(
    {
      strokes: part.record.strokes.map((stroke) =>
        placeStroke(stroke, { x: margin, y: 0, scale: 0.5 }, "scaled", {
          x: 1,
          y: 2,
        }),
      ),
    },
    undefined,
    width,
  );
  const picture = new OffscreenCanvas(width, lineBox.height);
  const context = picture.getContext("2d");
  if (context === null) throw new Error("no 2D context");
  context.setTransform(0.5, 0, 0, 1, margin, 0);
  drawInk(context, part.record.strokes, undefined);
  const found = difference(picture, skeleton);
  return {
    skeleton,
    picture,
    differing: found.differing,
    lost: found.lost,
    skeletonInk: inked(skeleton),
    pictureInk: inked(picture),
  };
}

/** Draws parts on their own layers, as linked parts would be, for checks. */
export function layered(
  layout: LayoutName,
  parts: readonly DrawnPart[],
  weight: Weight = "scaled",
): OffscreenCanvas {
  return drawLayered(parts, arrange(layoutNamed(layout), parts), weight);
}

/** A canvas as a symbol's PNG bytes, the ink's grey, its alpha kept. */
export async function png(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const pixels = readPixels(canvas);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = 126;
    pixels.data[index + 1] = 126;
    pixels.data[index + 2] = 126;
  }
  return encodePixels(pixels);
}
