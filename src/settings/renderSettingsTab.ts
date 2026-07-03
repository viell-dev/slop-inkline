import { Setting } from "obsidian";
import { createDarkModeInvertField } from "./fields/createDarkModeInvertField";
import { createDisplayHeightField } from "./fields/createDisplayHeightField";
import { createImageResolutionField } from "./fields/createImageResolutionField";
import type { SettingsPlugin } from "./settingsPlugin";

/**
 * Render the plugin's settings controls: display height, dark-mode invert,
 * and the advanced image-resolution slider.
 *
 * @remarks
 * Clears the container first, so it is safe to call on every
 * `PluginSettingTab.display`. Every control persists through
 * `plugin.saveSettings` as it changes.
 *
 * @param containerEl - The settings tab's container element.
 * @param plugin - The plugin's settings and persistence surface.
 */
export function renderSettingsTab(
  containerEl: HTMLElement,
  plugin: SettingsPlugin,
): void {
  containerEl.empty();

  createDisplayHeightField(containerEl, plugin);
  createDarkModeInvertField(containerEl, plugin);

  new Setting(containerEl).setName("Advanced").setHeading();

  createImageResolutionField(containerEl, plugin);
}
