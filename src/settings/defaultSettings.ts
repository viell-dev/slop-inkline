import { DEFAULT_DISPLAY_HEIGHT_EM, IMAGE_SIZE } from "../constants";
import type { InklineSettings } from "./inklineSettings";

export const DEFAULT_SETTINGS: InklineSettings = {
  displayHeight: `${DEFAULT_DISPLAY_HEIGHT_EM}em`,
  darkModeInvert: true,
  imageSize: IMAGE_SIZE,
  pinGuides: false,
};
