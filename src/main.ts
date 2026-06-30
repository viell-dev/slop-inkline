import { Editor, EditorPosition, MarkdownFileInfo, Notice, Plugin, TFile } from "obsidian";
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
    const markdown = createMarkdownImage(created.name, created.path);
    const insertStart = editor.getCursor("from");

    editor.replaceSelection(markdown);
    const insertEnd = editor.getCursor();

    if (this.settings.openEditorAfterInsert) {
      this.openEditor(created.file, {
        isNew: true,
        onDiscard: async (file) => {
          this.removeInsertedMarkdown(editor, insertStart, insertEnd, markdown, file.path);
          await this.inkFiles.deleteInkFile(file);
        },
      });
    }

    new Notice(`Created inline ink: ${created.name}`);
  }

  openEditor(
    file: TFile,
    options: {
      isNew?: boolean;
      onDiscard?: (file: TFile) => void | Promise<void>;
    } = {},
  ): void {
    new InkEditorModal(
      this.app,
      this.inkFiles,
      file,
      {
        isNew: options.isNew,
        onDiscard: options.onDiscard,
        onSave: (savedFile) => this.renderEnhancer.refreshFile(savedFile),
      },
    ).open();
  }

  private removeInsertedMarkdown(
    editor: Editor,
    insertStart: EditorPosition,
    insertEnd: EditorPosition,
    insertedMarkdown: string,
    currentPath: string,
  ): void {
    if (editor.getRange(insertStart, insertEnd) === insertedMarkdown) {
      editor.replaceRange("", insertStart, insertEnd);
      return;
    }

    const documentStart = { line: 0, ch: 0 };
    const documentEnd = {
      line: editor.lastLine(),
      ch: editor.getLine(editor.lastLine()).length,
    };
    const documentText = editor.getRange(documentStart, documentEnd);
    const offsets = [
      documentText.indexOf(insertedMarkdown),
      findMarkdownImageOffset(documentText, currentPath),
    ].filter((offset) => offset >= 0);

    const offset = offsets[0];
    if (offset === undefined) {
      return;
    }

    const markdown = offset === documentText.indexOf(insertedMarkdown)
      ? insertedMarkdown
      : matchMarkdownImageAt(documentText, offset) ?? insertedMarkdown;

    editor.replaceRange(
      "",
      editor.offsetToPos(offset),
      editor.offsetToPos(offset + markdown.length),
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

function findMarkdownImageOffset(documentText: string, path: string): number {
  const escapedPath = escapeRegExp(path);
  const pattern = new RegExp(`!\\[[^\\]]*\\]\\((?:<)?${escapedPath}(?:>)?\\)`);
  const match = pattern.exec(documentText);
  return match?.index ?? -1;
}

function matchMarkdownImageAt(documentText: string, offset: number): string | null {
  const match = /^!\[[^\]]*\]\((?:<)?[^)>]+(?:>)?\)/.exec(documentText.slice(offset));
  return match?.[0] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
