import { Option } from "effect";
import type { Editor, MarkdownFileInfo } from "obsidian";
import { Plugin, TFile } from "obsidian";
import { editInkAtCursor } from "../commands/editInkAtCursor";
import { inkFileAtCursor } from "../commands/inkFileAtCursor";
import { insertInlineInk } from "../commands/insertInlineInk";
import { openInkEditor } from "../editor/openInkEditor";
import { invalidateCapHeightCache } from "../layout/capHeightRatio";
import { applyRootVariables } from "../render/applyRootVariables";
import { createRenderEnhancer } from "../render/createRenderEnhancer";
import type { RenderEnhancer } from "../render/renderEnhancer";
import { DEFAULT_SETTINGS } from "../settings/defaultSettings";
import type { InklineHiddenSettings } from "../settings/inklineHiddenSettings";
import type { InklineSettings } from "../settings/inklineSettings";
import { InklineSettingTab } from "./inklineSettingTab";

/**
 * The Obsidian `Plugin` subclass that hosts Inkline.
 *
 * @remarks
 * Thin interop shell: Obsidian requires a `Plugin` subclass, so this class
 * only wires the functional modules to the app. On load it registers the
 * insert/edit commands, the "Insert ink" / "Edit ink" editor context-menu
 * items, the settings tab, the render enhancer, and the `css-change`
 * listener that keeps ink alignment in sync with theme and font changes.
 * All behavior lives in the imported modules.
 */
export class InklinePlugin extends Plugin {
  /**
   * The live plugin settings.
   *
   * @remarks
   * Populated by {@link InklinePlugin.loadSettings} before anything reads
   * it. Mutated in place (by the settings tab and the editor's pin toggle)
   * and persisted through {@link InklinePlugin.saveSettings}.
   */
  settings!: InklineSettings & InklineHiddenSettings;

  /**
   * The rendered-embed surface: refreshes saved inks and resolves the
   * currently selected ink image.
   *
   * @remarks
   * Created during {@link InklinePlugin.onload}.
   */
  renderEnhancer!: RenderEnhancer;

  /**
   * Load settings, then register every Inkline surface with Obsidian:
   * the render enhancer, the `css-change` cap-height invalidation, the
   * settings tab, the two editor commands, and the editor context-menu
   * items.
   */
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
        applyRootVariables(this.app, this.settings);
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

  /**
   * Run the "Insert inline ink" command flow with the current settings.
   *
   * @param editor - The active Markdown editor the embed is inserted into.
   * @param ctx - The file context of that editor.
   * @returns A promise that resolves once the ink editor has been opened.
   */
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

  /**
   * Run the "Edit inline ink at cursor" command flow.
   *
   * @param editor - The active Markdown editor whose cursor is inspected.
   * @param ctx - The file context of that editor.
   */
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

  /**
   * Open the ink editor modal for an existing ink file, wired to the
   * current settings and to preview refreshing on save.
   *
   * @param file - The `.ink.png` vault file to edit.
   */
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

  /**
   * Load persisted plugin data and merge it over the defaults into
   * {@link InklinePlugin.settings}.
   *
   * @remarks
   * Non-object or missing data falls back to the defaults, so a fresh
   * install and corrupt data both yield a complete settings object.
   */
  async loadSettings(): Promise<void> {
    // Load and appropriately type settings.
    const maybeData: unknown = await this.loadData();
    const data = (
      typeof maybeData === "object" && maybeData !== null ? maybeData : {}
    ) as Partial<typeof this.settings>;

    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  /**
   * Persist the current settings and re-publish the display CSS variables
   * so every open window reflects the change immediately.
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    applyRootVariables(this.app, this.settings);
  }
}
