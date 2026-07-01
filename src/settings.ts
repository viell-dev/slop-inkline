import { App, PluginSettingTab, Setting } from "obsidian";
import { clampImageSize, IMAGE_SIZE, MAX_IMAGE_SIZE, MIN_IMAGE_SIZE } from "./ink-file";
import type InklinePlugin from "./main";

export interface InklineSettings {
  displayHeight: string;
  darkModeInvert: boolean;
  imageSize: number;
}

export const DEFAULT_SETTINGS: InklineSettings = {
  displayHeight: "1.5em",
  darkModeInvert: true,
  imageSize: IMAGE_SIZE,
};

export class InklineSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: InklinePlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Display height")
      .setDesc("CSS height for rendered inline ink images.")
      .addText((text) => {
        text
          .setPlaceholder("1.5em")
          .setValue(this.plugin.settings.displayHeight)
          .onChange(async (value) => {
            this.plugin.settings.displayHeight = value.trim() || DEFAULT_SETTINGS.displayHeight;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Invert in dark mode")
      .setDesc("Display black-on-white source images as light-on-dark in dark themes.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.darkModeInvert)
          .onChange(async (value) => {
            this.plugin.settings.darkModeInvert = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("Advanced").setHeading();

    new Setting(containerEl)
      .setName("Image resolution")
      .setDesc(
        `Stored pixel size of newly created inks (square). Larger keeps more detail if you ever ` +
          `display inks well above their inline size, at the cost of bigger files and less editor ` +
          `sharpness. Existing inks keep their own size. Most people should leave this at ` +
          `${IMAGE_SIZE}. Range ${MIN_IMAGE_SIZE}–${MAX_IMAGE_SIZE}.`,
      )
      .addText((text) => {
        text
          .setPlaceholder(String(IMAGE_SIZE))
          .setValue(String(this.plugin.settings.imageSize))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.imageSize = Number.isFinite(parsed)
              ? clampImageSize(parsed)
              : DEFAULT_SETTINGS.imageSize;
            await this.plugin.saveSettings();
          });
      });
  }
}
