import { App, PluginSettingTab, Setting } from "obsidian";
import type InklinePlugin from "./main";

export interface InklineSettings {
  displayHeight: string;
  darkModeInvert: boolean;
  openEditorAfterInsert: boolean;
}

export const DEFAULT_SETTINGS: InklineSettings = {
  displayHeight: "1.5em",
  darkModeInvert: true,
  openEditorAfterInsert: true,
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

    new Setting(containerEl)
      .setName("Open editor after insert")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.openEditorAfterInsert)
          .onChange(async (value) => {
            this.plugin.settings.openEditorAfterInsert = value;
            await this.plugin.saveSettings();
          });
      });
  }
}
