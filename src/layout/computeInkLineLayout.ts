import { IMAGE_SIZE } from "../constants";
import type { InkLineLayout } from "./inkLineLayout";

/**
 * Compute where the cap line and baseline sit on the ink square and the
 * inline vertical-align that anchors it to the text line.
 *
 * @remarks
 * Centers a capital-height band vertically on the text line: the cap band
 * sits in the middle of the square, so the leftover leading splits evenly
 * into an ascender/diacritic region above and a descender region below the
 * baseline. Pass the current cap-height ratio (see `capHeightRatio`) so
 * callers stay in sync with the measured text font.
 *
 * @param displayHeightEm - The inline display height of the square, in em.
 * @param capHeightRatio - Cap height as a fraction of the em.
 * @returns The line positions and vertical-align for that geometry.
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
