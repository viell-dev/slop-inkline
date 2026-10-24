// The symbol library: a view of every symbol in the vault, in a sidebar,
// with its picture, name, folder, and the notes that use it, filtered by
// name and folder. A click inserts a symbol at the cursor of the most
// recently active note; its menu is the one Obsidian shows for a link to it,
// with Edit
// symbol among its items. catalog.ts decides what it lists.

import {
  debounce,
  ItemView,
  Keymap,
  MarkdownView,
  Notice,
  type TAbstractFile,
  type TFile,
  type Vault,
} from "obsidian";
import { isInkPath } from "../format/ink-file.ts";
import { embedFor } from "../notes/embeds.ts";
import { showLinkMenu } from "../notes/entries.ts";
import { insertionAt } from "../notes/links.ts";
import { symbolStem } from "../notes/names.ts";
import { textClass } from "../render/symbols.ts";
import {
  catalog,
  filterCatalog,
  foldersOf,
  type CatalogEntry,
} from "./catalog.ts";

/** The library's view type, as Obsidian registers and restores it. */
export const libraryViewType = "inkline-library";

/** The address of `file`'s picture, which changes as the file does. */
function pictureOf(vault: Vault, file: TFile | undefined): string {
  return file === undefined ? "" : vault.getResourcePath(file);
}

/** How a folder is named in the library: the vault's top folder by name. */
function folderLabel(folder: string): string {
  return folder === "" ? "Top folder" : folder;
}

/** How many notes use a symbol, as the library says it. */
function usesLabel(count: number): string {
  if (count === 0) return "Not used";
  return count === 1 ? "1 note" : `${String(count)} notes`;
}

/** A note's path as the library shows it, without `.md`. */
function noteLabel(path: string): string {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}

