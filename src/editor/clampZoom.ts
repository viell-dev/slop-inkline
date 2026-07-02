import { MAX_ZOOM, MIN_ZOOM } from "../constants";

/**
 * Round a zoom level and clamp it to the supported range.
 *
 * @param value - The requested zoom level, in CSS pixels per stored pixel.
 * @returns The nearest whole level within [{@link MIN_ZOOM},
 *   {@link MAX_ZOOM}].
 */
export function clampZoom(value: number): number {
  return Math.min(Math.max(Math.round(value), MIN_ZOOM), MAX_ZOOM);
}
