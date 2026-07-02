import type { InklineSettings } from "./inklineSettings";

/**
 * The slice of the plugin the settings tab needs, keeping the tab renderer
 * decoupled from the plugin class.
 */
export interface SettingsHost {
  /** The live settings object; the tab mutates it in place. */
  settings: InklineSettings;
  /**
   * Persist the current settings.
   *
   * @returns A promise that resolves once the settings are saved.
   */
  saveSettings(): Promise<void>;
}
