import { REFERENCE_INLINE_PX, SURFACE_SIZE } from "../constants";

// Surface-pixel line width for a brush from its inline appearance.
// Independent of the file's stored size: the fixed surface plus
// downsample-on-export makes a stroke render at the same inline px whatever
// the export resolution.
export function surfaceLineWidth(inlinePx: number): number {
  return (inlinePx * SURFACE_SIZE) / REFERENCE_INLINE_PX;
}
