import {
  FULL_WIDTH_STEP,
  WIDTH_STEP_EPSILON_RATIO,
  WIDTH_STEPS,
} from "../constants";
import type { WidthStep } from "./widthStep";

/**
 * Snap outward to the smallest width step whose centered band contains all
 * ink, given the maximum horizontal distance of any ink from the vertical
 * center line as a fraction of the square's width.
 */
export function snapWidthStep(inkHalfWidthFraction: number): WidthStep {
  for (const step of WIDTH_STEPS) {
    if (inkHalfWidthFraction <= step / 2 + WIDTH_STEP_EPSILON_RATIO) {
      return step;
    }
  }

  return FULL_WIDTH_STEP;
}
