import { Setting } from "obsidian";
import type { SettingsPlugin } from "../settingsPlugin";

/**
 * Render the "Invert in dark mode" toggle field: whether black-on-white
 * source images display as light-on-dark in dark themes.
 *
 * @param containerEl - The settings tab's container element.
 * @param plugin - The plugin's settings and persistence surface.
 */
export function createDarkModeInvertField(
  containerEl: HTMLElement,
  plugin: SettingsPlugin,
): void {
  new Setting(containerEl)
    .setName("Invert in dark mode")
    .setDesc(
      "Display black-on-white source images as light-on-dark in dark themes.",
    )
    .addToggle((toggle) => {
      toggle
        .setValue(plugin.settings.darkModeInvert)
        .onChange(async (value) => {
          plugin.settings.darkModeInvert = value;
          await plugin.saveSettings();
        });
    });
}
