import { DEFAULT_DISPLAY_HEIGHT_EM } from "../constants";

/**
 * Parse a display-height setting like "1.5em" into its em number, falling
 * back to the default for non-em, non-positive, or invalid values. The value
 * must stay em-based for the vertical-align math in computeInkLineLayout to
 * hold.
 */
export function parseDisplayHeightEm(displayHeight: string): number {
  const trimmed = displayHeight.trim();
  if (trimmed.endsWith("em")) {
    const value = Number.parseFloat(trimmed);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return DEFAULT_DISPLAY_HEIGHT_EM;
}
