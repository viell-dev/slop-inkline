import { MarkdownView, Plugin, TFile } from "obsidian";
import type { InkEditorModal } from "./editor/modal.ts";
import { isInkPath } from "./format/ink-file.ts";
import { editSymbol, insertSymbol, type EditorHost } from "./notes/symbols.ts";

/** Inkline: symbols drawn once and written in notes like characters. */
export default class InklinePlugin extends Plugin {
  readonly #editors = new Set<InkEditorModal>();
  #loaded = false;

  /** What the editors this plugin opens may use while it is loaded. */
  get #host(): EditorHost {
    return {
      app: this.app,
      lifecycle: {
        opened: (editor) => this.#editors.add(editor),
        closed: (editor) => this.#editors.delete(editor),
      },
      alive: () => this.#loaded,
    };
  }

  override onload(): void {
    this.#loaded = true;
    this.addCommand({
      id: "insert-symbol",
      name: "Insert symbol",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        // Only where there is a cursor to insert at: not in Reading view.
        if (!view?.file || view.getMode() !== "source") return false;
        if (!checking) insertSymbol(this.#host, view);
        return true;
      },
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || !isInkPath(file.path)) return;
        menu.addItem((item) =>
          item
            .setTitle("Edit symbol")
            .setIcon("pencil")
            .onClick(() => {
              void this.editSymbol(file);
            }),
        );
      }),
    );
  }

  /**
   * Closes every open editor, keeping unsaved strokes as drafts that the
   * editor offers back next time, and stops anything more being written.
   */
  override onunload(): void {
    this.#loaded = false;
    for (const editor of [...this.#editors]) editor.dispose();
  }

  /** Opens the editor for a symbol file; failures show a notice. */
  editSymbol(file: TFile): Promise<void> {
    return editSymbol(this.#host, file);
  }
}
