// Prototype for #167 §4.1, not for release: composing a symbol from other
// symbols by a fixed layout of boxes, rather than placing each part freely.
// A symbol's box is split into four, two rows by two columns; each layout
// puts its parts in some of those boxes at half size, and a part alone in its
// row or column is centred across it. "Single" is one part at full size.
//
// The parts' strokes are then copied in, scaled and moved, as round 1's Add
// part did, so the result is an ordinary version-1 record. This module is
// plain arithmetic on records, so that unit tests can check it; the editor's
// dialog and the end-to-end investigation draw with it.

import {
  unitsPerPixel,
  type InkRecord,
  type Stroke,
} from "../format/record.ts";
import { lineBox, sideBearing } from "../ink/geometry.ts";
import { strokeBounds } from "../ink/outline.ts";

/** Which of the two rows or columns a part is in, or both, centred. */
export type Span = 0 | 1 | "both";

/** A box of a layout, by the letter the owner's picture gives it. */
export interface Slot {
  readonly letter: "A" | "B" | "C" | "D";
  readonly row: Span;
  readonly column: Span;
}

export type LayoutName =
  | "single"
  | "across"
  | "stacked"
  | "point-up"
  | "point-right"
  | "point-down"
  | "point-left"
  | "square";

export interface Layout {
  readonly name: LayoutName;
  readonly label: string;
  /** The same layout as an Ideographic Description Sequence would write it. */
  readonly ids: string;
  readonly slots: readonly Slot[];
}

/**
 * The owner's eight layouts, in the order of their picture. The letters only
 * tell the parts apart; they say nothing about an order of writing.
 */
export const layouts: readonly Layout[] = [
  {
    name: "single",
    label: "Single",
    ids: "A",
    slots: [{ letter: "A", row: "both", column: "both" }],
  },
  {
    name: "across",
    label: "Side by side",
    ids: "⿰AB",
    slots: [
      { letter: "A", row: "both", column: 0 },
      { letter: "B", row: "both", column: 1 },
    ],
  },
  {
    name: "stacked",
    label: "Stacked",
    ids: "⿱AB",
    slots: [
      { letter: "A", row: 0, column: "both" },
      { letter: "B", row: 1, column: "both" },
    ],
  },
  {
    name: "point-up",
    label: "Triangle, point up",
    ids: "⿱A⿰BC",
    slots: [
      { letter: "A", row: 0, column: "both" },
      { letter: "B", row: 1, column: 0 },
      { letter: "C", row: 1, column: 1 },
    ],
  },
  {
    name: "point-right",
    label: "Triangle, point right",
    ids: "⿰⿱ACB",
    slots: [
      { letter: "A", row: 0, column: 0 },
      { letter: "B", row: "both", column: 1 },
      { letter: "C", row: 1, column: 0 },
    ],
  },
  {
    name: "point-down",
    label: "Triangle, point down",
    ids: "⿱⿰ABC",
    slots: [
      { letter: "A", row: 0, column: 0 },
      { letter: "B", row: 0, column: 1 },
      { letter: "C", row: 1, column: "both" },
    ],
  },
  {
    name: "point-left",
    label: "Triangle, point left",
    ids: "⿰B⿱AC",
    slots: [
      { letter: "A", row: 0, column: 1 },
      { letter: "B", row: "both", column: 0 },
      { letter: "C", row: 1, column: 1 },
    ],
  },
  {
    name: "square",
    label: "Square",
    ids: "⿱⿰AB⿰CD",
    slots: [
      { letter: "A", row: 0, column: 0 },
      { letter: "B", row: 0, column: 1 },
      { letter: "C", row: 1, column: 0 },
      { letter: "D", row: 1, column: 1 },
    ],
  },
];

export function layoutNamed(name: LayoutName): Layout {
  const found = layouts.find((each) => each.name === name);
  if (found === undefined) throw new Error(`no layout ${name}`);
  return found;
}

