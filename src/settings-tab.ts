// Inkline's settings tab, built from Obsidian's declarative definitions;
// settings.ts says what each setting may hold.

import {
  PluginSettingTab,
  type App,
  type Plugin,
  type SettingDefinitionItem,
} from "obsidian";
import { buttonLabelNames } from "./editor/buttons.ts";
import { gridCellRange, guideNames, type GuideName } from "./editor/guides.ts";
import { brushSizes } from "./editor/session.ts";
import {
  defaultSettings,
  guideSettings,
  settingKeys,
  symbolFolderProblem,
  triggerProblem,
  type SettingKey,
  type Settings,
} from "./settings.ts";

/** Each of the font's lines, as the settings name it. */
const guideLabels: Readonly<Record<GuideName, string>> = {
  ascender: "Ascender line",
  "cap height": "Cap height line",
  "x-height": "x-height line",
  baseline: "Baseline",
  descender: "Descender line",
};

/** What each line marks, and its colour, as the theme gives it by default. */
const guideDescriptions: Readonly<Record<GuideName, string>> = {
  ascender: "The font's upper extent, purple by default.",
  "cap height": "The top of a capital such as H, blue by default.",
  "x-height": "The top of a lowercase letter such as x, green by default.",
  baseline: "Where letters sit, solid, orange by default.",
  descender: "The font's lower extent, pink by default.",
};

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
        name: "Grid size",
        desc: "How many cells of the editor's grid span the x-height of the note's font; more make a finer grid. The grid's rows also pass through each line turned on under Guides.",
        aliases: ["snap", "cells"],
        control: {
          type: "slider",
          key: "gridCells",
          defaultValue: defaultSettings.gridCells,
          min: gridCellRange.min,
          max: gridCellRange.max,
          step: 1,
          displayFormat: (value) => `${String(value)} cells`,
        },
      },
      {
        name: "Editor buttons",
        desc: "What the editor's buttons show. Icons only keeps the toolbar compact; each button still names itself and its shortcut when pointed at.",
        aliases: ["icons", "toolbar", "labels"],
        control: {
          type: "dropdown",
          key: "buttonLabels",
          defaultValue: defaultSettings.buttonLabels,
          options: { ...buttonLabelNames },
        },
      },
      {
        type: "group",
        heading: "Guides",
        items: [
          {
            name: "Show in a new editor",
            desc: "A new editor shows the lines turned on below to draw on. G shows or hides them there.",
            control: {
              type: "toggle",
              key: "guides",
              defaultValue: defaultSettings.guides,
            },
          },
          ...guideNames.map((guide) => ({
            name: guideLabels[guide],
            desc: guideDescriptions[guide],
            control: {
              type: "toggle" as const,
              key: guideSettings[guide],
              defaultValue: defaultSettings[guideSettings[guide]] === true,
            },
          })),
        ],
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
