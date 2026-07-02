import { IMAGE_SIZE, MAX_IMAGE_SIZE, MIN_IMAGE_SIZE } from "../constants";

/** Round a stored ink resolution and clamp it to the supported range. */
export function clampImageSize(value: number): number {
  if (!Number.isFinite(value)) {
    return IMAGE_SIZE;
  }

  return Math.min(Math.max(Math.round(value), MIN_IMAGE_SIZE), MAX_IMAGE_SIZE);
}
