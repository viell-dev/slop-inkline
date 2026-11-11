// Prototype for #167 §4, not for release: adding another symbol to the
// drawing as a part, scaled and placed, by copying its strokes in. The part
// is shown while it is placed as the picture to trace is, and Move's drag,
// wheel, arrow keys, and + and − place it; then its strokes join the drawing
// as one step that Undo takes back.

import {
  unitsPerPixel,
  type BaseLayer,
  type InkRecord,
  type Stroke,
} from "../format/record.ts";
import type { Placement } from "./reference.ts";

/** Whether a placed part's strokes keep their width or shrink with it. */
export type Weight = "scale" | "keep";

function placed(value: number, origin: number, scale: number): number {
  return Math.round(origin * unitsPerPixel + value * scale);
}

/**
 * A part's stroke where `placement` puts the part: a part pixel at (`px`,
 * `py`) lands at (`x + px × scale`, `y + py × scale`) in the drawing.
 */
export function placeStroke(
  stroke: Stroke,
  placement: Placement,
  weight: Weight,
): Stroke {
  const { x, y, scale } = placement;
  const points = stroke.points.map((value, index) =>
    placed(value, index % 2 === 0 ? x : y, scale),
  );
  if (stroke.kind === "fill") return { ...stroke, points };
  const size =
    weight === "keep"
      ? stroke.size
      : Math.max(1, Math.round(stroke.size * scale));
  return { ...stroke, points, size };
}

function placeBase(base: BaseLayer, placement: Placement): BaseLayer {
  const { x, y, scale } = placement;
  return {
    ...base,
    x: placed(base.x, x, scale),
    y: placed(base.y, y, scale),
    width: Math.max(1, Math.round(base.width * scale)),
    height: Math.max(1, Math.round(base.height * scale)),
  };
}

export type Added =
  | { readonly ok: true; readonly document: InkRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * The drawing with a part added after what it holds. A drawing holds one base
 * layer, so a part with one goes only into a drawing without.
 */
export function addPart(
  drawing: InkRecord,
  part: InkRecord,
  placement: Placement,
  weight: Weight,
): Added {
  if (part.base !== undefined && drawing.base !== undefined) {
    return {
      ok: false,
      reason: "the drawing and the part both have ink made from a picture",
    };
  }
  const strokes = [
    ...drawing.strokes,
    ...part.strokes.map((stroke) => placeStroke(stroke, placement, weight)),
  ];
  const base =
    part.base === undefined ? drawing.base : placeBase(part.base, placement);
  return {
    ok: true,
    document: base === undefined ? { strokes } : { strokes, base },
  };
}
