import type { InklineSettings } from "./inklineSettings";

/**
 * The plugin as the settings tab sees it: only the user-visible settings
 * and their persistence, keeping the tab renderer decoupled from the
 * plugin class.
 */
export interface SettingsPlugin {
  /** The live settings object; the tab mutates it in place. */
  settings: InklineSettings;
  /**
   * Persist the current settings.
   *
   * @returns A promise that resolves once the settings are saved.
   */
  saveSettings(): Promise<void>;
}
