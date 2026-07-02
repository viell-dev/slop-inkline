import { MAX_ZOOM, MIN_ZOOM } from "../constants";

export function clampZoom(value: number): number {
  return Math.min(Math.max(Math.round(value), MIN_ZOOM), MAX_ZOOM);
}
