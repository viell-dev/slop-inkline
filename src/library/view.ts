// The symbol library: a view of every symbol in the vault, in a sidebar,
// with its picture, name, folder, readings, translations, and the notes that
// use it, filtered by name, by what it says about itself, and by folder. A
// click inserts a symbol at the cursor of the most recently active note; its
// menu is the one Obsidian shows for a link to it, with Edit symbol among its
// items. catalog.ts decides what it lists.

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
  readSymbolText,
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

/** How many notes use a symbol, as the library says it. */
function usesLabel(count: number): string {
  if (count === 0) return "Not used";
  return count === 1 ? "1 note" : `${String(count)} notes`;
}

/** A note's path as the library shows it, without `.md`. */
function noteLabel(path: string): string {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}

/** The row whose readings and translations are being edited. */
interface TextPanel {
  readonly file: TFile;
  /** Reads the file again, after the vault says it changed or went. */
  readonly reread: () => void;
  /** Lets go of what the row took while it was edited. */
  readonly release: () => void;
}

/** The symbol library, in a sidebar. */
export class SymbolLibraryView extends ItemView {
  readonly #texts: SymbolTexts;
  /**
   * Whether Inkline is still loaded. Obsidian closes the library as Inkline
   * unloads, and a save or rename still waiting then writes nothing.
   */
  readonly #alive: () => boolean;
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
  #textPanel: TextPanel | undefined;
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

