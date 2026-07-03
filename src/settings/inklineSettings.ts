/** The user-visible plugin settings, editable from the settings tab. */
export interface InklineSettings {
  /** CSS height rendered inline ink images display at (e.g. "1.5em"). */
  displayHeight: string;
  /**
   * Whether black-on-white source images display as light-on-dark in dark
   * themes.
   */
  darkModeInvert: boolean;
  /** Stored pixel size of newly created inks (square side length). */
  imageSize: number;
}
