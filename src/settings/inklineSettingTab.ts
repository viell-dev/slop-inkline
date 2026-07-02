import { PluginSettingTab } from "obsidian";
import type { App, Plugin } from "obsidian";
import { renderSettingsTab } from "./renderSettingsTab";
import type { SettingsHost } from "./settingsHost";

/**
 * The plugin's settings tab.
 *
 * @remarks
 * Thin Obsidian interop shell: `PluginSettingTab` must be subclassed, so
 * this class only forwards to `renderSettingsTab`.
 */
export class InklineSettingTab extends PluginSettingTab {
  /**
   * @param app - The Obsidian app the tab is registered with.
   * @param host - The plugin, exposing its settings and persistence to the
   *   tab renderer.
   */
  constructor(
    app: App,
    private readonly host: Plugin & SettingsHost,
  ) {
    super(app, host);
  }

  /** Render the tab's controls into its container element. */
  display(): void {
    renderSettingsTab(this.containerEl, this.host);
  }
}
