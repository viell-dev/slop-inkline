import { Option } from "effect";
import { Plugin, TFile } from "obsidian";
import type { Editor, MarkdownFileInfo } from "obsidian";
import { editInkAtCursor } from "./commands/edit-ink-at-cursor";
import { inkFileAtCursor } from "./commands/ink-file-at-cursor";
import { insertInlineInk } from "./commands/insert-inline-ink";
import { openInkEditor } from "./editor/open-ink-editor";
import { invalidateCapHeightCache } from "./layout/cap-height-ratio";
import { createRenderEnhancer } from "./render/create-render-enhancer";
import type { RenderEnhancer } from "./render/render-enhancer";
import { DEFAULT_SETTINGS } from "./settings/default-settings";
import { InklineSettingTab } from "./settings/inkline-setting-tab";
import type { InklineSettings } from "./settings/inkline-settings";

/**
 * Obsidian interop shell: the Plugin subclass exists because Obsidian
 * requires one. It only wires events, commands, and settings to the
 * functional modules.
 */
export default class InklinePlugin extends Plugin {
  settings!: InklineSettings;
  renderEnhancer!: RenderEnhancer;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.renderEnhancer = createRenderEnhancer({
      plugin: this,
      getSettings: () => this.settings,
      openEditor: (file) => this.openEditor(file),
    });

    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        invalidateCapHeightCache();
        this.renderEnhancer.applyRootVariables();
      }),
    );

    this.addSettingTab(new InklineSettingTab(this.app, this));

    this.addCommand({
      id: "insert-inline-ink",
      name: "Insert inline ink",
      editorCallback: (editor, ctx) => {
        void this.insertInk(editor, ctx);
      },
    });

    this.addCommand({
      id: "edit-inline-ink-at-cursor",
      name: "Edit inline ink at cursor",
      editorCallback: (editor, ctx) => {
        this.editInk(editor, ctx);
      },
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, ctx) => {
        menu.addItem((item) =>
          item
            .setTitle("Insert ink")
            .setIcon("pen-tool")
            .onClick(() => {
              void this.insertInk(editor, ctx);
            }),
        );

        const file = Option.getOrNull(
          inkFileAtCursor(this.app, editor, ctx.file?.path ?? ""),
        );
        if (file) {
          menu.addItem((item) =>
            item
              .setTitle("Edit ink")
              .setIcon("pencil")
              .onClick(() => {
                this.openEditor(file);
              }),
          );
        }
      }),
    );
  }

  private insertInk(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    return insertInlineInk(
      {
        app: this.app,
        imageSize: this.settings.imageSize,
        displayHeight: this.settings.displayHeight,
        onSaved: (file) => this.renderEnhancer.refreshFile(file),
      },
      editor,
      ctx,
    );
  }

  private editInk(editor: Editor, ctx: MarkdownFileInfo): void {
    editInkAtCursor(
      {
        app: this.app,
        openEditor: (file) => this.openEditor(file),
        openSelectedInkImage: () => this.renderEnhancer.openSelectedInkImage(),
      },
      editor,
      ctx,
    );
  }

  private openEditor(file: TFile): void {
    openInkEditor(this.app, file, {
      displayHeight: this.settings.displayHeight,
      pinGuides: this.settings.pinGuides,
      onPinGuidesChange: async (pinned) => {
        this.settings.pinGuides = pinned;
        await this.saveSettings();
      },
      onSave: (savedFile) => this.renderEnhancer.refreshFile(savedFile),
    });
  }

  async loadSettings(): Promise<void> {
    const data: unknown = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(typeof data === "object" && data !== null ? data : {}),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.renderEnhancer.applyRootVariables();
  }
}
