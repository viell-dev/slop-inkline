import { MarkdownView, Notice, Platform, Plugin, TFile } from "obsidian";
import { DraftStore } from "./editor/drafts.ts";
import type { InkEditorModal } from "./editor/modal.ts";
import { isInkPath } from "./format/ink-file.ts";
import { libraryViewType, SymbolLibraryView } from "./library/view.ts";
import { showSymbolMenu, symbolAt, symbolOfImage } from "./notes/entries.ts";
import { SymbolSearch, SymbolSuggest } from "./notes/suggest.ts";
import { editSymbol, insertSymbol, type EditorHost } from "./notes/symbols.ts";
import { SymbolRenderer } from "./render/symbols.ts";
import { brushSizes } from "./editor/session.ts";
import { InklineSettingTab } from "./settings-tab.ts";
import {
  defaultSettings,
  readSettings,
  withSetting,
  type SettingKey,
  type Settings,
} from "./settings.ts";

/** Inkline: symbols drawn once and written in notes like characters. */
export default class InklinePlugin extends Plugin {
  readonly #editors = new Set<InkEditorModal>();
  /** Shows symbols in notes as characters, in every window. */
  readonly #renderer = new SymbolRenderer(Platform.resourcePathPrefix);
  /** The documents whose right-clicks on symbols Inkline answers. */
  readonly #menuDocuments = new WeakSet<Document>();
  #drafts: DraftStore | undefined;
  #loaded = false;
  #settings: Settings = defaultSettings;
  /** Settings writes finish in order, even when controls change quickly. */
  #savingSettings: Promise<void> = Promise.resolve();

  /** What the editors this plugin opens may use while it is loaded. */
  get #host(): EditorHost {
    this.#drafts ??= new DraftStore(this.app);
    return {
      app: this.app,
      settings: () => this.#settings,
      drafts: this.#drafts,
      lifecycle: {
        opened: (editor) => this.#editors.add(editor),
        closed: (editor) => this.#editors.delete(editor),
      },
      alive: () => this.#loaded,
    };
  }

  override async onload(): Promise<void> {
    try {
      this.#settings = readSettings(await this.loadData(), brushSizes.length);
    } catch {
      new Notice(
        "Inkline settings could not be read. Using defaults for this session.",
      );
    }
    this.#renderer.configure(
      this.#settings.symbolScale / 100,
      this.#settings.textColor,
    );
    this.addSettingTab(
      new InklineSettingTab(this.app, this, {
        settings: () => this.#settings,
        change: (key, value) => this.#change(key, value),
      }),
    );
    this.#loaded = true;
    this.#renderer.watch(document);
    // Obsidian can leave existing embeds pointing at the old resource URL
    // after an image changes. Refresh both their pixels and their ink mask.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && isInkPath(file.path)) {
          this.#renderer.refresh(this.app.vault.getResourcePath(file));
        }
      }),
    );
    // Markdown also renders in temporary documents, such as the hidden
    // PDF export window, which is not a workspace popout.
    this.registerMarkdownPostProcessor((element) => {
      if (this.#loaded) this.#renderer.watch(element.doc);
    });
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
        this.#offerMenus(leaf.view.containerEl.doc);
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
    this.registerView(libraryViewType, (leaf) => new SymbolLibraryView(leaf));
    this.addCommand({
      id: "show-library",
      name: "Show symbol library",
      callback: () => {
        void this.app.workspace.ensureSideLeaf(libraryViewType, "right", {
          active: true,
        });
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
    // A symbol you already have: its name after the trigger, or a list.
    this.registerEditorSuggest(
      new SymbolSuggest(this.app, () => this.#settings.trigger),
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
    // A symbol file's menu: in the file explorer, on its tab, and wherever
    // Obsidian shows a link's file menu, as in the editor's menu on an
    // embed's text and its image's menu in Live Preview.
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
   * Shows a symbol's menu where a symbol in a note is right-clicked and
   * Obsidian shows no menu for an image: in rendered notes, as in Reading
   * view and embedded notes, and in Live Preview if nothing answered. Where
   * Obsidian shows one, as in Live Preview, its menu holds Edit symbol
   * already. Once for each window's document.
   */
  #offerMenus(doc: Document): void {
    if (this.#menuDocuments.has(doc)) return;
    this.#menuDocuments.add(doc);
    /** Shows the menu if `event` is on a symbol, rendered or not as `inNote`. */
    const offer = (event: MouseEvent, inNote: boolean) => {
      if (event.defaultPrevented) return;
      // Not `instanceof`: a popout window's notes are drawn with the main
      // window's classes, and its own elements have the popout's.
      const image = event.targetNode;
      if (
        image?.instanceOf(HTMLImageElement) !== true ||
        !image.hasClass("inkline-symbol")
      ) {
        return;
      }
      // In a note only, not in a list of symbols, as type to insert shows.
      const note = image.closest(
        ".markdown-preview-view, .markdown-source-view",
      );
      if (note?.hasClass("markdown-preview-view") !== inNote) return;
      const file = symbolOfImage(this.app, image);
      if (file === undefined) return;
      event.preventDefault();
      showSymbolMenu(this.app, file, image, event);
    };
    // A rendered note opens Obsidian's image viewer on a right-click unless
    // its default is prevented by then, so Inkline answers a symbol's
    // right-click there before the note sees it.
    const capture = { capture: true };
    this.registerDomEvent(
      doc,
      "contextmenu",
      (event) => {
        offer(event, true);
      },
      capture,
    );
    // Elsewhere Obsidian's own menu for an image comes first.
    this.registerDomEvent(doc, "contextmenu", (event) => {
      offer(event, false);
    });
  }

  /** Sets and stores one setting; false if it cannot hold `value`. */
  async #change(key: SettingKey, value: unknown): Promise<boolean> {
    const changed = withSetting(this.#settings, key, value, brushSizes.length);
    if (changed === undefined) return false;
    this.#settings = changed;
    this.#renderer.configure(changed.symbolScale / 100, changed.textColor);
    const save = this.#savingSettings.then(() => this.saveData(changed));
    // A failure is announced below, and must not block the next write.
    this.#savingSettings = save.catch(() => undefined);
    try {
      await save;
      return true;
    } catch {
      new Notice(
        "Inkline settings could not be saved. Changes apply for this session.",
      );
      return false;
    }
  }

  /** Opens the editor for a symbol file; failures show a notice. */
  editSymbol(file: TFile): Promise<void> {
    return editSymbol(this.#host, file);
  }
}
