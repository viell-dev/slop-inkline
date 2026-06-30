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
    const created = await this.inkFiles.createBlankInkFile(
      name,
      this.settings.defaultPreset,
      sourcePath,
    );
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
      new Notice("No image link at cursor.");
      return;
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(token.path, sourcePath);
    if (!file || !this.inkFiles.isInkFile(file)) {
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

interface ImageToken {
  path: string;
  from: number;
  to: number;
}

function findImageTokenAtCursor(editor: Editor): ImageToken | null {
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  const cursorCh = cursor.ch;
  const tokens = [
    ...findMarkdownImageTokens(line),
    ...findWikiImageTokens(line),
  ];

  return tokens.find((token) => token.from <= cursorCh && cursorCh <= token.to) ?? null;
}

function findMarkdownImageTokens(line: string): ImageToken[] {
  const tokens: ImageToken[] = [];
  const pattern = /!\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    const destination = match[1];
    tokens.push({
      path: cleanMarkdownDestination(destination),
      from: match.index,
      to: match.index + match[0].length,
    });
  }

  return tokens;
}

function findWikiImageTokens(line: string): ImageToken[] {
  const tokens: ImageToken[] = [];
  const pattern = /!\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    tokens.push({
      path: match[1].split("|", 1)[0].split("#", 1)[0].trim(),
      from: match.index,
      to: match.index + match[0].length,
    });
  }

  return tokens;
}

function cleanMarkdownDestination(destination: string): string {
  const trimmed = destination.trim();
  const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;

  return decodeURI(unwrapped.split("#", 1)[0]);
}
