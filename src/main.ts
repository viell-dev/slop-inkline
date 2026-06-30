import { Editor, MarkdownFileInfo, Notice, Plugin, TFile } from "obsidian";
import { InkEditorModal } from "./ink-editor-modal";
import { createMarkdownImage, InkFileService } from "./ink-file";
import { RenderEnhancer } from "./render-enhancer";
import { DEFAULT_SETTINGS, InklineSettings, InklineSettingTab } from "./settings";

export default class InklinePlugin extends Plugin {
  settings!: InklineSettings;
  inkFiles!: InkFileService;
  renderEnhancer!: RenderEnhancer;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.inkFiles = new InkFileService(this.app, () => this.settings);
    this.renderEnhancer = new RenderEnhancer(
      this,
      this.inkFiles,
      () => this.settings,
      (file) => this.openEditor(file),
    );
    this.renderEnhancer.register();

    this.addSettingTab(new InklineSettingTab(this.app, this));

    this.addCommand({
      id: "insert-inline-ink",
      name: "Insert inline ink",
      editorCallback: (editor, ctx) => {
        void this.insertInlineInk(editor, ctx);
      },
    });
  }

  async insertInlineInk(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const sourcePath = ctx.file?.path ?? "";
    const name = await this.inkFiles.getNextAutoName(sourcePath);
    const created = await this.inkFiles.createBlankInkFile(
      name,
      this.settings.defaultPreset,
      sourcePath,
    );

    editor.replaceSelection(createMarkdownImage(created.name, created.path));

    if (this.settings.openEditorAfterInsert) {
      this.openEditor(created.file);
    }

    new Notice(`Created inline ink: ${created.name}`);
  }

  openEditor(file: TFile): void {
    new InkEditorModal(
      this.app,
      this.inkFiles,
      file,
      (savedFile) => this.renderEnhancer.refreshFile(savedFile),
    ).open();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
