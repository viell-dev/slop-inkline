import { App, PluginSettingTab, Setting } from "obsidian";
import InklinePlugin from "./main";
import { CanvasPresetId, CANVAS_PRESETS } from "./ink-file";

export interface InklineSettings {
  attachmentSubfolder: string;
  defaultPreset: CanvasPresetId;
  displayHeight: string;
  darkModeInvert: boolean;
  openEditorAfterInsert: boolean;
}

export const DEFAULT_SETTINGS: InklineSettings = {
  attachmentSubfolder: "inkline",
  defaultPreset: "symbol",
  displayHeight: "1.25em",
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
      .setName("Attachment subfolder")
      .setDesc("Folder name used inside Obsidian's configured attachment location.")
      .addText((text) => {
        text
          .setPlaceholder("inkline")
          .setValue(this.plugin.settings.attachmentSubfolder)
          .onChange(async (value) => {
            this.plugin.settings.attachmentSubfolder = value.trim() || DEFAULT_SETTINGS.attachmentSubfolder;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default canvas")
      .setDesc("Canvas size used for new inline ink.")
      .addDropdown((dropdown) => {
        for (const preset of Object.values(CANVAS_PRESETS)) {
          dropdown.addOption(preset.id, `${preset.name} (${preset.width} x ${preset.height})`);
        }

        dropdown
          .setValue(this.plugin.settings.defaultPreset)
          .onChange(async (value) => {
            this.plugin.settings.defaultPreset = value as CanvasPresetId;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Display height")
      .setDesc("CSS height for rendered inline ink images.")
      .addText((text) => {
        text
          .setPlaceholder("1.25em")
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

