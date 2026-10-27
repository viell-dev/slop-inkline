// Typographic guides: where the lines of the note's font fall in the line box,
// and where the saved image would start and end, so that a symbol can be drawn
// to sit with the text around it.

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
