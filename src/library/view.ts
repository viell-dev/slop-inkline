// The symbol library: a view of every symbol in the vault, in a sidebar,
// with its picture, name, folder, readings, translations, and the notes that
// use it, filtered by name, by what it says about itself, and by folder. A
// click inserts a symbol at the cursor of the most recently active note; its
// menu is the one Obsidian shows for a link to it, with Edit symbol among its
// items. Quick edit changes its name, readings, and translations in its row.
// catalog.ts decides what it lists.

import {
  debounce,
  ItemView,
  Keymap,
  MarkdownView,
  Notice,
  Scope,
  setIcon,
  setTooltip,
  type TAbstractFile,
  type TFile,
  type Vault,
  type WorkspaceLeaf,
} from "obsidian";
import { isInkPath } from "../format/ink-file.ts";
import { embedFor } from "../notes/embeds.ts";
import { showLinkMenu } from "../notes/entries.ts";
import {
  renameWaits,
  savingWaits,
  TextMoved,
  watchSave,
} from "../notes/file-writes.ts";
import { writeAt } from "../notes/insertion.ts";
import { insertionAt } from "../notes/links.ts";
import { symbolStem } from "../notes/names.ts";
import type { SymbolTexts } from "../notes/suggest.ts";
import {
  checkRename,
  readSymbolText,
  RenameDisturbed,
  renameSymbol,
  writeSymbolText,
} from "../notes/symbols.ts";
import {
  isBlank,
  noText,
  showValues,
  TextFields,
  textFields,
} from "../notes/text-fields.ts";
import { textClass } from "../render/symbols.ts";
import {
  catalog,
  filterCatalog,
  foldersOf,
  type CatalogEntry,
} from "./catalog.ts";

/** The library's view type, as Obsidian registers and restores it. */
export const libraryViewType = "inkline-library";

/**
 * The most rows drawn at a time. A row takes a millisecond or more to draw,
 * with its picture, so a list of them all would keep a person typing in the
 * filter waiting for seconds in a vault of thousands of symbols.
 */
const rowsAtOnce = 100;

/** What a person can do about a save in the fields that has waited that long. */
const savingLeft =
  "If nothing changes, copy what you typed and restart Obsidian. Cancel closes this, and stops the save if it still can.";

/** What a person can do about a rename that has stopped that long. */
const renameLeft =
  "If nothing changes, copy the name you typed and restart Obsidian. Cancel closes this, and stops the rename if it still can.";

/**
 * Whether a modal is open where `element` is, or where Obsidian opens one now.
 * Obsidian's question about links has nothing public to tell it by, but under
 * any modal a person cannot reach `element`, so nothing there is stuck on them.
 */
function modalOpen(element: HTMLElement): boolean {
  return [element.doc, activeDocument].some(
    (doc) => doc.querySelector(".modal-container") !== null,
  );
}

/** The address of `file`'s picture, which changes as the file does. */
function pictureOf(vault: Vault, file: TFile | undefined): string {
  return file === undefined ? "" : vault.getResourcePath(file);
}

/** How a folder is named in the library: the vault's top folder by name. */
function folderLabel(folder: string): string {
  return folder === "" ? "Top folder" : folder;
}

/** How many notes use a symbol, as its button in the library says it. */
function usesLabel(count: number): string {
  return `Uses (${String(count)})`;
}

/** A note's path as the library shows it, without `.md`. */
function noteLabel(path: string): string {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}

/** A failure's message, or `otherwise` for one that is not an error. */
function reasonOf(failure: unknown, otherwise: string): string {
  return failure instanceof Error ? failure.message : otherwise;
}

/** How many ids {@link newId} has given, so that each is new to its window. */
let ids = 0;

/** An id for an element of the library, which no other element has. */
function newId(what: string): string {
  ids += 1;
  return `inkline-library-${what}-${String(ids)}`;
}

/**
 * Names `element`, for a screen reader, with `text` in a hidden element of
 * `parent` that it points to. Obsidian shows an element's `aria-label` as a
 * tooltip wherever the pointer rests over it, even over empty space, which a
 * list or a form is mostly made of, and it shows nothing for this.
 */
