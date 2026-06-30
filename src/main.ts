import { Editor, EditorPosition, MarkdownFileInfo, Notice, Plugin, TFile } from "obsidian";
import { InkEditorModal } from "./ink-editor-modal";
import { InkFileService } from "./ink-file";
import { createMarkdownImage, findImageTokenAtCursor, locateInsertedImage } from "./markdown-image";
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

    this.addCommand({
      id: "edit-inline-ink-at-cursor",
      name: "Edit inline ink at cursor",
      editorCallback: (editor, ctx) => {
        this.editInlineInkAtCursor(editor, ctx);
      },
    });
  }

  async insertInlineInk(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const sourcePath = ctx.file?.path ?? "";
    const name = await this.inkFiles.getNextAutoName(sourcePath);
    const created = await this.inkFiles.createBlankInkFile(name, sourcePath);
    const markdown = createMarkdownImage(created.path);
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

  editInlineInkAtCursor(editor: Editor, ctx: MarkdownFileInfo): void {
    const sourcePath = ctx.file?.path ?? "";
    const token = findImageTokenAtCursor(editor);

    if (!token) {
      if (this.renderEnhancer.openSelectedInkImage()) {
        return;
      }

      new Notice("No image link at cursor.");
      return;
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(token.path, sourcePath);
    if (!file || !this.inkFiles.isInkFile(file)) {
      if (this.renderEnhancer.openSelectedInkImage()) {
        return;
      }

      new Notice("No Inkline image at cursor.");
      return;
    }

    this.openEditor(file);
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

    const documentEnd = {
      line: editor.lastLine(),
      ch: editor.getLine(editor.lastLine()).length,
    };
    const documentText = editor.getRange({ line: 0, ch: 0 }, documentEnd);
    const match = locateInsertedImage(documentText, insertedMarkdown, currentPath);
    if (!match) {
      return;
    }

    editor.replaceRange(
      "",
      editor.offsetToPos(match.offset),
      editor.offsetToPos(match.offset + match.length),
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
