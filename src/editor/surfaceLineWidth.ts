import { REFERENCE_INLINE_PX, SURFACE_SIZE } from "../constants";

/**
 * Convert a brush's inline appearance into a surface-pixel line width.
 *
 * @remarks
 * Independent of the file's stored size: the fixed surface plus
 * downsample-on-export makes a stroke render at the same inline pixels
 * whatever the export resolution.
 *
 * @param inlinePx - CSS pixels the stroke occupies inline at the reference
 *   display height.
 * @returns The line width to draw with on the fixed surface, in pixels.
 */
export function surfaceLineWidth(inlinePx: number): number {
  return (inlinePx * SURFACE_SIZE) / REFERENCE_INLINE_PX;
}
