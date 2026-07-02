import { DEFAULT_DISPLAY_HEIGHT_EM, IMAGE_SIZE } from "../constants";
import type { InklineSettings } from "./inklineSettings";

/**
 * The settings a fresh install starts from; persisted data is merged over
 * these on load, so every field always has a value.
 */
export const DEFAULT_SETTINGS: InklineSettings = {
  displayHeight: `${DEFAULT_DISPLAY_HEIGHT_EM}em`,
  darkModeInvert: true,
  imageSize: IMAGE_SIZE,
  pinGuides: false,
};
