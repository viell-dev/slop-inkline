/** The persisted plugin settings. */
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
  /**
   * Whether the editor's crop and baseline guides stay always visible.
   *
   * @remarks
   * Toggled from the editor toolbar rather than the settings tab.
   */
  pinGuides: boolean;
}
