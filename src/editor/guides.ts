// Typographic guides: where the lines of the note's font fall in the line box,
// the grid laid out on them, and where the saved image would start and end, so
// that a symbol can be drawn to sit with the text around it.

import { unitsPerPixel } from "../format/record.ts";
import { crop, lineBox } from "../ink/geometry.ts";

/** A horizontal extent, in document pixels. */
export interface Span {
  readonly left: number;
  readonly right: number;
}

/** A font's vertical metrics, in em, as measured from its glyphs. */
export interface FontMetrics {
  /** The font's ascent above the baseline. */
  readonly ascent: number;
  /** The font's descent below the baseline. */
  readonly descent: number;
  /** The height of a capital letter, such as H. */
  readonly capHeight: number;
  /** The height of a lowercase letter without ascender, such as x. */
  readonly xHeight: number;
}

export type GuideName =
  "ascender" | "cap height" | "x-height" | "baseline" | "descender";

/** The font's guides, top to bottom. */
export const guideNames: readonly GuideName[] = [
  "ascender",
  "cap height",
  "x-height",
  "baseline",
  "descender",
];

/**
 * The CSS custom property that colours a guide, as `--inkline-guide-cap-height`,
 * which styles.css sets from the theme's colours and a CSS snippet can change.
 */
export function guideColourProperty(name: GuideName): string {
  return `--inkline-guide-${name.replace(" ", "-")}`;
}

export interface Guide {
  readonly name: GuideName;
  /** In line box pixels from the top. */
  readonly y: number;
}

/**
 * The guides for a font, top to bottom, in the line box's pixels. A line
 * that would fall outside the line box, as for a font with a tall ascent, is
 * left out.
 */
export function fontGuides(metrics: FontMetrics): Guide[] {
  const { baseline, pxPerEm, height } = lineBox;
  const guides: Guide[] = [
    { name: "ascender", y: baseline - metrics.ascent * pxPerEm },
    { name: "cap height", y: baseline - metrics.capHeight * pxPerEm },
    { name: "x-height", y: baseline - metrics.xHeight * pxPerEm },
    { name: "baseline", y: baseline },
    { name: "descender", y: baseline + metrics.descent * pxPerEm },
  ];
  return guides.filter(
    (guide) => Number.isFinite(guide.y) && guide.y >= 0 && guide.y <= height,
  );
}

/** The grid that strokes' ends snap to, in document pixels. */
export interface Grid {
  /**
   * How far apart its columns are, a whole number of units so that ends
   * snapped to them keep their place exactly; rows beyond the font's
   * outermost lines are as far apart.
   */
  readonly spacing: number;
  /** Where its rows are, top to bottom, in the line box's pixels. */
  readonly rows: readonly number[];
}

/** How many grid cells may span the x-height, fewest and most. */
export const gridCellRange = { min: 2, max: 10 } as const;

/** How many grid cells span the x-height unless the settings say otherwise. */
export const defaultGridCells = 5;

/** The x-height assumed before the note's font is measured: half an em. */
const assumedXHeight = lineBox.pxPerEm / 2;

/**
 * The grid for a font whose x-height is `xHeight` pixels, with `cells` cells
 * across that height. Its rows pass through the baseline and through each of
 * `lines`, the font's lines chosen to show, and divide the space between two
 * neighbouring ones evenly, into as many cells as come nearest the x-height's
 * own; beyond the outermost, they go on that far apart to the line box's
 * edges. Text-sized symbols can then start and end strokes on every chosen
 * line, which no evenly spaced grid could do for every font. Its columns are
 * as far apart as the x-height's rows, rounded to whole units.
 */
export function fontGrid(
  lines: readonly Guide[],
  xHeight: number,
  cells: number,
): Grid {
  const count = Number.isFinite(cells)
    ? Math.min(
        gridCellRange.max,
        Math.max(gridCellRange.min, Math.round(cells)),
      )
    : defaultGridCells;
  const target =
    (Number.isFinite(xHeight) && xHeight > 0 ? xHeight : assumedXHeight) /
    count;
  const spacing = Math.max(
    1 / unitsPerPixel,
    Math.round(target * unitsPerPixel) / unitsPerPixel,
  );
  const { height, baseline } = lineBox;
  const anchors = [...lines.map((line) => line.y), baseline]
    .filter((y) => Number.isFinite(y) && y >= 0 && y <= height)
    .sort((a, b) => a - b)
    .filter((y, index, all) => index === 0 || y - (all[index - 1] ?? 0) > 1e-6);
  const first = anchors[0] ?? baseline;
  const last = anchors.at(-1) ?? baseline;
  const rows: number[] = [];
  for (let y = first - spacing; y >= 0; y -= spacing) rows.unshift(y);
  anchors.forEach((y, index) => {
    rows.push(y);
    const next = anchors[index + 1];
    if (next === undefined) return;
    const band = Math.max(1, Math.round((next - y) / target));
    for (let step = 1; step < band; step++) {
      rows.push(y + ((next - y) * step) / band);
    }
  });
  for (let y = last + spacing; y <= height; y += spacing) rows.push(y);
  return { spacing, rows };
}

/**
 * Where a saved image would start and end, in pixels, for ink that reaches
 * across `span`, if any: its crop, side bearings included.
 */
export function cropSpan(span: Span | undefined): Span {
  const { left, width } = crop(
    span === undefined
      ? undefined
      : { left: span.left, right: span.right, top: 0, bottom: lineBox.height },
  );
  return { left, right: left + width };
}

/** The extent of two drawings together, either of which may be empty. */
export function joinSpans(
  a: Span | undefined,
  b: Span | undefined,
): Span | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) };
}
