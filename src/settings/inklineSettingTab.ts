import { PluginSettingTab } from "obsidian";
import type { App, Plugin } from "obsidian";
import { renderSettingsTab } from "./renderSettingsTab";
import type { SettingsHost } from "./settingsHost";

/**
 * Thin Obsidian interop shell: PluginSettingTab must be subclassed, so this
 * class only forwards to renderSettingsTab.
 */
export class InklineSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: Plugin & SettingsHost,
  ) {
    super(app, host);
  }

  display(): void {
    renderSettingsTab(this.containerEl, this.host);
  }
}