function nameFor(
  element: HTMLElement,
  parent: HTMLElement,
  text: string,
): HTMLElement {
  const name = parent.createSpan({
    text,
    attr: { id: newId("name"), hidden: "" },
  });
  element.setAttribute("aria-labelledby", name.id);
  return name;
}

/** The row being edited in Quick edit. */
interface EditPanel {
  readonly file: TFile;
  /** Reads the file again, after the vault says it changed or went. */
  readonly reread: () => void;
  /** Follows a new name the file was given, after the vault says so. */
  readonly renamed: () => void;
  /** Lets go of what the row took while it was edited. */
  readonly release: () => void;
}

/** The symbol library, in a sidebar. */
export class SymbolLibraryView extends ItemView {
  readonly #texts: SymbolTexts;
  /**
   * Aborts as Inkline unloads. Obsidian closes the library then, and a save or
   * rename still waiting writes nothing.
   */
  readonly #unloaded: AbortSignal;
  /** What the filter holds. */
  #query = "";
  /** The folder shown, or undefined for every folder. */
  #folder: string | undefined;
  /** How many rows to draw, which Show more adds to. */
  #rows = rowsAtOnce;
  /** The symbols whose notes are listed. */
  readonly #expanded = new Set<string>();
  #folderField: HTMLSelectElement | undefined;
  #searchField: HTMLInputElement | undefined;
  /**
   * The field being typed in, in the one row being edited, which keeps what is
   * typed and the caret intact while vault updates arrive.
   */
  #editing: HTMLElement | undefined;
  #panel: EditPanel | undefined;
  /** The folders the folder field offers, by the index of their option. */
  #folders: readonly string[] = [];
  #list: HTMLElement | undefined;
  /** Says that a filter may be missing symbols the index has not read yet. */
  #status: HTMLElement | undefined;
  /**
   * What the library last showed, so that a change elsewhere, as an edit to
   * a note that Obsidian's cache then resolves, redraws nothing.
   */
  #shown = "";
  /** Whether a press on the list has yet to end, which holds off redrawing. */
  #pressed = false;
  /** Shows the library again, once for a burst of changes. */
  readonly #refresh = debounce(
    () => {
      this.#render();
    },
    100,
    true,
  );

  constructor(leaf: WorkspaceLeaf, texts: SymbolTexts, unloaded: AbortSignal) {
    super(leaf);
    this.#texts = texts;
    this.#unloaded = unloaded;
  }

  /** Shows what changed, such as text the index has read since. */
  refresh(): void {
    this.#refresh();
  }

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
    this.#shown = "";
    const root = this.contentEl;
    root.empty();
    root.addClass("inkline-library");
    const controls = root.createDiv({ cls: "inkline-library-controls" });
    const search = controls.createEl("input", {
      type: "search",
      cls: "inkline-library-search",
      attr: {
        placeholder: "Filter symbols",
        "aria-label": "Filter symbols by name, reading, or translation",
        spellcheck: "false",
      },
    });
    // Typing, and the field's own clear button, which some systems show.
    for (const type of ["input", "search"]) {
      search.addEventListener(type, () => {
        if (search.value === this.#query) return;
        this.#query = search.value;
        this.#rows = rowsAtOnce;
        this.#render();
      });
    }
    const folders = controls.createEl("select", {
      cls: "dropdown inkline-library-folder",
      attr: { "aria-label": "Folder" },
    });
    folders.addEventListener("change", () => {
      this.#folder = this.#folders[Number(folders.value)];
      this.#rows = rowsAtOnce;
      this.#render();
    });
    this.#folderField = folders;
    this.#searchField = search;
    this.#status = root.createDiv({
      cls: "inkline-library-status",
      text: "Still reading symbols, so more may match.",
    });
    this.#status.hide();
    // Its pictures are text, as the renderer paints symbols in text.
    const list = root.createDiv({
      cls: ["inkline-library-list", textClass],
      attr: { role: "list" },
    });
    nameFor(list, root, "Symbols");
    list.addEventListener("pointerdown", (event) => {
      if (event.button === 0) this.#holdForPress(list.win);
    });
    list.addEventListener("keydown", (event) => {
      if (event.key === " " && !event.repeat) this.#holdForSpace(list.win);
    });
    this.#list = list;
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
        if (file === this.#panel?.file) this.#panel.reread();
      }),
    );
    // A note renamed or deleted changes the notes listed too.
    this.registerEvent(
      vault.on("delete", (file) => {
        this.#refresh();
        if (file === this.#panel?.file) this.#panel.reread();
      }),
    );
    this.registerEvent(
      vault.on("rename", (file) => {
        this.#refresh();
        if (file === this.#panel?.file) this.#panel.renamed();
      }),
    );
    this.registerEvent(metadataCache.on("resolved", () => this.#refresh()));
    this.#render();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    this.#refresh.cancel();
    this.#editing = undefined;
    this.#panel?.release();
    this.#panel = undefined;
    this.#searchField = undefined;
    this.#folderField = undefined;
    this.#status = undefined;
    this.#list = undefined;
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
      [...files.values()].map((file) => {
        const text = this.#texts.textOf(file);
        return {
          path: file.path,
          name: symbolStem(file.name) ?? file.basename,
          folder:
            file.parent === null || file.parent.isRoot()
              ? ""
              : file.parent.path,
          ...(text === undefined ? {} : { text }),
        };
      }),
      this.app.metadataCache.resolvedLinks,
    );
  }

  /**
   * Holds off redrawing until the press just made ends, wherever it ends. A
   * click needs its press and its release on one element, and a redraw replaces
   * every row, so a row redrawn between them would get no click. `win` is the
   * list's window for this press, as the library's tab can move to another. A
   * move with the button up ends it too, as a release can go to a menu of the
   * system's and never arrive.
   */
  #holdForPress(win: Window): void {
    this.#pressed = true;
    const ending = ["pointerup", "pointercancel", "pointermove"] as const;
    const ended = (event: PointerEvent): void => {
      if ((event.buttons & 1) !== 0) return;
      this.#pressed = false;
      for (const type of ending) win.removeEventListener(type, ended, true);
    };
    for (const type of ending) win.addEventListener(type, ended, true);
  }

  /**
   * Holds off redrawing until Space comes up, as a button acts on Space then, and
   * a row redrawn while it is down would do nothing. The window losing the focus
   * ends it too, as the key can then come up where this can't see it.
   */
  #holdForSpace(win: Window): void {
    this.#pressed = true;
    const stop = (): void => {
      this.#pressed = false;
      win.removeEventListener("keyup", up, true);
      win.removeEventListener("blur", stop);
    };
    const up = (event: KeyboardEvent): void => {
      if (event.key === " ") stop();
    };
    win.addEventListener("keyup", up, true);
    win.addEventListener("blur", stop);
  }

  /** Shows the library as the vault holds it now, keeping the focus. */
  #render(): void {
    if (this.#editing !== undefined) return;
    const list = this.#list;
    const field = this.#folderField;
    if (list === undefined || field === undefined) return;
    // Not yet: this comes round again until the press has ended.
    if (this.#pressed) {
      this.#refresh();
      return;
    }
    const files = this.#files();
    const entries = this.#entries(files);
    const folders = foldersOf(entries);
    this.#folders = folders;
    // A folder that no longer holds symbols shows every folder.
    if (this.#folder !== undefined && !folders.includes(this.#folder)) {
      this.#folder = undefined;
    }
    const matching = filterCatalog(entries, this.#query, this.#folder);
    const shown = matching.slice(0, this.#rows);
    this.#status?.toggle(this.#query.trim() !== "" && this.#texts.reading);
    const key = JSON.stringify([
      folders,
      this.#folder ?? null,
      entries.length,
      matching.length,
      shown.map((entry) => [
        entry.path,
        entry.notes,
        this.#expanded.has(entry.path),
        // Its picture's address, which changes as the file does.
        pictureOf(this.app.vault, files.get(entry.path)),
        entry.text?.text ?? null,
        entry.found?.value ?? null,
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
    const inList = focused !== null && list.contains(focused);
    const focusPath = inList
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
    const left = matching.length - shown.length;
    if (left > 0) {
      const more = list.createEl("button", {
        cls: "inkline-library-more",
        text: `Show more: ${String(left)} left`,
        attr: { "data-inkline-role": "more" },
      });
      more.addEventListener("click", () => {
        this.#showMore(list);
      });
    }
    if (inList && focusRole === "more") {
      // A redraw nobody asked for, as when the index catches up, takes the
      // button from under the focus too. It is back unless the list got shorter.
      this.#focusRow(list, shown.length);
    } else if (focusPath !== undefined && focusPath !== null) {
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

  /**
   * Draws the next rows, and goes on from the first of them, as the button that
   * had the focus is gone. A person using the keyboard, or a screen reader,
   * would otherwise start again from the top of the window.
   */
  #showMore(list: HTMLElement): void {
    const first = this.#rows;
    this.#rows += rowsAtOnce;
    this.#render();
    // A row being edited holds off redrawing, and keeps the focus it has.
    if (this.#editing === undefined) this.#focusRow(list, first);
  }

  /**
   * Focuses the row at `index`, or else Show more, or else the last row, or
   * else the filter, so that a redraw leaves the focus with the list.
   */
  #focusRow(list: HTMLElement, index: number): void {
    const rows = list.querySelectorAll("[data-inkline-path]");
    const insert = '[data-inkline-role="insert"]';
    const target =
      rows[index]?.querySelector(insert) ??
      list.querySelector('[data-inkline-role="more"]') ??
      rows[rows.length - 1]?.querySelector(insert) ??
      this.#searchField;
    if (target?.instanceOf(HTMLElement) === true) target.focus();
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
    // The row can shorten a long name or folder: this has the whole of both.
    setTooltip(
      insert,
      entry.folder === "" ? entry.name : `${entry.folder}/${entry.name}`,
    );
    insert.addEventListener("click", () => {
      this.#insert(file);
    });
    row.addEventListener("contextmenu", (event) => {
      if (row.querySelector("form") !== null) return;
      event.preventDefault();
      if (this.app.vault.getFileByPath(file.path) !== file) {
        const next =
          this.#editing === undefined
            ? "Refreshing the library."
            : "Finish editing to refresh the library.";
        new Notice(`${entry.name} changed or was deleted. ${next}`);
        this.#refresh();
        return;
      }
      showLinkMenu(this.app, file, this.leaf, event);
    });
    const expanded = this.#expanded.has(entry.path);
    const actions = row.createDiv({ cls: "inkline-library-actions" });
    const uses = actions.createEl("button", {
      cls: "inkline-library-uses",
      text: usesLabel(entry.notes.length),
      attr: {
        "data-inkline-role": "uses",
        "aria-expanded": String(expanded && entry.notes.length > 0),
      },
    });
    // Its icon and words, as a row has little room beside a name; its tooltip
    // says what it edits, and a screen reader hears that too.
    const edit = actions.createEl("button", {
      cls: "inkline-library-edit",
      attr: { "data-inkline-role": "edit" },
    });
    setIcon(
      edit.createSpan({
        cls: "inkline-library-edit-icon",
        attr: { "aria-hidden": "true" },
      }),
      "pencil",
    );
    edit.createSpan({ text: "Quick edit" });
    setTooltip(
      edit,
      `Quick edit the name, readings, and translations of ${entry.name}`,
    );
    edit.addEventListener("click", () => {
      this.#quickEdit(row, entry, file);
    });
    this.#renderValues(row, entry);
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
   * Shows what a symbol says about itself, under its row, with a value the
   * filter found first. A symbol with none keeps a row of the usual height.
   */
  #renderValues(row: HTMLElement, entry: CatalogEntry): void {
    const { text, found } = entry;
    if (text === undefined || isBlank(text.text)) return;
    const values = row.createDiv({ cls: "inkline-library-values" });
    for (const field of textFields) {
      const held = text.text[field];
      if (held.length === 0) continue;
      showValues(
        values,
        field,
        held,
        found?.field === field ? found.value : undefined,
      );
    }
  }

  /** Stops the filters and the refreshes while a row is being edited. */
  #startEditing(field: HTMLElement): void {
    this.#editing = field;
    if (this.#searchField !== undefined) this.#searchField.disabled = true;
    if (this.#folderField !== undefined) this.#folderField.disabled = true;
  }

  /**
   * Ends the editing of `field`, shows the library as it now is, and puts the
   * focus on the button of `role` in `file`'s row.
   */
  #stopEditing(field: HTMLElement, file: TFile, role: string): void {
    if (this.#editing !== field) return;
    this.#editing = undefined;
    this.#panel?.release();
    this.#panel = undefined;
    if (this.#searchField !== undefined) this.#searchField.disabled = false;
    if (this.#folderField !== undefined) this.#folderField.disabled = false;
    this.#shown = "";
    this.#render();
    const current = Array.from(
      this.#list?.querySelectorAll("[data-inkline-path]") ?? [],
    ).find((found) => found.getAttribute("data-inkline-path") === file.path);
    const button = current?.querySelector(`[data-inkline-role="${role}"]`);
    if (button?.instanceOf(HTMLElement) === true) button.focus();
    else this.#searchField?.focus();
  }

  /**
   * Quick edit: a symbol's name, readings, and translations, in its row,
   * without opening the editor. One Save does what changed, in two steps, in
   * the editor's order, which writes the drawing before it renames: first the
   * readings and translations, into the file's text chunks and nothing else,
   * as {@link writeSymbolText} does, and then the name, through Obsidian, as
   * {@link renameSymbol} does, so that the links follow. With nothing changed,
   * Save closes the row.
   *
   * What can refuse a save without trying it is checked before either step:
   * the fields, and the name, as {@link checkRename} refuses it, so that a
   * refused name writes nothing. A step that fails stops the save there, and
   * the row stays open with what was typed, to correct or try again: a write
   * that fails renames nothing, and a rename that fails leaves the readings
   * and translations saved, as the row says, so that Save tries the name again.
   *
   * This works on a file the editor will not open, as it does not read the
   * record, and the name can change on one whose text cannot be read. The
   * fields follow the file if it changes meanwhile, as by sync, and the name a
   * rename elsewhere, except where something was typed, which stays, with a
   * note of what saving would replace in the fields.
   */
  #quickEdit(row: HTMLElement, entry: CatalogEntry, file: TFile): void {
    if (this.#editing !== undefined) {
      this.#editing.focus();
      return;
    }
    row.empty();
    const form = row.createEl("form", { cls: "inkline-library-edit-form" });
    const heading = nameFor(form, form, `Quick edit ${entry.name}`);
    const title = form.createDiv({ cls: "inkline-library-edit-title" });
    title.createEl("img", {
      cls: "inkline-library-picture",
      attr: {
        src: this.app.vault.getResourcePath(file),
        alt: "",
        "aria-hidden": "true",
      },
    });
    const label = title.createEl("label", { cls: "inkline-text-field" });
    label.createSpan({ text: "Name" });
    const input = label.createEl("input", {
      type: "text",
      value: entry.name,
      attr: { spellcheck: "false", autocomplete: "off" },
    });
    /** The file's name as the field was last given it, to tell what was typed. */
    let given = entry.name;
    let saving = false;
    /** Whether the fields hold what the file says, and so can be typed in. */
    let readable = false;
    /** How to leave a save, once it has waited long enough to be left. */
    let leaveSave: (() => void) | undefined;
    /** Counts reads, so that only the latest is taken. */
    let reads = 0;
    const fields = new TextFields(form, noText, () => {
      if (!saving) error.setText("");
    });
    fields.enabled = false;
    const error = form.createDiv({
      cls: "inkline-library-edit-error",
      attr: { role: "alert" },
    });
    const wait = form.createDiv({
      cls: "inkline-save-wait",
      attr: { role: "alert" },
    });
    const buttons = form.createDiv({ cls: "inkline-library-edit-buttons" });
    const save = buttons.createEl("button", {
      text: "Save",
      attr: { type: "submit" },
    });
    const cancel = buttons.createEl("button", {
      text: "Cancel",
      attr: { type: "button" },
    });
    save.disabled = true;
    this.#startEditing(input);
    /** Whether the row is still being edited, in a library still open. */
    const open = (): boolean => this.#editing === input;
    const finish = (): void => {
      this.#stopEditing(input, file, "edit");
    };
    /** Closes the row, once a save under way may be left. */
    const leave = (): void => {
      if (saving && leaveSave === undefined) return;
      leaveSave?.();
      finish();
    };
    /** Says `lines` in the row, a line each, as what went wrong. */
    const fail = (...lines: string[]): void => {
      error.empty();
      for (const line of lines) error.createDiv({ text: line });
    };
    const reread = (): void => {
      if (saving) return;
      const read = ++reads;
      void readSymbolText(this.app, file).then(
        (now) => {
          if (!open() || read !== reads || saving) return;
          fields.take(now);
          readable = true;
          fields.enabled = true;
          save.disabled = false;
          error.setText("");
        },
        (failure: unknown) => {
          if (!open() || read !== reads || saving) return;
          // What was typed stays, to copy, and the name can still change,
          // unless the file has gone.
          readable = false;
          fields.enabled = false;
          save.disabled = this.app.vault.getFileByPath(file.path) !== file;
          error.setText(reasonOf(failure, "The symbol could not be read."));
        },
      );
    };
    const renamed = (): void => {
      if (saving) return;
      const now = symbolStem(file.name) ?? file.basename;
      if (input.value === given) input.value = now;
      given = now;
      heading.setText(`Quick edit ${now}`);
    };
    // Obsidian takes Mod+Enter before the fields see it.
    const keys = new Scope(this.app.scope);
    keys.register(["Mod"], "Enter", () => {
      if (!form.contains(form.doc.activeElement)) return true;
      form.requestSubmit();
      return false;
    });
    this.app.keymap.pushScope(keys);
    this.#panel = {
      file,
      reread,
      renamed,
      release: () => {
        this.app.keymap.popScope(keys);
      },
    };
    cancel.addEventListener("click", leave);
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      leave();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (saving || save.disabled || fields.problem() !== undefined) return;
      const typed = input.value;
      const was = given;
      const changes = fields.changes();
      const sent = fields.typed();
      const writing = Object.keys(changes).length > 0;
      let renaming: boolean;
      try {
        // Before anything is written, so that a refused name leaves the file
        // as it was.
        renaming = typed !== was && checkRename(this.app, file, typed);
      } catch (failure) {
        fail(reasonOf(failure, "The symbol could not be renamed."));
        input.focus();
        return;
      }
      if (!writing && !renaming) {
        finish();
        return;
      }
      // Disabled, Save would drop the focus, and with it Esc and any copying
      // from the fields, should this save have to wait. The fields hold what
      // the first step writes.
      if (form.doc.activeElement === save) {
        if (writing) fields.focus();
        else input.focus();
      }
      saving = true;
      save.disabled = true;
      cancel.disabled = true;
      input.readOnly = true;
      fields.enabled = false;
      error.setText("");
      let waited = false;
      /** Whether the person left the row while a step waited. */
      let left = false;
      /** Whether the step they left was stopped, and so changes nothing. */
      let stopped = false;
      /** Whether the readings and translations are written. */
      let saved = false;
      /**
       * Gives the row back, with what was typed, to correct or try again, and
       * with the name the file has now, which a rename elsewhere during the
       * save may have changed.
       */
      const again = (): void => {
        saving = false;
        leaveSave = undefined;
        save.disabled = false;
        cancel.disabled = false;
        input.readOnly = false;
        fields.enabled = readable;
        renamed();
      };
      const writeText = async (): Promise<void> => {
        const work = writeSymbolText(
          this.app,
          file,
          changes,
          fields.given,
          this.#unloaded,
        );
        const waiting = (still: boolean): void => {
          if (!open()) return;
          waited ||= still;
          wait.setText(still ? `${savingWaits} ${savingLeft}` : "");
          cancel.disabled = !still;
          leaveSave = !still
            ? undefined
            : () => {
                left = true;
                stopped = work.stop();
                if (!stopped) {
                  new Notice(
                    `Saving ${was} had reached Obsidian, so it may still finish.${renaming ? " It will not be renamed." : ""}`,
                  );
                }
              };
        };
        await watchSave(
          work.done.then(() => this.#texts.refresh(file)),
          waiting,
        );
      };
      const rename = async (): Promise<void> => {
        const waiting = (still: boolean): void => {
          if (!open()) return;
          waited ||= still;
          wait.setText(still ? `${renameWaits} ${renameLeft}` : "");
          cancel.disabled = !still;
          leaveSave = !still
            ? undefined
            : () => {
                left = true;
                stopped = work.stop();
                if (!stopped) {
                  new Notice(
                    `Renaming ${was} had reached Obsidian, so it may still finish.`,
                  );
                }
              };
        };
        const work = renameSymbol(
          this.app,
          file,
          typed,
          { told: waiting, asked: () => modalOpen(form) },
          this.#unloaded,
        );
        await work.done;
      };
      const textFailed = (failure: unknown): void => {
        const reason = reasonOf(failure, "The symbol could not be saved.");
        // Gone with the library, as when Inkline unloads, what was typed
        // would be lost without a word. One the person stopped wrote nothing,
        // as they asked.
        if (!open()) {
          if (left && stopped) return;
          new Notice(
            renaming
              ? `The readings and translations of ${was} were not saved, and it was not renamed to ${typed}: ${reason}`
              : `The readings and translations of ${was} were not saved: ${reason}`,
          );
          return;
        }
        again();
        if (failure instanceof TextMoved) {
          fields.take(failure.text);
          if (renaming) {
            fail(
              "The file changed meanwhile, so nothing was saved or renamed.",
            );
          }
        } else {
          fail(reason, ...(renaming ? ["Nothing was renamed."] : []));
        }
        if (readable) fields.focus();
        else input.focus();
      };
      const renameFailed = (failure: unknown): void => {
        const reason = reasonOf(failure, "The symbol could not be renamed.");
        const disturbed = failure instanceof RenameDisturbed;
        // Gone with the library, the name typed would be lost without a word.
        if (!open()) {
          if (left && stopped) return;
          const first = saved ? `Saved ${was}. ` : "";
          new Notice(
            disturbed
              ? `${first}Renaming ${was} to ${typed}: ${reason}`
              : `${first}${was} could not be renamed to ${typed}: ${reason}`,
          );
          return;
        }
        again();
        // What came between a rename says where the file is now, which may
        // have the new name all the same.
        const first = disturbed
          ? "The readings and translations are saved."
          : "The readings and translations are saved, but the symbol was not renamed:";
        fail(...(saved ? [first] : []), reason);
        input.focus();
      };
      const run = async (): Promise<void> => {
        if (writing) {
          try {
            await writeText();
          } catch (failure) {
            textFailed(failure);
            return;
          }
          saved = true;
          if (open()) fields.saved(changes, sent);
          // Left while it waited, the row closed, and the rename with it.
          if (left) {
            new Notice(`Saved ${was}.`);
            return;
          }
        }
        if (renaming) {
          try {
            await rename();
          } catch (failure) {
            renameFailed(failure);
            return;
          }
        }
        // Nothing else says so, to a person who has looked away or left.
        if (waited) {
          const now = symbolStem(file.name) ?? file.basename;
          new Notice(
            !renaming
              ? `Saved ${was}.`
              : saved
                ? `Saved ${was} and renamed it to ${now}.`
                : `Renamed ${was} to ${now}.`,
          );
        }
        finish();
      };
      void run();
    });
    reread();
    input.focus();
    input.select();
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
    writeAt(editor, place.at, place.before + embed);
  }
}