/**
 * What a full-size symbol's box is, top to bottom, which the layout splits in
 * two rows:
 *
 * - `"line"`: the whole image, 192 pixels, as the file's geometry has it.
 * - `"em"`: one em standing on the baseline, as CJK fonts' ideographic box.
 * - `"ink"`: from the top of the highest part's ink to the bottom of the
 *   lowest, so the composite fills the height its parts fill at full size.
 */
export type Band = "line" | "em" | "ink";

/** How a part's line widths follow its size. */
export type Weight = "scaled" | "between" | "kept";

/** A stroke width's factor, against the part's own, at `scale`. */
export function weightFactor(weight: Weight, scale: number): number {
  if (weight === "kept") return 1;
  if (weight === "between") return Math.sqrt(scale);
  return scale;
}

/** A part: its record, and its image's width in pixels, side bearings in. */
export interface Part {
  readonly record: InkRecord;
  readonly width: number;
}

/** Where a part goes: a part pixel (px, py) lands at (x + px·s, y + py·s). */
export interface Placement {
  readonly letter: Slot["letter"];
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** The box the part is centred in, in pixels, for drawing guides. */
  readonly box: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface Arrangement {
  readonly layout: LayoutName;
  readonly placements: readonly Placement[];
  /** How wide the parts' boxes are together, in pixels. */
  readonly width: number;
  /** The band the layout splits, in pixels from the image's top. */
  readonly band: { readonly top: number; readonly bottom: number };
}

/** Where a record's pen ink can be, top to bottom, in pixels. */
export function inkRows(
  record: InkRecord,
): { top: number; bottom: number } | undefined {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const stroke of record.strokes) {
    // An eraser takes ink away, and often reaches into empty space.
    if (stroke.tool !== "pen") continue;
    const bounds = strokeBounds(stroke);
    if (bounds === undefined) continue;
    top = Math.min(top, bounds.top);
    bottom = Math.max(bottom, bounds.bottom);
  }
  const { base } = record;
  if (base !== undefined) {
    top = Math.min(top, base.y / unitsPerPixel);
    bottom = Math.max(bottom, (base.y + base.height) / unitsPerPixel);
  }
  if (top > bottom) return undefined;
  return {
    top: Math.max(0, top),
    bottom: Math.min(lineBox.height, bottom),
  };
}

/** The band a layout of these parts splits, by `band`. */
export function bandOf(
  parts: readonly Part[],
  band: Band,
): { top: number; bottom: number } {
  if (band === "line") return { top: 0, bottom: lineBox.height };
  if (band === "em") {
    return { top: lineBox.baseline - lineBox.pxPerEm, bottom: lineBox.baseline };
  }
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const part of parts) {
    const rows = inkRows(part.record);
    if (rows === undefined) continue;
    top = Math.min(top, rows.top);
    bottom = Math.max(bottom, rows.bottom);
  }
  return top > bottom ? bandOf(parts, "em") : { top, bottom };
}

/**
 * Space between the two rows, in pixels: what two half-size parts side by
 * side have between them, their half side bearings, so that across and down
 * look alike.
 */
export const rowGap = sideBearing;

/**
 * Places the parts in a layout's boxes. `parts` go with the layout's slots in
 * order; a slot whose part is missing is left empty, keeping its box's size
 * from the others.
 */