  constructor(leaf: WorkspaceLeaf, texts: SymbolTexts, alive: () => boolean) {
    super(leaf);
    this.#texts = texts;
    this.#alive = alive;
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
      attr: { role: "list", "aria-label": "Symbols" },
    });
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
        if (file === this.#textPanel?.file) this.#textPanel.reread();
      }),
    );
    // A note renamed or deleted changes the notes listed too.
    this.registerEvent(
      vault.on("delete", (file) => {
        this.#refresh();
        if (file === this.#textPanel?.file) this.#textPanel.reread();
      }),
    );
    this.registerEvent(vault.on("rename", () => this.#refresh()));
    this.registerEvent(metadataCache.on("resolved", () => this.#refresh()));
    this.#render();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    this.#refresh.cancel();
    this.#editing = undefined;
    this.#textPanel?.release();
    this.#textPanel = undefined;
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
            : this.#textPanel === undefined
              ? "Finish renaming to refresh the library."
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
    const rename = actions.createEl("button", {
      cls: "inkline-library-rename",
      text: "Rename",
      attr: {
        "data-inkline-role": "rename",
        "aria-label": `Rename ${entry.name}`,
      },
    });
    rename.addEventListener("click", () => {
      this.#rename(row, entry, file);
    });
    // An icon, as a row has little room beside a name, and Rename says the
    // rest: its tooltip and its label name it.
    const editText = actions.createEl("button", {
      cls: "inkline-library-edit-text",
      attr: { "data-inkline-role": "text" },
    });
    setIcon(editText, "languages");
    setTooltip(editText, `Readings and translations of ${entry.name}`);
    editText.addEventListener("click", () => {
      this.#editText(row, entry, file);
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
    this.#textPanel?.release();
    this.#textPanel = undefined;
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
   * Edits a symbol's readings and translations in its row, without opening the
   * editor. Saving changes its file's text chunks and nothing else, so a guess
   * is corrected without a rename, and without touching a note. This works on a
   * file the editor will not open, as it does not read the record. The fields
   * follow the file if it changes meanwhile, as by sync, except where something
   * was typed, which stays, with a note of what it will replace.
   */
  #editText(row: HTMLElement, entry: CatalogEntry, file: TFile): void {
    if (this.#editing !== undefined) {
      this.#editing.focus();
      return;
    }
    row.empty();
    const form = row.createEl("form", {
      cls: "inkline-library-text-form",
      attr: { "aria-label": `Readings and translations of ${entry.name}` },
    });
    const title = form.createDiv({ cls: "inkline-library-text-title" });
    title.createEl("img", {
      cls: "inkline-library-picture",
      attr: {
        src: this.app.vault.getResourcePath(file),
        alt: "",
        "aria-hidden": "true",
      },
    });
    title.createDiv({ cls: "inkline-library-name", text: entry.name });
    let saving = false;
    let closed = false;
    /** How to leave a save, once it has waited long enough to be left. */
    let leaveSave: (() => void) | undefined;
    /** Counts reads, so that only the latest is taken. */
    let reads = 0;
    const fields = new TextFields(form, noText, () => {
      if (!saving) error.setText("");
    });
    fields.enabled = false;
    const error = form.createDiv({
      cls: "inkline-library-rename-error",
      attr: { role: "alert" },
    });
    const wait = form.createDiv({
      cls: "inkline-save-wait",
      attr: { role: "alert" },
    });
    const buttons = form.createDiv({ cls: "inkline-library-text-buttons" });
    const save = buttons.createEl("button", {
      text: "Save",
      attr: { type: "submit" },
    });
    const cancel = buttons.createEl("button", {
      text: "Cancel",
      attr: { type: "button" },
    });
    save.disabled = true;
    const anchor = form.querySelector("textarea");
    if (anchor === null) return;
    this.#startEditing(anchor);
    const finish = (): void => {
      closed = true;
      this.#stopEditing(anchor, file, "text");
    };
    /** Closes the fields, once a save under way may be left. */
    const leave = (): void => {
      if (saving && leaveSave === undefined) return;
      leaveSave?.();
      finish();
    };
    const reread = (): void => {
      if (saving) return;
      const read = ++reads;
      void readSymbolText(this.app, file).then(
        (now) => {
          if (closed || read !== reads || saving) return;
          fields.take(now);
          fields.enabled = true;
          save.disabled = false;
          error.setText("");
        },
        (failure: unknown) => {
          if (closed || read !== reads || saving) return;
          save.disabled = true;
          error.setText(
            failure instanceof Error
              ? failure.message
              : "The symbol could not be read.",
          );
        },
      );
    };
    // Obsidian takes Mod+Enter before the fields see it.
    const keys = new Scope(this.app.scope);
    keys.register(["Mod"], "Enter", () => {
      if (!form.contains(form.doc.activeElement)) return true;
      form.requestSubmit();
      return false;
    });
    this.app.keymap.pushScope(keys);
    this.#textPanel = {
      file,
      reread,
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
      const changes = fields.changes();
      if (Object.keys(changes).length === 0) {
        finish();
        return;
      }
      // Disabled, Save would drop the focus, and with it Esc and any copying
      // from the fields, should this save have to wait.
      if (form.doc.activeElement === save) fields.focus();
      saving = true;
      save.disabled = true;
      cancel.disabled = true;
      fields.enabled = false;
      error.setText("");
      const again = (): void => {
        saving = false;
        save.disabled = false;
        cancel.disabled = false;
        fields.enabled = true;
        fields.focus();
      };
      const writing = writeSymbolText(
        this.app,
        file,
        changes,
        fields.given,
        this.#alive,
      );
      let waited = false;
      const waiting = (still: boolean): void => {
        if (closed) return;
        waited ||= still;
        wait.setText(still ? `${savingWaits} ${savingLeft}` : "");
        cancel.disabled = !still;
        leaveSave = !still
          ? undefined
          : () => {
              if (!writing.stop()) {
                new Notice(
                  `Saving ${entry.name} had reached Obsidian, so it may still finish.`,
                );
              }
            };
      };
      void watchSave(
        writing.done.then(() => this.#texts.refresh(file)),
        waiting,
      ).then(
        () => {
          // Nothing else says so, to a person who has looked away or left.
          if (waited) new Notice(`Saved ${entry.name}.`);
          finish();
        },
        (failure: unknown) => {
          if (closed) return;
          const reason =
            failure instanceof Error
              ? failure.message
              : "The symbol could not be saved.";
          // Gone with the library, as when Inkline unloads, what was typed
          // would be lost without a word.
          if (this.#editing !== anchor) {
            new Notice(
              `The readings and translations of ${entry.name} were not saved: ${reason}`,
            );
            return;
          }
          again();
          if (failure instanceof TextMoved) {
            fields.take(failure.text);
          } else {
            error.setText(reason);
          }
        },
      );
    });
    reread();
    fields.focus();
  }

  /** Edits a name in its row, deferring refreshes until saved or cancelled. */
  #rename(row: HTMLElement, entry: CatalogEntry, file: TFile): void {
    if (this.#editing !== undefined) {
      this.#editing.focus();
      return;
    }
    row.empty();
    const form = row.createEl("form", {
      cls: "inkline-library-rename-form",
      attr: { "aria-label": `Rename ${entry.name}` },
    });
    const input = form.createEl("input", {
      type: "text",
      value: entry.name,
      attr: {
        "aria-label": "Symbol name",
        spellcheck: "false",
        autocomplete: "off",
      },
    });
    const save = form.createEl("button", { type: "submit", text: "Save" });
    const cancel = form.createEl("button", { type: "button", text: "Cancel" });
    const error = form.createDiv({
      cls: "inkline-library-rename-error",
      attr: { role: "alert" },
    });
    const wait = form.createDiv({
      cls: "inkline-save-wait",
      attr: { role: "alert" },
    });
    this.#startEditing(input);
    let saving = false;
    /** How to leave a rename, once it has stopped long enough to be left. */
    let leaveRename: (() => void) | undefined;
    const finish = () => {
      this.#stopEditing(input, file, "rename");
    };
    /** Closes the form, once a rename under way may be left. */
    const leave = (): void => {
      if (saving && leaveRename === undefined) return;
      leaveRename?.();
      finish();
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
      if (saving) return;
      saving = true;
      // Disabled, Save would drop the focus, and with it Esc and any copying
      // from the field, should this rename have to wait.
      if (form.doc.activeElement === save) input.focus();
      save.disabled = true;
      cancel.disabled = true;
      input.readOnly = true;
      error.setText("");
      const typed = input.value;
      let waited = false;
      let stopped = false;
      const waiting = (still: boolean): void => {
        if (this.#editing !== input) return;
        waited ||= still;
        wait.setText(still ? `${renameWaits} ${renameLeft}` : "");
        cancel.disabled = !still;
        leaveRename = !still
          ? undefined
          : () => {
              stopped = renaming.stop();
              if (!stopped) {
                new Notice(
                  `Renaming ${entry.name} had reached Obsidian, so it may still finish.`,
                );
              }
            };
      };
      const renaming = renameSymbol(
        this.app,
        file,
        typed,
        { told: waiting, asked: () => modalOpen(form) },
        this.#alive,
      );
      void renaming.done.then(
        () => {
          // Nothing else says so, to a person who has looked away or left.
          if (waited) {
            const name = symbolStem(file.name) ?? file.basename;
            new Notice(`Renamed ${entry.name} to ${name}.`);
          }
          finish();
        },
        (failure: unknown) => {
          const reason =
            failure instanceof Error
              ? failure.message
              : "The symbol could not be renamed.";
          // Gone with the form, the name typed would be lost without a word.
          if (this.#editing !== input) {
            if (!stopped) {
              new Notice(
                `${entry.name} could not be renamed to ${typed}: ${reason}`,
              );
            }
            return;
          }
          saving = false;
          save.disabled = false;
          cancel.disabled = false;
          input.readOnly = false;
          error.setText(reason);
          input.focus();
        },
      );
    });
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
