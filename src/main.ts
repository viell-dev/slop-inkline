import {
  MarkdownView,
  Menu,
  Notice,
  Platform,
  Plugin,
  TFile,
  type TAbstractFile,
} from "obsidian";
import { DraftStore } from "./editor/drafts.ts";
import type { InkEditorModal } from "./editor/modal.ts";
import { isInkPath } from "./format/ink-file.ts";
import { libraryViewType, SymbolLibraryView } from "./library/view.ts";
import {
  MenuChoice,
  showSymbolMenu,
  symbolAt,
  symbolInBlock,
  symbolInRenderedNote,
  symbolOfImage,
} from "./notes/entries.ts";
import { SymbolSuggest, type SymbolTexts } from "./notes/suggest.ts";
import {
  editSymbol,
  insertExistingSymbol,
  insertSymbol,
  type EditorHost,
} from "./notes/symbols.ts";
import { SymbolTextIndex } from "./notes/text-index.ts";
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
  /** What stops Inkline answering right-clicks, in each document it does. */
  readonly #menuDocuments = new Map<Document, AbortController>();
  /** The menus that hold Edit symbol already. */
  readonly #menusWithEdit = new WeakSet<Menu>();
  /** What the vault's symbols say about themselves, for searching. */
  readonly #texts: SymbolTexts = new SymbolTextIndex<TFile>(
    {
      files: () =>
        this.app.vault.getFiles().filter((file) => isInkPath(file.path)),
      size: (file) => file.stat.size,
      read: async (file) =>
        new Uint8Array(await this.app.vault.readBinary(file)),
    },
    () => {
      this.#refreshLibraries();
    },
  );
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
      texts: this.#texts,
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
      if (this.#loaded) this.#indexText();
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
    this.registerView(
      libraryViewType,
      (leaf) => new SymbolLibraryView(leaf, this.#texts),
    );
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
        // A canvas text card's editor has no file of its own: its links lead
        // from the canvas, which is the active file. No other editor without
        // a file has a place to resolve its links from.
        const active = this.app.workspace.getActiveFile();
        const note =
          info.file ?? (active?.extension === "canvas" ? active : null);
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
      new SymbolSuggest(this.app, () => this.#settings.trigger, this.#texts),
    );
    this.addCommand({
      id: "insert-existing-symbol",
      name: "Insert existing symbol",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || view.getMode() !== "source") return false;
        if (!checking) {
          if (!this.app.vault.getFiles().some((file) => isInkPath(file.path))) {
            new Notice("There are no symbols to insert yet.");
            return true;
          }
          insertExistingSymbol(this.app, this.#texts, view);
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
        this.#addEditItem(menu, file);
      }),
    );
  }

  /**
   * Reads what the vault's symbols say about themselves, in the background, and
   * follows the vault from then on. Once the layout is ready, as the vault
   * reports every file as created while it loads.
   */
  #indexText(): void {
    const { vault } = this.app;
    const changed = (file: TAbstractFile): void => {
      if (file instanceof TFile && isInkPath(file.path)) {
        this.#texts.changed(file);
      }
    };
    this.registerEvent(vault.on("create", changed));
    this.registerEvent(vault.on("modify", changed));
    this.registerEvent(
      vault.on("delete", (file) => {
        if (file instanceof TFile) this.#texts.removed(file);
      }),
    );
    // A file keeps its entry through a rename, in one of its folders too,
    // unless it stops or starts being a symbol.
    this.registerEvent(
      vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const now = isInkPath(file.path);
        if (now === isInkPath(oldPath)) return;
        if (now) this.#texts.changed(file);
        else this.#texts.removed(file);
      }),
    );
    this.#texts.start();
  }

  /** Has open libraries show what the index has since read. */
  #refreshLibraries(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(libraryViewType)) {
      if (leaf.view instanceof SymbolLibraryView) leaf.view.refresh();
    }
  }

  /** Puts Edit symbol for `file` in `menu`. */
  #addEditItem(menu: Menu, file: TFile): void {
    this.#menusWithEdit.add(menu);
    const choice = menu.addChild(new MenuChoice(menu));
    menu.addItem((item) =>
      item
        .setTitle("Edit symbol")
        .setIcon("pencil")
        .onClick(() => {
          choice.chosen = true;
          void this.editSymbol(file);
        }),
    );
  }

  /**
   * Closes every open editor, keeping unsaved strokes as drafts that the
   * editor offers back next time, and stops anything more being written.
   */
  override onunload(): void {
    this.#loaded = false;
    this.#texts.stop();
    // Symbols show as the plain images they are once Inkline is off.
    this.#renderer.stop();
    for (const stop of this.#menuDocuments.values()) stop.abort();
    this.#menuDocuments.clear();
    for (const editor of [...this.#editors]) editor.dispose();
  }

  /**
   * Answers a right-click on a symbol in a note, so that every symbol offers
   * Edit symbol. Where Obsidian builds a menu, for the image or for a block
   * around it, that menu takes the item; where it shows none, Inkline shows
   * the symbol's. Once for each document, for as long as it lasts: a canvas
   * card's editor makes a new one each time it opens.
   */
  #offerMenus(doc: Document): void {
    const view = doc.defaultView;
    if (this.#menuDocuments.has(doc) || view === null || view.closed) return;
    const stop = new AbortController();
    this.#menuDocuments.set(doc, stop);
    const { signal } = stop;
    // A rendered note opens Obsidian's image viewer on a right-click unless
    // its default is prevented by then, so Inkline answers a symbol's
    // right-click there before the note sees it. Preventing it also stops a
    // focused canvas card's own menu, which stays on the rest of the card.
    doc.addEventListener(
      "contextmenu",
      (event) => {
        if (event.defaultPrevented) return;
        const image = symbolInRenderedNote(event);
        const file = image && symbolOfImage(this.app, image);
        if (image === undefined || file === undefined) return;
        event.preventDefault();
        showSymbolMenu(this.app, file, image, event);
      },
      { capture: true, signal },
    );
    // Elsewhere Obsidian's own menu comes first: by now the image, callout,
    // table, or canvas card has built it, unless nothing is going to.
    doc.addEventListener(
      "contextmenu",
      (event) => {
        const image = symbolInBlock(event);
        const file = image && symbolOfImage(this.app, image);
        if (image === undefined || file === undefined) return;
        if (!event.defaultPrevented) {
          event.preventDefault();
          showSymbolMenu(this.app, file, image, event);
          return;
        }
        // One menu for each event, shown once the event is over, so that it
        // still takes an item, unless `file-menu` gave it one.
        const menu = Menu.forEvent(event);
        if (!this.#menusWithEdit.has(menu)) this.#addEditItem(menu, file);
      },
      { signal },
    );
    // A canvas card's own editor is a document in a frame, which no workspace
    // event names, and which takes the focus as it opens.
    doc.addEventListener(
      "focusin",
      (event) => {
        const frame = event.targetNode;
        if (frame?.instanceOf(HTMLIFrameElement) !== true) return;
        const inner = frame.contentDocument;
        if (inner === null) return;
        this.#renderer.watch(inner);
        this.#offerMenus(inner);
      },
      { signal },
    );
    // Both, as Chromium is phasing `unload` out, and a frame left in the map
    // stays in memory until the plugin unloads.
    const forget = (): void => {
      stop.abort();
      this.#menuDocuments.delete(doc);
    };
    view.addEventListener("pagehide", forget, { once: true, signal });
    view.addEventListener("unload", forget, { once: true, signal });
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
