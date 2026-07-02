import { PluginSettingTab } from "obsidian";
import type { App, Plugin } from "obsidian";
import { renderSettingsTab } from "./render-settings-tab";
import type { SettingsHost } from "./settings-host";

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