export function arrange(
  layout: Layout,
  parts: readonly (Part | undefined)[],
  band: Band = "ink",
): Arrangement {
  const present = parts.filter((part): part is Part => part !== undefined);
  const rows = bandOf(present, band);
  const height = rows.bottom - rows.top;
  const single = layout.slots.length === 1;
  const scale = single ? 1 : 0.5;
  const twoRows = layout.slots.some((slot) => slot.row !== "both");
  const cellHeight = height * scale;
  const total = twoRows ? 2 * cellHeight + rowGap : cellHeight;
  const middle = (rows.top + rows.bottom) / 2;
  const top = middle - total / 2;

  const widthOf = (index: number): number => (parts[index]?.width ?? 0) * scale;
  const columns = [0, 0];
  for (const [index, slot] of layout.slots.entries()) {
    if (slot.column !== "both") {
      columns[slot.column] = Math.max(columns[slot.column] ?? 0, widthOf(index));
    }
  }
  // A part across both columns that is wider than both widens them evenly.
  for (const [index, slot] of layout.slots.entries()) {
    if (slot.column !== "both") continue;
    const short = widthOf(index) - ((columns[0] ?? 0) + (columns[1] ?? 0));
    if (short > 0) {
      columns[0] = (columns[0] ?? 0) + short / 2;
      columns[1] = (columns[1] ?? 0) + short / 2;
    }
  }
  const [left = 0, right = 0] = columns;
  const placements: Placement[] = [];
  for (const [index, slot] of layout.slots.entries()) {
    const part = parts[index];
    if (part === undefined) continue;
    const boxLeft = slot.column === 1 ? left : 0;
    const boxWidth =
      slot.column === "both" ? left + right : slot.column === 0 ? left : right;
    let boxTop: number;
    if (!twoRows || slot.row === "both") boxTop = middle - cellHeight / 2;
    else if (slot.row === 0) boxTop = top;
    else boxTop = top + cellHeight + rowGap;
    const partWidth = widthOf(index);
    const x = boxLeft + (boxWidth - partWidth) / 2;
    // The part's own band starts at the band's top, so its top goes there.
    const y = single ? 0 : boxTop - rows.top * scale;
    placements.push({
      letter: slot.letter,
      x,
      y,
      scale,
      box: { left: boxLeft, top: boxTop, width: boxWidth, height: cellHeight },
    });
  }
  return { layout: layout.name, placements, width: left + right, band: rows };
}

function placedUnit(value: number, origin: number, scale: number): number {
  return Math.round(origin * unitsPerPixel + value * scale);
}

/** A part's stroke where `placement` puts it, widths by `weight`. */
export function placeStroke(
  stroke: Stroke,
  placement: Pick<Placement, "x" | "y" | "scale">,
  weight: Weight,
  stretch: { readonly x: number; readonly y: number } = { x: 1, y: 1 },
): Stroke {
  const { x, y, scale } = placement;
  const sx = scale * stretch.x;
  const sy = scale * stretch.y;
  const points = stroke.points.map((value, index) =>
    index % 2 === 0 ? placedUnit(value, x, sx) : placedUnit(value, y, sy),
  );
  if (stroke.kind === "fill") return { ...stroke, points };
  // A stretched part keeps one width for both directions: the smaller scale,
  // as a stroke-based font's pen does.
  const factor = weightFactor(weight, Math.min(sx, sy));
  const size = Math.max(1, Math.round(stroke.size * factor));
  return { ...stroke, points, size };
}

/** The strokes of the parts copied in, part by part in `order`. */
export function copyStrokes(
  parts: readonly (Part | undefined)[],
  arrangement: Arrangement,
  weight: Weight,
  order: readonly number[] = arrangement.placements.map((_, index) => index),
): Stroke[] {
  const present = parts.filter((part): part is Part => part !== undefined);
  const strokes: Stroke[] = [];
  for (const index of order) {
    const placement = arrangement.placements[index];
    const part = present[index];
    if (placement === undefined || part === undefined) continue;
    for (const stroke of part.record.strokes) {
      strokes.push(placeStroke(stroke, placement, weight));
    }
  }
  return strokes;
}

/** Every order of `count` parts, the natural one first. */
export function orders(count: number): number[][] {
  if (count <= 1) return [Array.from({ length: count }, (_, index) => index)];
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    for (const [at, next] of rest.entries()) {
      walk([...prefix, next], [...rest.slice(0, at), ...rest.slice(at + 1)]);
    }
  };
  walk([], Array.from({ length: count }, (_, index) => index));
  return out;
}
