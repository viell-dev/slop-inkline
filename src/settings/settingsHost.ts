import type { InklineSettings } from "./inklineSettings";

/**
 * The slice of the plugin the settings tab needs: the mutable settings
 * object and a way to persist it. Keeps the tab renderer decoupled from the
 * plugin class.
 */
export interface SettingsHost {
  settings: InklineSettings;
  saveSettings(): Promise<void>;
}
