import { Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "../defaultSettings";
import type { SettingsPlugin } from "../settingsPlugin";

/**
 * Render the "Display height" text field: the CSS height rendered inline
 * ink images display at.
 *
 * @param containerEl - The settings tab's container element.
 * @param plugin - The plugin's settings and persistence surface.
 */
export function createDisplayHeightField(
  containerEl: HTMLElement,
  plugin: SettingsPlugin,
): void {
  new Setting(containerEl)
    .setName("Display height")
    .setDesc("CSS height for rendered inline ink images.")
    .addText((text) => {
      text
        .setPlaceholder(DEFAULT_SETTINGS.displayHeight)
        .setValue(plugin.settings.displayHeight)
        .onChange(async (value) => {
          plugin.settings.displayHeight =
            value.trim() || DEFAULT_SETTINGS.displayHeight;
          await plugin.saveSettings();
        });
    });
}
