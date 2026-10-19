// Typographic guides: where the lines of the note's font fall in the line box,
// and where the saved image would start and end, so that a symbol can be drawn
// to sit with the text around it.

import { documentSpan, type InkDocument } from "../ink/document.ts";
import { crop, lineBox } from "../ink/geometry.ts";

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
 * Where a drawing's saved image would start and end, in pixels: the crop of
 * its extent, side bearings included. `baseWidth` is its base layer's image
 * width. The extent is the strokes' geometry, which can reach a little past
 * the pixels a save crops to, as where an eraser cut the ink away.
 */
export function imageSpan(
  document: InkDocument,
  baseWidth?: number,
): { left: number; right: number } {
  return cropSpan(documentSpan(document, baseWidth));
}

/** The image's ends for drawing that reaches from `left` to `right`, if any. */
export function cropSpan(span: { left: number; right: number } | undefined): {
  left: number;
  right: number;
} {
  const { left, width } = crop(
    span === undefined
      ? undefined
      : { left: span.left, right: span.right, top: 0, bottom: lineBox.height },
  );
  return { left, right: left + width };
}

/** The extent of two drawings together, either of which may be empty. */
export function joinSpans(
  a: { left: number; right: number } | undefined,
  b: { left: number; right: number } | undefined,
): { left: number; right: number } | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) };
}
