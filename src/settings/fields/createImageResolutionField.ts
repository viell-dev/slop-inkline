import { Setting } from "obsidian";
import { IMAGE_SIZE, MAX_IMAGE_SIZE, MIN_IMAGE_SIZE } from "../../constants";
import { clampImageSize } from "../../ink/clampImageSize";
import type { SettingsPlugin } from "../settingsPlugin";

/**
 * Render the "Image resolution" slider field: the stored pixel size of
 * newly created inks.
 *
 * @param containerEl - The settings tab's container element.
 * @param plugin - The plugin's settings and persistence surface.
 */
export function createImageResolutionField(
  containerEl: HTMLElement,
  plugin: SettingsPlugin,
): void {
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
      const value = clampImageSize(plugin.settings.imageSize);
      plugin.settings.imageSize = value;

      slider
        .setLimits(MIN_IMAGE_SIZE, MAX_IMAGE_SIZE, 1)
        .setValue(value)
        .setDynamicTooltip()
        .onChange(async (next) => {
          plugin.settings.imageSize = next;
          await plugin.saveSettings();
        });
    });
}
