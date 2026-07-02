import { FULL_WIDTH_STEP, WIDTH_STEPS } from "../constants";
import type { WidthStep } from "./width-step";

/**
 * The width step a stored PNG was exported at, recovered from its aspect
 * ratio. Export widths round to whole pixels, so the ratio deviates from the
 * step by at most half a pixel of the stored height; snapping to the nearest
 * step removes that error before the image is re-centered onto the square.
 */
export function snapAspectToWidthStep(aspectRatio: number): WidthStep {
  let best: WidthStep = FULL_WIDTH_STEP;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const step of WIDTH_STEPS) {
    const distance = Math.abs(aspectRatio - step);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }

  return best;
}
