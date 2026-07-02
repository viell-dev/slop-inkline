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

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, ctx) => {
        menu.addItem((item) =>
          item
            .setTitle("Insert ink")
            .setIcon("pen-tool")
            .onClick(() => {
              void this.insertInlineInk(editor, ctx);
            }),
        );

        const file = this.inkFileAtCursor(editor, ctx);
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

  async insertInlineInk(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    this.moveCursorPastEnclosingImage(editor);

    const sourcePath = ctx.file?.path ?? "";
    const name = await this.inkFiles.getNextAutoName(sourcePath);
    const created = await this.inkFiles.createBlankInkFile(name, sourcePath);
    const markdown = createMarkdownImage(created.path);
    const insertStart = editor.getCursor("from");

    editor.replaceSelection(markdown);
    const insertEnd = editor.getCursor();

    this.openEditor(created.file, {
      isNew: true,
      onDiscard: async (file) => {
        this.removeInsertedMarkdown(editor, insertStart, insertEnd, markdown, file.path);
        await this.inkFiles.deleteInkFile(file);
      },
    });

    new Notice(`Created inline ink: ${created.name}`);
  }

  editInlineInkAtCursor(editor: Editor, ctx: MarkdownFileInfo): void {
    const file = this.inkFileAtCursor(editor, ctx);
    if (file) {
      this.openEditor(file);
      return;
    }

    if (this.renderEnhancer.openSelectedInkImage()) {
      return;
    }

    new Notice("No Inkline image at cursor.");
  }

  /**
   * If the cursor sits strictly inside an existing image link, move it to the
   * end of that link so inserting a new ink appends after it instead of
   * splitting the `![](...)` in two. Boundary positions (just before or after
   * the link) and active selections are left untouched.
   */
  private moveCursorPastEnclosingImage(editor: Editor): void {
    if (editor.somethingSelected()) {
      return;
    }

    const cursor = editor.getCursor();
    const token = findImageTokenAtCursor(editor);
    if (token && cursor.ch > token.from && cursor.ch < token.to) {
      editor.setCursor({ line: cursor.line, ch: token.to });
    }
  }

  private inkFileAtCursor(editor: Editor, ctx: MarkdownFileInfo): TFile | null {
    const token = findImageTokenAtCursor(editor);
    if (!token) {
      return null;
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(token.path, ctx.file?.path ?? "");
    if (!file || !this.inkFiles.isInkFile(file)) {
      return null;
    }

    return file;
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
        displayHeight: this.settings.displayHeight,
        pinGuides: this.settings.pinGuides,
        onPinGuidesChange: async (pinned) => {
          this.settings.pinGuides = pinned;
          await this.saveSettings();
        },
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
    this.renderEnhancer.applyRootVariables();
  }
}
