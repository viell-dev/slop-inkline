import { Editor, MarkdownFileInfo, Notice, Plugin } from "obsidian";
import { createMarkdownImage, InkFileService } from "./ink-file";
import { promptForInkName } from "./name-modal";
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
      editorCallback: (editor, ctx) => {
        void this.insertInlineInk(editor, ctx);
      },
    });
  }

  async insertInlineInk(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const sourcePath = ctx.file?.path ?? "";
    const defaultName = await this.inkFiles.getNextAutoName(sourcePath);
    const name = await promptForInkName(this.app, defaultName);

    if (!name) {
      return;
    }

    const created = await this.inkFiles.createBlankInkFile(
      name,
      this.settings.defaultPreset,
      sourcePath,
    );

    editor.replaceSelection(createMarkdownImage(created.name, created.path));
    new Notice(`Created inline ink: ${created.name}`);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
