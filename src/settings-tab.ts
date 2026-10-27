// Inkline's settings tab, built from Obsidian's declarative definitions;
// settings.ts says what each setting may hold.

import {
  PluginSettingTab,
  type App,
  type Plugin,
  type SettingDefinitionItem,
} from "obsidian";
import { brushSizes } from "./editor/session.ts";
import {
  defaultSettings,
  settingKeys,
  symbolFolderProblem,
  triggerProblem,
  type SettingKey,
  type Settings,
} from "./settings.ts";

/** What the tab needs of the plugin: its settings, and a way to change one. */
export interface SettingsHost {
  readonly settings: () => Settings;
  /** Sets and stores one setting; false if it cannot hold `value`. */
  readonly change: (key: SettingKey, value: unknown) => Promise<boolean>;
}

/** Whether `key` names one of Inkline's settings. */
function isSettingKey(key: string): key is SettingKey {
  return settingKeys.some((known) => known === key);
}

/** Inkline's settings, in Obsidian's settings. */
export class InklineSettingTab extends PluginSettingTab {
  readonly #host: SettingsHost;

  constructor(app: App, plugin: Plugin, host: SettingsHost) {
    super(app, plugin);
    this.#host = host;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Symbol size",
        desc: "Height in text, relative to the usual line height. A size written in an embed is kept.",
        control: {
          type: "slider",
          key: "symbolScale",
          defaultValue: defaultSettings.symbolScale,
          min: 50,
          max: 200,
          step: 5,
          displayFormat: (value) => `${String(value)}%`,
        },
      },
      {
        name: "Text colour",
        desc: "Symbols take the colour of the text around them. Off, they keep their stored grey pixels.",
        control: {
          type: "toggle",
          key: "textColor",
          defaultValue: defaultSettings.textColor,
        },
      },
      {
        name: "Insert trigger",
        desc: "Typed in a note, these characters and a few letters of a symbol's name list the symbols to insert.",
        aliases: ["type to insert", "suggest"],
        control: {
          type: "text",
          key: "trigger",
          defaultValue: defaultSettings.trigger,
          placeholder: defaultSettings.trigger,
          validate: (value) => triggerProblem(value),
        },
      },
      {
        name: "Symbol folder",
        desc: "The folder in the vault where new symbols are saved, made when the first one is. Empty puts them where Obsidian puts new attachments.",
        aliases: ["attachment folder", "location"],
        control: {
          type: "text",
          key: "symbolFolder",
          defaultValue: defaultSettings.symbolFolder,
          placeholder: "Same as new attachments",
          validate: (value) => symbolFolderProblem(value),
        },
      },
      {
        name: "Brush size",
        desc: "The starting size for both Pen and Eraser. Next keeps each tool's chosen size.",
        control: {
          type: "dropdown",
          key: "brushSize",
          defaultValue: String(defaultSettings.brushSize),
          options: Object.fromEntries(
            brushSizes.map((size, index) => [String(index), size.label]),
          ),
        },
      },
      {
        name: "Guides",
        desc: "A new editor shows the text's lines to draw on. G shows or hides them there.",
        control: {
          type: "toggle",
          key: "guides",
          defaultValue: defaultSettings.guides,
        },
      },
    ];
  }

  override getControlValue(key: string): unknown {
    if (!isSettingKey(key)) return undefined;
    const value = this.#host.settings()[key];
    // The dropdown holds its choices as text.
    return key === "brushSize" ? String(value) : value;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (!isSettingKey(key)) return;
    await this.#host.change(key, value);
  }
}
