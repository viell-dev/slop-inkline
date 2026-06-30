import { Notice, Plugin } from "obsidian";
import { InkFileService } from "./ink-file";
import { DEFAULT_SETTINGS, InklineSettings, InklineSettingTab } from "./settings";

export default class InklinePlugin extends Plugin {
  settings!: InklineSettings;
  inkFiles!: InkFileService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.inkFiles = new InkFileService(this.app, () => this.settings);
    this.addSettingTab(new InklineSettingTab(this.app, this));

    this.addCommand({
      id: "insert-inline-ink",
      name: "Insert inline ink",
      callback: () => {
        new Notice("Inkline is installed. Drawing tools are coming next.");
      },
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
