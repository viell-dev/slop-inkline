import type { App } from "obsidian";
import { PluginSettingTab } from "obsidian";
import type { InklinePlugin } from "./inklinePlugin";
import { renderSettingsTab } from "../settings/renderSettingsTab";

/**
 * The plugin's settings tab.
 *
 * @remarks
 * Thin Obsidian interop shell: `PluginSettingTab` must be subclassed, so
 * this class only forwards to `renderSettingsTab`.
 */
export class InklineSettingTab extends PluginSettingTab {
  /** The plugin, exposing its settings and persistence to the tab renderer. */
  private readonly plugin: InklinePlugin;

  /**
   * @param app - The Obsidian app the tab is registered with.
   * @param plugin - The plugin, exposing its settings and persistence to
   *   the tab renderer.
   */
  constructor(app: App, plugin: InklinePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Render the tab's controls into its container element. */
  display(): void {
    renderSettingsTab(this.containerEl, this.plugin);
  }
}
