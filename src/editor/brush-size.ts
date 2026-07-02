import { BRUSH_SIZES } from "../constants";

/**
 * One toolbar brush entry: its button label and how many CSS pixels the
 * stroke occupies inline at the reference display height.
 */
export type BrushSize = (typeof BRUSH_SIZES)[number];
