/**
 * Persisted plugin state that behaves like a setting but isn't exposed on
 * the settings tab.
 */
export interface InklineHiddenSettings {
  /**
   * Whether the editor's crop and baseline guides stay always visible.
   *
   * @remarks
   * Toggled from the editor toolbar rather than the settings tab.
   */
  pinGuides: boolean;
}
