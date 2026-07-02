import { IMAGE_SIZE, MAX_IMAGE_SIZE, MIN_IMAGE_SIZE } from "../constants";

/**
 * Round a stored ink resolution and clamp it to the supported range.
 *
 * @param value - The requested resolution, in pixels per side.
 * @returns The nearest whole pixel size within
 *   [{@link MIN_IMAGE_SIZE}, {@link MAX_IMAGE_SIZE}], or the default
 *   {@link IMAGE_SIZE} when `value` is not a finite number.
 */
export function clampImageSize(value: number): number {
  if (!Number.isFinite(value)) {
    return IMAGE_SIZE;
  }

  return Math.min(Math.max(Math.round(value), MIN_IMAGE_SIZE), MAX_IMAGE_SIZE);
}
