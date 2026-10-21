import { MarkdownView, Notice, Platform, Plugin, TFile } from "obsidian";
import { DraftStore } from "./editor/drafts.ts";
import type { InkEditorModal } from "./editor/modal.ts";
import { isInkPath } from "./format/ink-file.ts";
import { showSymbolMenu, symbolAt, symbolOfImage } from "./notes/entries.ts";
import { defaultTrigger } from "./notes/search.ts";
import { SymbolSearch, SymbolSuggest } from "./notes/suggest.ts";
import { editSymbol, insertSymbol, type EditorHost } from "./notes/symbols.ts";
import { SymbolRenderer } from "./render/symbols.ts";

/** Inkline: symbols drawn once and written in notes like characters. */
export default class InklinePlugin extends Plugin {
  readonly #editors = new Set<InkEditorModal>();
  /** Shows symbols in notes as characters, in every window. */
  readonly #renderer = new SymbolRenderer(Platform.resourcePathPrefix);
  #drafts: DraftStore | undefined;
  #loaded = false;

  /** What the editors this plugin opens may use while it is loaded. */
  get #host(): EditorHost {
    this.#drafts ??= new DraftStore(this.app);
    return {
      app: this.app,
      drafts: this.#drafts,
      lifecycle: {
        opened: (editor) => this.#editors.add(editor),
        closed: (editor) => this.#editors.delete(editor),
      },
      alive: () => this.#loaded,
    };
  }

  override onload(): void {
    this.#loaded = true;
    this.#renderer.watch(document);
    this.#offerMenus(document);
    this.registerEvent(
      this.app.workspace.on("window-open", (win) => {
        this.#renderer.watch(win.doc);
        this.#offerMenus(win.doc);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (win) => {
        this.#renderer.unwatch(win.doc);
      }),
    );
    // Popout windows open before Inkline was.
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.iterateAllLeaves((leaf) => {
        this.#renderer.watch(leaf.view.containerEl.doc);
      });
    });
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
    this.addCommand({
      id: "edit-symbol-at-cursor",
      // Offered only with the cursor on a symbol embed, which it edits.
      name: "Edit symbol",
      editorCheckCallback: (checking, editor, info) => {
        const note = info.file;
        if (note === null) return false;
        const file = symbolAt(
          this.app,
          editor.getValue(),
          editor.posToOffset(editor.getCursor()),
          note.path,
        );
        if (file === undefined) return false;
        if (!checking) void this.editSymbol(file);
        return true;
      },
    });
    // The editor's own menu, on the text of a symbol's embed.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        const note = info.file;
        if (note === null) return;
        const file = symbolAt(
          this.app,
          editor.getValue(),
          editor.posToOffset(editor.getCursor()),
          note.path,
        );
        if (file === undefined) return;
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
    // A symbol you already have: its name after the trigger, or a list.
    this.registerEditorSuggest(
      new SymbolSuggest(this.app, () => defaultTrigger),
    );
    this.addCommand({
      id: "insert-existing-symbol",
      name: "Insert existing symbol",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || view.getMode() !== "source") return false;
        if (!checking) {
          const { editor } = view;
          if (!this.app.vault.getFiles().some((file) => isInkPath(file.path))) {
            new Notice("There are no symbols to insert yet.");
            return true;
          }
          new SymbolSearch(this.app, view.file.path, (embed) => {
            editor.replaceSelection(embed);
          }).open();
        }
        return true;
      },
    });
    // Drafts follow their symbol, or the note a new one is in, when renamed.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.#drafts ??= new DraftStore(this.app);
        this.#drafts.rename(oldPath, file.path);
      }),
    );
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
    // Symbols show as the plain images they are once Inkline is off.
    this.#renderer.stop();
    for (const editor of [...this.#editors]) editor.dispose();
  }

  /**
   * Shows the menu of a symbol's file where a symbol is right-clicked and
   * nothing else answered, as in Reading view, embedded notes, and hover
   * previews, where Obsidian shows no menu for an image. Where Obsidian
   * shows one, as in Live Preview, its menu holds Edit symbol already.
   */
  #offerMenus(doc: Document): void {
    // A popout window's elements are of its own window's classes.
    const Image = doc.defaultView?.HTMLImageElement ?? HTMLImageElement;
    this.registerDomEvent(doc, "contextmenu", (event) => {
      if (event.defaultPrevented) return;
      const image = event.target;
      if (!(image instanceof Image) || !image.hasClass("inkline-symbol")) {
        return;
      }
      const file = symbolOfImage(this.app, image);
      if (file === undefined) return;
      event.preventDefault();
      showSymbolMenu(this.app, file, event);
    });
  }

  /** Opens the editor for a symbol file; failures show a notice. */
  editSymbol(file: TFile): Promise<void> {
    return editSymbol(this.#host, file);
  }
}