/** The symbol library, in a sidebar. */
export class SymbolLibraryView extends ItemView {
  /** What the name filter holds. */
  #query = "";
  /** The folder shown, or undefined for every folder. */
  #folder: string | undefined;
  /** The symbols whose notes are listed. */
  readonly #expanded = new Set<string>();
  #folderField: HTMLSelectElement | undefined;
  /** The folders the folder field offers, by the index of their option. */
  #folders: readonly string[] = [];
  #list: HTMLElement | undefined;
  /**
   * What the library last showed, so that a change elsewhere, as an edit to
   * a note that Obsidian's cache then resolves, redraws nothing, and a click
   * on a symbol is not lost to a redraw between its press and its release.
   */
  #shown = "";
  /** Shows the library again, once for a burst of changes. */
  readonly #refresh = debounce(
    () => {
      this.#render();
    },
    100,
    true,
  );

  override getViewType(): string {
    return libraryViewType;
  }

  override getDisplayText(): string {
    return "Symbols";
  }

  override getIcon(): string {
    return "shapes";
  }

  override onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("inkline-library");
    const controls = root.createDiv({ cls: "inkline-library-controls" });
    const search = controls.createEl("input", {
      type: "search",
      cls: "inkline-library-search",
      attr: {
        placeholder: "Filter by name",
        "aria-label": "Filter symbols by name",
        spellcheck: "false",
      },
    });
    // Typing, and the field's own clear button, which some systems show.
    for (const type of ["input", "search"]) {
      search.addEventListener(type, () => {
        if (search.value === this.#query) return;
        this.#query = search.value;
        this.#render();
      });
    }
    const folders = controls.createEl("select", {
      cls: "dropdown inkline-library-folder",
      attr: { "aria-label": "Folder" },
    });
    folders.addEventListener("change", () => {
      this.#folder = this.#folders[Number(folders.value)];
      this.#render();
    });
    this.#folderField = folders;
    // Its pictures are text, as the renderer paints symbols in text.
    this.#list = root.createDiv({
      cls: ["inkline-library-list", textClass],
      attr: { role: "list", "aria-label": "Symbols" },
    });
    const touched = (file: TAbstractFile, oldPath?: string) => {
      if (
        isInkPath(file.path) ||
        (oldPath !== undefined && isInkPath(oldPath))
      ) {
        this.#refresh();
      }
    };
    const { vault, metadataCache } = this.app;
    this.registerEvent(
      vault.on("create", (file) => {
        touched(file);
      }),
    );
    this.registerEvent(
      vault.on("modify", (file) => {
        touched(file);
      }),
    );
    // A note renamed or deleted changes the notes listed too.
    this.registerEvent(vault.on("delete", () => this.#refresh()));
    this.registerEvent(vault.on("rename", () => this.#refresh()));
    this.registerEvent(metadataCache.on("resolved", () => this.#refresh()));
    this.#render();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    this.#refresh.cancel();
    return Promise.resolve();
  }

  /** The vault's symbol files, by path. */
  #files(): Map<string, TFile> {
    return new Map(
      this.app.vault
        .getFiles()
        .filter((file) => isInkPath(file.path))
        .map((file) => [file.path, file]),
    );
  }

  /** The library's entries now. */
  #entries(files: ReadonlyMap<string, TFile>): CatalogEntry[] {
    return catalog(
      [...files.values()].map((file) => ({
        path: file.path,
        name: symbolStem(file.name) ?? file.basename,
        folder:
          file.parent === null || file.parent.isRoot() ? "" : file.parent.path,
      })),
      this.app.metadataCache.resolvedLinks,
    );
  }

  /** Shows the library as the vault holds it now, keeping the focus. */
  #render(): void {
    const list = this.#list;
    const field = this.#folderField;
    if (list === undefined || field === undefined) return;
    const files = this.#files();
    const entries = this.#entries(files);
    const folders = foldersOf(entries);
    this.#folders = folders;
    // A folder that no longer holds symbols shows every folder.
    if (this.#folder !== undefined && !folders.includes(this.#folder)) {
      this.#folder = undefined;
    }
    const shown = filterCatalog(entries, this.#query, this.#folder);
    const key = JSON.stringify([
      folders,
      this.#folder ?? null,
      entries.length,
      shown.map((entry) => [
        entry.path,
        entry.notes,
        this.#expanded.has(entry.path),
        // Its picture's address, which changes as the file does.
        pictureOf(this.app.vault, files.get(entry.path)),
      ]),
    ]);
    if (key === this.#shown) return;
    this.#shown = key;
    field.empty();
    field.createEl("option", { value: "-1", text: "All folders" });
    folders.forEach((folder, index) => {
      field.createEl("option", {
        value: String(index),
        text: folderLabel(folder),
      });
    });
    field.value =
      this.#folder === undefined ? "-1" : String(folders.indexOf(this.#folder));
    const focused = list.doc.activeElement;
    const focusPath =
      focused !== null && list.contains(focused)
        ? focused
            .closest("[data-inkline-path]")
            ?.getAttribute("data-inkline-path")
        : undefined;
    const focusRole = focused?.getAttribute("data-inkline-role");
    const focusNote = focused?.getAttribute("data-inkline-note");
    list.empty();
    if (entries.length === 0) {
      list.createDiv({
        cls: "inkline-library-empty",
        text: "No symbols yet. In a note, Insert symbol draws one.",
      });
      return;
    }
    if (shown.length === 0) {
      list.createDiv({
        cls: "inkline-library-empty",
        text: "No symbol matches.",
      });
      return;
    }
    for (const entry of shown) {
      const file = files.get(entry.path);
      if (file !== undefined) this.#renderEntry(list, entry, file);
    }
    if (focusPath !== undefined && focusPath !== null) {
      const row = Array.from(list.querySelectorAll("[data-inkline-path]")).find(
        (found) => found.getAttribute("data-inkline-path") === focusPath,
      );
      let target =
        focusRole === "note"
          ? Array.from(row?.querySelectorAll("[data-inkline-note]") ?? []).find(
              (note) => note.getAttribute("data-inkline-note") === focusNote,
            )
          : row?.querySelector(
              `[data-inkline-role="${focusRole ?? "insert"}"]`,
            );
      if (
        target === undefined ||
        target === null ||
        (target.instanceOf(HTMLButtonElement) && target.disabled)
      ) {
        target = row?.querySelector('[data-inkline-role="insert"]');
      }
      if (target?.instanceOf(HTMLElement) === true) target.focus();
    }
  }

  /** Shows one symbol: a button that inserts it, and the notes that use it. */
  #renderEntry(list: HTMLElement, entry: CatalogEntry, file: TFile): void {
    const row = list.createDiv({
      cls: "inkline-library-symbol",
      attr: { role: "listitem", "data-inkline-path": entry.path },
    });
    const insert = row.createEl("button", {
      cls: "inkline-library-insert",
      attr: { "data-inkline-role": "insert" },
    });
    // Beside its name, the picture says nothing more to a screen reader.
    insert.createEl("img", {
      cls: "inkline-library-picture",
      attr: {
        src: this.app.vault.getResourcePath(file),
        alt: "",
        "aria-hidden": "true",
      },
    });
    const text = insert.createDiv({ cls: "inkline-library-text" });
    text.createDiv({ cls: "inkline-library-name", text: entry.name });
    if (entry.folder !== "") {
      text.createDiv({
        cls: "inkline-library-folder-name",
        text: entry.folder,
      });
    }
    insert.addEventListener("click", () => {
      this.#insert(file);
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showLinkMenu(this.app, file, this.leaf, event);
    });
    const expanded = this.#expanded.has(entry.path);
    const uses = row.createEl("button", {
      cls: "inkline-library-uses",
      text: usesLabel(entry.notes.length),
      attr: {
        "data-inkline-role": "uses",
        "aria-expanded": String(expanded && entry.notes.length > 0),
      },
    });
    if (entry.notes.length === 0) {
      uses.disabled = true;
      return;
    }
    uses.addEventListener("click", () => {
      if (!this.#expanded.delete(entry.path)) this.#expanded.add(entry.path);
      this.#render();
    });
    if (!expanded) return;
    const notes = row.createEl("ul", { cls: "inkline-library-notes" });
    for (const note of entry.notes) {
      const open = notes.createEl("li").createEl("a", {
        cls: "inkline-library-note",
        text: noteLabel(note),
        href: "#",
        attr: { "data-inkline-role": "note", "data-inkline-note": note },
      });
      open.addEventListener("click", (event) => {
        event.preventDefault();
        const file = this.app.vault.getFileByPath(note);
        if (file === null) {
          new Notice("That note is no longer in the vault.");
          return;
        }
        void this.app.workspace
          .getLeaf(Keymap.isModEvent(event))
          .openFile(file)
          .catch(() => {
            new Notice("The note could not be opened.");
          });
      });
    }
  }

  /**
   * Inserts `file`'s embed at the cursor of the most recently active note, never
   * inside a link or embed, and puts the cursor after it, so that the next
   * symbol clicked follows it. The library keeps the focus.
   */
  #insert(file: TFile): void {
    const name = symbolStem(file.name) ?? file.basename;
    if (this.app.vault.getFileByPath(file.path) !== file) {
      new Notice(`${name} was deleted, so it was not inserted.`);
      return;
    }
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    if (
      !(view instanceof MarkdownView) ||
      view.file === null ||
      view.getMode() !== "source"
    ) {
      new Notice("Open a note in editing view to insert a symbol there.");
      return;
    }
    const { editor } = view;
    const embed = embedFor(this.app, file, view.file.path);
    const text = editor.getValue();
    const place = insertionAt(text, editor.posToOffset(editor.getCursor()));
    const inserted = place.before + embed;
    editor.replaceRange(inserted, editor.offsetToPos(place.at));
    editor.setCursor(editor.offsetToPos(place.at + inserted.length));
  }
}
