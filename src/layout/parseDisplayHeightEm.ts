import { DEFAULT_DISPLAY_HEIGHT_EM } from "../constants";

/**
 * Parse a display-height setting like "1.5em" into its em number.
 *
 * @remarks
 * Non-em units, non-positive numbers, and invalid values fall back to the
 * default. The value must stay em-based for the vertical-align math in
 * `computeInkLineLayout` to hold.
 *
 * @param displayHeight - The raw setting value.
 * @returns The parsed em number, or {@link DEFAULT_DISPLAY_HEIGHT_EM} on
 *   fallback.
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
