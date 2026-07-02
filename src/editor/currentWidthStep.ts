import { SURFACE_SIZE } from "../constants";
import { measureInkHalfWidthFraction } from "../canvas/measureInkHalfWidthFraction";
import { snapWidthStep } from "../ink/snapWidthStep";
import type { WidthStep } from "../ink/widthStep";

/**
 * The width step the canvas would export at right now. While the drawing is
 * untouched since the last load or save, the step implied by the file's own
 * aspect ratio is kept as-is, so a plain reopen-and-save can never move a
 * borderline drawing to a neighboring step; once the user draws, erases, or
 * clears, the step is re-detected from the ink extent.
 */
export function currentWidthStep(
  ctx: CanvasRenderingContext2D,
  state: { contentModified: boolean; loadedStep: WidthStep | null },
): WidthStep {
  if (!state.contentModified && state.loadedStep !== null) {
    return state.loadedStep;
  }

  return snapWidthStep(measureInkHalfWidthFraction(ctx, SURFACE_SIZE));
}
