import { Setting } from "obsidian";
import { IMAGE_SIZE, MAX_IMAGE_SIZE, MIN_IMAGE_SIZE } from "../constants";
import { clampImageSize } from "../ink/clampImageSize";
import { DEFAULT_SETTINGS } from "./defaultSettings";
import type { SettingsHost } from "./settingsHost";

/**
 * Render the plugin's settings controls: display height, dark-mode invert,
 * and the advanced image-resolution slider.
 *
 * @remarks
 * Clears the container first, so it is safe to call on every
 * `PluginSettingTab.display`. Every control persists through
 * `host.saveSettings` as it changes.
 *
 * @param containerEl - The settings tab's container element.
 * @param host - The plugin's settings and persistence surface.
 */
export function renderSettingsTab(
  containerEl: HTMLElement,
  host: SettingsHost,
): void {
  containerEl.empty();

  new Setting(containerEl)
    .setName("Display height")
    .setDesc("CSS height for rendered inline ink images.")
    .addText((text) => {
      text
        .setPlaceholder(DEFAULT_SETTINGS.displayHeight)
        .setValue(host.settings.displayHeight)
        .onChange(async (value) => {
          host.settings.displayHeight =
            value.trim() || DEFAULT_SETTINGS.displayHeight;
          await host.saveSettings();
        });
    });

  new Setting(containerEl)
    .setName("Invert in dark mode")
    .setDesc(
      "Display black-on-white source images as light-on-dark in dark themes.",
    )
    .addToggle((toggle) => {
      toggle
        .setValue(host.settings.darkModeInvert)
        .onChange(async (value) => {
          host.settings.darkModeInvert = value;
          await host.saveSettings();
        });
    });

  new Setting(containerEl).setName("Advanced").setHeading();

  new Setting(containerEl)
    .setName("Image resolution")
    .setDesc(
      `Stored pixel size of newly created inks (square). Larger keeps more ` +
        `detail if you ever display inks well above their inline size, at ` +
        `the cost of bigger files and less editor sharpness. Existing inks ` +
        `keep their own size. Most people should leave this at ` +
        `${IMAGE_SIZE}. Range ${MIN_IMAGE_SIZE}–${MAX_IMAGE_SIZE}.`,
    )
    .addSlider((slider) => {
      const value = clampImageSize(host.settings.imageSize);
      host.settings.imageSize = value;

      slider
        .setLimits(MIN_IMAGE_SIZE, MAX_IMAGE_SIZE, 1)
        .setValue(value)
        .setDynamicTooltip()
        .onChange(async (next) => {
          host.settings.imageSize = next;
          await host.saveSettings();
        });
    });
}
