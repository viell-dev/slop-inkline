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
  symbolAtAddress,
  symbolDoubleClicked,
  symbolInBlock,
  symbolInRenderedNote,
  symbolOfImage,
  symbolViewerClicked,
  symbolViewerKey,
} from "./notes/entries.ts";
import { SymbolSuggest, type SymbolTexts } from "./notes/suggest.ts";
import {
  editSymbol,
  insertExistingSymbol,
  insertSymbol,
  recoverDrafts,
  type EditorHost,
} from "./notes/symbols.ts";
import { stalledAfter } from "./notes/file-writes.ts";
import { symbolFiles, type SymbolFiles } from "./notes/symbol-files.ts";
import { sweepStaged } from "./notes/symbol-writes.ts";
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
import { markNotice } from "./notices.ts";

/** Inkline: symbols drawn once and written in notes like characters. */
export default class InklinePlugin extends Plugin {
  readonly #editors = new Set<InkEditorModal>();
  /**
   * Shows symbols in notes as characters, in every window, and in the frames
   * of canvas cards' editors, which Inkline also answers in.
   */
  readonly #renderer = new SymbolRenderer(
    Platform.resourcePathPrefix,
    (doc) => {
      this.#offerEditing(doc);
    },
    (src) => this.#readSymbol(src),
  );
  /**
   * What stops Inkline answering right-clicks, double-clicks, and the clicks
   * and keys that would open Obsidian's image viewer, in each document it
   * does.
   */
  readonly #answering = new Map<Document, AbortController>();
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
  /**
   * What this load's writes of symbol files share, as its one line of writes:
   * made once, as {@link SymbolFiles} says, and not by {@link #host}, which
   * makes another object on each call.
   */
  #files: SymbolFiles | undefined;
  /**
   * How long, in milliseconds, a save or a rename goes on before Inkline says
   * that it waits for Obsidian, read as each one starts: file-writes.ts's
   * `stalledAfter`, five seconds, which each load starts from. It is not a
   * setting, and nothing in Inkline changes it. It is public so that the
   * end-to-end tests can shorten it on the running plugin, rather than wait
   * five seconds in each test of what is said then: the modules a test loads
   * for itself are a copy, whose `stalledAfter` the plugin never reads.
   */
  stalledAfter = stalledAfter;
  /**
   * This load of the plugin, which ends as Obsidian unloads it: Obsidian makes
   * a new instance for each load. What Inkline starts that can act later, as
   * from a callback, after an await, or from a dialog, is over once it ends.
   */
  readonly #lifetime = new AbortController();
  #settings: Settings = defaultSettings;
  /** Settings writes finish in order, even when controls change quickly. */
  #savingSettings: Promise<void> = Promise.resolve();

  /** Whether this load of the plugin has yet to end. */
  get #loaded(): boolean {
    return !this.#lifetime.signal.aborted;
  }

  /** Inkline's own folder, the one Obsidian loaded it from. */
  get #folder(): string {
    return (
      this.manifest.dir ??
      `${this.app.vault.configDir}/plugins/${this.manifest.id}`
    );
  }

  /** What this load's writes of symbol files share. */
  get #symbolFiles(): SymbolFiles {
    this.#files ??= symbolFiles(
      this.app,
      this.#folder,
      this.#lifetime.signal,
      (file) => this.#texts.refresh(file),
      () => this.stalledAfter,
    );
    return this.#files;
  }

  /** What the editors this plugin opens may use while it is loaded. */
  get #host(): EditorHost {
    this.#drafts ??= new DraftStore(this.app);
    return {
      ...this.#symbolFiles,
      settings: () => this.#settings,
      drafts: this.#drafts,
      texts: this.#texts,
      lifecycle: {
        opened: (editor) => this.#editors.add(editor),
        closed: (editor) => this.#editors.delete(editor),
      },
    };
  }

  override async onload(): Promise<void> {
    try {
      this.#settings = readSettings(await this.loadData(), brushSizes.length);
    } catch {
      markNotice(
        new Notice(
          "Inkline settings could not be read. Using defaults for this session.",
        ),
      );
    }
    // Obsidian can unload the plugin while its settings are read, and would
    // never undo what this went on to register.
    if (!this.#loaded) return;
    // What a save that made a symbol's file left in Inkline's folder, as when
    // Obsidian closed during it. Saves that start meanwhile keep their own.
    void sweepStaged(this.app.vault, this.#folder);
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
    // The main window's document, which the workspace itself is in: every
    // other window's is watched as it opens, and those already open once the
    // layout is ready. Not `activeDocument`, which is the focused window's and
    // can be a popout's at load.
    const mainDoc = this.app.workspace.containerEl.doc;
    this.#renderer.watch(mainDoc);
    // Obsidian can leave existing embeds pointing at the old resource URL
    // after an image changes. Refresh both their pixels and their ink mask.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && isInkPath(file.path)) {
          this.#renderer.refresh(this.app.vault.getResourcePath(file));
        }
      }),
    );
    // A file made, deleted, or moved is not the one refreshed before at its
    // path, nor at the one it left.
    const forget = (path: string): void => {
      this.#renderer.forget(this.app.vault.adapter.getResourcePath(path));
    };
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        forget(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        forget(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        forget(oldPath);
        forget(file.path);
      }),
    );
    // Markdown also renders in temporary documents, such as the hidden
    // PDF export window, which is not a workspace popout. Obsidian prints an
    // export once what its post-processors return there has resolved: the
    // promise of the symbols' print copies.
    this.registerMarkdownPostProcessor((element) => {
      if (!this.#loaded) return;
      this.#renderer.watch(element.doc);
      if (element.doc === mainDoc) return;
      return this.#renderer.prepareForPrint(element);
    });
    this.#offerEditing(mainDoc);
    this.registerEvent(
      this.app.workspace.on("window-open", (win) => {
        this.#renderer.watch(win.doc);
        this.#offerEditing(win.doc);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (win) => {
        this.#renderer.unwatch(win.doc);
      }),
    );
    // Popout windows open before Inkline was. The callback cannot be taken
    // back, and can come after an unload, which it would undo.
    this.app.workspace.onLayoutReady(() => {
      if (!this.#loaded) return;
      this.app.workspace.iterateAllLeaves((leaf) => {
        this.#renderer.watch(leaf.view.containerEl.doc);
        this.#offerEditing(leaf.view.containerEl.doc);
      });
      this.#indexText();
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
      (leaf) => new SymbolLibraryView(leaf, this.#texts, this.#symbolFiles),
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
            markNotice(new Notice("There are no symbols to insert yet."));
            return true;
          }
          insertExistingSymbol(
            this.app,
            this.#texts,
            view,
            this.#lifetime.signal,
          );
        }
        return true;
      },
    });
    // Drafts that no editor can offer, as their symbol's file is gone or does
    // not open, or a new symbol's note is gone.
    this.addCommand({
      id: "recover-drafts",
      name: "Recover drafts",
      callback: () => {
        void recoverDrafts(this.#host);
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

  /**
   * Reads the symbol file at `src`, the address an image shows it at, for its
   * print copies. The image itself cannot give its pixels: a canvas it is
   * drawn on is tainted in Obsidian 1.15.1, as the vault's addresses are of
   * another origin than the export window's.
   */
  #readSymbol(src: string): Promise<Uint8Array> | undefined {
    const file = symbolAtAddress(this.app, src);
    if (file === undefined) return undefined;
    return this.app.vault
      .readBinary(file)
      .then((bytes) => new Uint8Array(bytes));
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
   * Ends this load, which closes Insert existing symbol's list, and closes
   * every open editor, keeping unsaved strokes as drafts that the editor
   * offers back next time, and stops anything more being written. A save
   * still running then settles its editor's draft as it ends, as the rename
   * that ends it moves the file from the path the draft names.
   */
  override onunload(): void {
    this.#lifetime.abort();
    this.#texts.stop();
    // Symbols show as the plain images they are once Inkline is off.
    this.#renderer.stop();
    for (const stop of this.#answering.values()) stop.abort();
    this.#answering.clear();
    for (const editor of [...this.#editors]) editor.dispose();
  }

  /**
   * Answers a right-click on a symbol in a note, so that every symbol offers
   * Edit symbol. Where Obsidian builds a menu, for the image or for a block
   * around it, that menu takes the item; where it shows none, Inkline shows
   * the symbol's. A double-click that reaches a symbol opens it, as Edit
   * symbol does, and the clicks and keys that would open Obsidian's image
   * viewer on a symbol leave it shut. Once for each document, for as long as
   * it lasts: a canvas card's editor makes a new one each time it opens.
   */
  #offerEditing(doc: Document): void {
    const view = doc.defaultView;
    if (this.#answering.has(doc) || view === null || view.closed) return;
    const stop = new AbortController();
    this.#answering.set(doc, stop);
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
    // Obsidian's image viewer stays shut for a symbol, which is read at the
    // size of the text around it, and so a double-click's second click
    // reaches the symbol. Obsidian opens the viewer for a click whose default
    // is not prevented by then, and the first click on a symbol in Live
    // Preview, which selects it, keeps what Obsidian does. A click on a
    // symbol after the first of a double-click, which opens it in the editor,
    // has its default prevented too, as before, but for one on the sheet a
    // canvas keeps over a card that is not focused, which the canvas answers.
    doc.addEventListener(
      "click",
      (event) => {
        const image = symbolViewerClicked(event) ?? symbolDoubleClicked(event);
        if (
          image !== undefined &&
          image === event.targetNode &&
          symbolOfImage(this.app, image) !== undefined
        ) {
          event.preventDefault();
        }
      },
      { capture: true, signal },
    );
    // Space opens the viewer on the picture Live Preview has selected, and
    // does nothing else there: with a symbol selected, it does nothing.
    doc.addEventListener(
      "keydown",
      (event) => {
        const image = symbolViewerKey(event);
        if (
          image !== undefined &&
          symbolOfImage(this.app, image) !== undefined
        ) {
          event.preventDefault();
        }
      },
      { capture: true, signal },
    );
    // Preventing the double-click also stops a canvas card that is not
    // focused from opening its text for editing.
    doc.addEventListener(
      "dblclick",
      (event) => {
        if (event.defaultPrevented) return;
        const image = symbolDoubleClicked(event);
        const file = image && symbolOfImage(this.app, image);
        if (image === undefined || file === undefined) return;
        event.preventDefault();
        void this.editSymbol(file);
      },
      { capture: true, signal },
    );
    // A canvas card's own editor is a document in a frame, which no workspace
    // event names. The renderer watches it as the frame appears, and calls
    // this for it; the frame also takes the focus as it opens.
    doc.addEventListener(
      "focusin",
      (event) => {
        const frame = event.targetNode;
        if (frame?.instanceOf(HTMLIFrameElement) !== true) return;
        this.#renderer.watchFrame(frame);
      },
      { signal },
    );
    // Both, as Chromium is phasing `unload` out, and a frame left in the map
    // stays in memory until the plugin unloads.
    const forget = (): void => {
      stop.abort();
      this.#answering.delete(doc);
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
      markNotice(
        new Notice(
          "Inkline settings could not be saved. Changes apply for this session.",
        ),
      );
      return false;
    }
  }

  /** Opens the editor for a symbol file; failures show a notice. */
  editSymbol(file: TFile): Promise<void> {
    return editSymbol(this.#host, file);
  }
}
