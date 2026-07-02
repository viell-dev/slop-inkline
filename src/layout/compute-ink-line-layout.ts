import { IMAGE_SIZE } from "../constants";
import type { InkLineLayout } from "./ink-line-layout";

/**
 * Center a capital-height band vertically on the text line: the cap band sits
 * in the middle of the square, so the leftover leading splits evenly into an
 * ascender/diacritic region above and a descender region below the baseline.
 * Pass the current cap-height ratio (see capHeightRatio) so callers stay in
 * sync with the measured text font.
 */
export function computeInkLineLayout(
  displayHeightEm: number,
  capHeightRatio: number,
): InkLineLayout {
  const halfBand = capHeightRatio / 2 / displayHeightEm;
  const capFraction = Math.max(0, 0.5 - halfBand);
  const baseFraction = Math.min(1, 0.5 + halfBand);

  return {
    capLineY: capFraction * IMAGE_SIZE,
    baselineY: baseFraction * IMAGE_SIZE,
    verticalAlignEm: -(displayHeightEm - capHeightRatio) / 2,
  };
}
