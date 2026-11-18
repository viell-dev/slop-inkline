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
import { watchSave } from "../notes/file-writes.ts";
import { writeAt } from "../notes/insertion.ts";
import { insertionAt } from "../notes/links.ts";
import { symbolStem } from "../notes/names.ts";
import type { SymbolTexts } from "../notes/suggest.ts";
import {
  checkRename,
  readSymbolText,
  renameChecked,
  writeSymbolText,
  type Renaming,
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
import {
  followName,
  leftNotice,
  QuickSave,
  reasonOf,
  reportSave,
  waitLine,
  type Names,
  type Steps,
  type Told,
  type Work,
} from "./quick-edit.ts";
import { markNotice } from "../notices.ts";

/** The library's view type, as Obsidian registers and restores it. */
export const libraryViewType = "inkline-library";

/**
 * The most rows drawn at a time. A row takes a millisecond or more to draw,
 * with its picture, so a list of them all would keep a person typing in the
 * filter waiting for seconds in a vault of thousands of symbols.
 */
const rowsAtOnce = 100;

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

/** The folder a file is in, as the library names it: "" for the top folder. */
function folderOf(file: TFile): string {
  return file.parent === null || file.parent.isRoot() ? "" : file.parent.path;
}

/** The row being edited in Quick edit. */
interface EditPanel {
  readonly file: TFile;
  /** The row, whose buttons head the form. */
  readonly row: HTMLElement;
  /** Closes the row as Cancel does. */
  readonly leave: () => void;
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
  /**
   * The buttons that wait while a row is in Quick edit, disabled until it
   * closes: every row's Uses, the edited row's too, and Show more, which hold
   * off redrawing until then, so that a click would only take effect later,
   * and the other rows' Quick edit, as one row is edited at a time.
   */
  #waiting: HTMLButtonElement[] = [];
  /** Says to a screen reader what a waiting button waits for. */
  #waitNote: HTMLElement | undefined;
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
    this.#waitNote = root.createSpan({
      text: "Save or cancel Quick edit to use this.",
      attr: { id: newId("wait"), hidden: "" },
    });
    list.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.#holdForPress(list.win);
      this.#keepFocusFrom(event);
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
    this.#waiting = [];
    this.#waitNote = undefined;
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
          folder: folderOf(file),
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
    insert.createDiv({ cls: "inkline-library-text" });
    insert.addEventListener("click", () => {
      this.#insert(file);
    });
    row.addEventListener("contextmenu", (event) => {
      // Quick edit's fields keep the menu for their text.
      const target = event.targetNode;
      const form = row.querySelector("form");
      if (target !== null && form?.contains(target) === true) return;
      event.preventDefault();
      if (this.app.vault.getFileByPath(file.path) !== file) {
        const next =
          this.#editing === undefined
            ? "Refreshing the library."
            : "Finish editing to refresh the library.";
        markNotice(new Notice(`${entry.name} changed or was deleted. ${next}`));
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
    // says what it edits, and a screen reader hears that too. It opens the
    // form under the row's buttons, and closes it again, as Uses does its list.
    const edit = actions.createEl("button", {
      cls: "inkline-library-edit",
      attr: { "data-inkline-role": "edit", "aria-expanded": "false" },
    });
    setIcon(
      edit.createSpan({
        cls: "inkline-library-edit-icon",
        attr: { "aria-hidden": "true" },
      }),
      "pencil",
    );
    edit.createSpan({ text: "Quick edit" });
    this.#title(row, entry.name, entry.folder);
    edit.addEventListener("click", (event) => {
      // Only the first click of a double-click opens or closes the row: a
      // later one would undo it, closing the form just opened, or opening a
      // new one over what was just dropped. It gives the focus back to an
      // open form's name.
      if (event.detail > 1) {
        this.#editing?.focus();
        return;
      }
      if (this.#panel?.row === row) this.#panel.leave();
      else this.#quickEdit(row, file);
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
    // Under its readings and translations, as the next line of their list.
    const used = row.createDiv({ cls: "inkline-library-notes" });
    used.createDiv({ cls: "inkline-library-notes-label", text: "Uses:" });
    const notes = used.createEl("ul");
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
          markNotice(new Notice("That note is no longer in the vault."));
          return;
        }
        void this.app.workspace
          .getLeaf(Keymap.isModEvent(event))
          .openFile(file)
          .catch(() => {
            markNotice(new Notice("The note could not be opened."));
          });
      });
    }
  }

  /**
   * Names a row's symbol: in its button, with its folder, and in the tooltips
   * of that button and of Quick edit, which say the whole of a name or folder
   * that the row shortens.
   */
  #title(row: HTMLElement, name: string, folder: string): void {
    const insert = row.querySelector<HTMLElement>(
      '[data-inkline-role="insert"]',
    );
    const text = insert?.querySelector<HTMLElement>(".inkline-library-text");
    const edit = row.querySelector<HTMLElement>('[data-inkline-role="edit"]');
    if (insert === null || text === null || text === undefined) return;
    text.empty();
    text.createDiv({ cls: "inkline-library-name", text: name });
    if (folder !== "") {
      text.createDiv({ cls: "inkline-library-folder-name", text: folder });
    }
    setTooltip(insert, folder === "" ? name : `${folder}/${name}`);
    if (edit !== null) {
      setTooltip(
        edit,
        `Quick edit the name, readings, and translations of ${name}`,
      );
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

  /**
   * Stops the filters, the refreshes, and the buttons that wait for them while
   * a row is being edited: Uses, the edited row's too, the other rows' Quick
   * edit, and Show more. A symbol's button, which inserts it, the notes listed
   * under a row, which open, and the edited row's own Quick edit, `own`, which
   * closes it, still work.
   */
  #startEditing(field: HTMLElement, own: HTMLButtonElement): void {
    this.#editing = field;
    if (this.#searchField !== undefined) this.#searchField.disabled = true;
    if (this.#folderField !== undefined) this.#folderField.disabled = true;
    const waiting = this.#list?.querySelectorAll<HTMLButtonElement>(
      ["uses", "edit", "more"]
        .map((role) => `button[data-inkline-role="${role}"]`)
        .join(","),
    );
    this.#waiting = Array.from(waiting ?? []).filter(
      (button) => button !== own && !button.disabled,
    );
    for (const button of this.#waiting) {
      button.disabled = true;
      if (this.#waitNote !== undefined) {
        button.setAttribute("aria-describedby", this.#waitNote.id);
      }
    }
  }

  /** Gives back the buttons {@link #startEditing} disabled. */
  #stopWaiting(): void {
    for (const button of this.#waiting) {
      button.disabled = false;
      button.removeAttribute("aria-describedby");
    }
    this.#waiting = [];
  }

  /**
   * Leaves the focus where it was when a press on the list is on a disabled
   * button, which does nothing, as on another row's while one is in Quick edit.
   * The browser would take the focus to the window, out of a field being typed
   * in, where Esc and Mod+Enter work.
   */
  #keepFocusFrom(event: PointerEvent): void {
    const pressed = event.targetNode;
    const button =
      pressed?.instanceOf(Element) === true ? pressed.closest("button") : null;
    if (button?.disabled !== true) return;
    const doc = button.doc;
    const kept = doc.activeElement;
    if (kept?.instanceOf(HTMLElement) !== true || kept === doc.body) return;
    button.win.setTimeout(() => {
      if (kept.isConnected && doc.activeElement === doc.body) {
        kept.focus({ preventScroll: true });
      }
    });
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
    // Before the redraw, which a press under way can hold off.
    this.#stopWaiting();
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
   * Quick edit: a symbol's name, readings, and translations, in its row under
   * its buttons, without opening the editor. This shows the fields, checks
   * what Save can refuse before anything is written, and gives the library's
   * own write and rename to {@link QuickSave}, which runs them in turn;
   * quick-edit.ts says what the row and notices say of how it went. The
   * rename is of the file as {@link checkRename} checked it, from where it was
   * then, so that one renamed elsewhere while the readings are written is
   * refused rather than renamed again. This works on a file the editor will
   * not open, as it does not read the record, and the name can change on one
   * whose text cannot be read. The fields follow the file if it changes
   * meanwhile, as by sync, and the name a rename elsewhere, except where
   * something was typed, which stays, with a note of what saving would replace
   * in the fields. The row's buttons follow a rename elsewhere too.
   */
  #quickEdit(row: HTMLElement, file: TFile): void {
    if (this.#editing !== undefined) {
      this.#editing.focus();
      return;
    }
    // A row closed during a press on the list keeps its form until the press
    // ends and the list is drawn again. No row opens until then, so that the
    // list never holds a closed form beside an open one.
    if (this.#list?.querySelector(".inkline-library-edit-form") !== null) {
      return;
    }
    const own = row.querySelector<HTMLButtonElement>(
      'button[data-inkline-role="edit"]',
    );
    if (own === null) return;
    // The file's name now, which a rename elsewhere can have changed since the
    // row was drawn.
    const name = symbolStem(file.name) ?? file.basename;
    this.#title(row, name, folderOf(file));
    // The row's buttons stay, and head the form, which takes the place of what
    // shows under them. Its picture and name there say which symbol it is for.
    for (const under of row.querySelectorAll(
      ":scope > .inkline-library-values, :scope > .inkline-library-notes",
    )) {
      under.remove();
    }
    row
      .querySelector('[data-inkline-role="uses"]')
      ?.setAttribute("aria-expanded", "false");
    own.setAttribute("aria-expanded", "true");
    const form = row.createEl("form", { cls: "inkline-library-edit-form" });
    const heading = nameFor(form, form, `Quick edit ${name}`);
    const label = form.createEl("label", { cls: "inkline-text-field" });
    label.createSpan({ text: "Name" });
    const input = label.createEl("input", {
      type: "text",
      value: name,
      attr: { spellcheck: "false", autocomplete: "off" },
    });
    /** The file's name as the field was last given it, to tell what was typed. */
    let given = name;
    let saving = false;
    /** Whether the fields hold what the file says, and so can be typed in. */
    let readable = false;
    /** The save under way, which can be left once a step of it waits. */
    let running: { save: QuickSave; names: () => Names } | undefined;
    /** What the row's lines say: what reading the file found, or a save. */
    let said: "read" | "save" | undefined;
    /** Counts reads, so that only the latest is taken. */
    let reads = 0;
    const fields = new TextFields(
      form,
      noText,
      () => {
        if (!saving) say([]);
      },
      { fit: true },
    );
    fields.enabled = false;
    const error = form.createDiv({
      cls: "inkline-library-edit-error",
      attr: { role: "alert" },
    });
    /** Says `lines` in the row, a line each, as what `kind` found. */
    const say = (lines: readonly string[], kind?: "read" | "save"): void => {
      error.empty();
      for (const line of lines) error.createDiv({ text: line });
      said = lines.length === 0 ? undefined : kind;
    };
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
    /**
     * Lets Cancel, and the row's own Quick edit, which closes the row as Cancel
     * does, be used, or not while a save cannot yet be left.
     */
    const cancellable = (can: boolean): void => {
      cancel.disabled = !can;
      own.disabled = !can;
    };
    this.#startEditing(input, own);
    /** Whether the row is still being edited, in a library still open. */
    const open = (): boolean => this.#editing === input;
    const finish = (): void => {
      this.#stopEditing(input, file, "edit");
    };
    /**
     * Closes the row, once a save under way may be left: that stops what it
     * can, and the save goes no further. A notice says what was done.
     */
    const leave = (): void => {
      if (running !== undefined) {
        const left = running.save.leave();
        if (left === undefined) return;
        const notice = leftNotice(left, running.names());
        if (notice !== undefined) markNotice(new Notice(notice));
      }
      finish();
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
          // That settles what reading the file found, and nothing a save said.
          if (said === "read") say([]);
        },
        (failure: unknown) => {
          if (!open() || read !== reads || saving) return;
          // What was typed stays, to copy, and the name can still change,
          // unless the file has gone.
          readable = false;
          fields.enabled = false;
          save.disabled = this.app.vault.getFileByPath(file.path) !== file;
          if (said !== "save") {
            say([reasonOf(failure, "The symbol could not be read.")], "read");
          }
        },
      );
    };
    const renamed = (): void => {
      if (saving) return;
      const now = symbolStem(file.name) ?? file.basename;
      const field = followName({ typed: input.value, given }, now);
      if (field.typed !== input.value) input.value = field.typed;
      given = field.given;
      heading.setText(`Quick edit ${now}`);
      // The row's buttons above, which name it too.
      this.#title(row, now, folderOf(file));
      row.setAttribute("data-inkline-path", file.path);
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
      row,
      leave,
      reread,
      renamed,
      release: () => {
        this.app.keymap.popScope(keys);
        own.setAttribute("aria-expanded", "false");
      },
    };
    cancel.addEventListener("click", leave);
    // In the fields, and on the row's Quick edit just above them, which closes
    // the row too.
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      leave();
    };
    form.addEventListener("keydown", escape);
    own.addEventListener("keydown", escape);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      // A form closed during a press stays until the list is drawn again, and
      // saves nothing meanwhile.
      if (!open()) return;
      if (saving || save.disabled || fields.problem() !== undefined) return;
      const typed = input.value;
      const was = given;
      const changes = fields.changes();
      const sent = fields.typed();
      let checked: Renaming | undefined;
      try {
        // Before anything is written, so that a refused name leaves the file
        // as it was. Only a name typed renames.
        checked =
          typed === was ? undefined : checkRename(this.app, file, typed);
      } catch (failure) {
        say([reasonOf(failure, "The symbol could not be renamed.")], "save");
        input.focus();
        return;
      }
      const renaming = checked;
      const writing = Object.keys(changes).length > 0;
      if (!writing && renaming === undefined) {
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
      cancellable(false);
      input.readOnly = true;
      fields.enabled = false;
      say([]);
      const steps: Steps = {
        ...(writing
          ? {
              write: (told: Told): Work => {
                const work = writeSymbolText(
                  this.app,
                  file,
                  changes,
                  fields.given,
                  this.#unloaded,
                );
                return {
                  done: watchSave(
                    work.done.then(() => this.#texts.refresh(file)),
                    told,
                  ),
                  stop: work.stop,
                };
              },
            }
          : {}),
        ...(renaming === undefined
          ? {}
          : {
              rename: (told: Told): Work =>
                renameChecked(
                  this.app,
                  renaming,
                  { told, asked: () => modalOpen(form) },
                  this.#unloaded,
                ),
            }),
      };
      const quick = new QuickSave(steps, (step) => {
        if (!open()) return;
        wait.setText(step === undefined ? "" : waitLine(step, quick.written));
        cancellable(step !== undefined);
      });
      const names = (): Names => ({
        was,
        typed,
        now: symbolStem(file.name) ?? file.basename,
      });
      running = { save: quick, names };
      void quick.run().then((outcome) => {
        running = undefined;
        const report = reportSave(outcome, names(), open());
        if (report.notice !== undefined) markNotice(new Notice(report.notice));
        if (report.closes) {
          finish();
          return;
        }
        if (!open()) return;
        saving = false;
        save.disabled = false;
        cancellable(true);
        input.readOnly = false;
        fields.enabled = readable;
        if (outcome.written) fields.saved(changes, sent);
        if (report.moved !== undefined) fields.take(report.moved);
        say(report.lines, "save");
        // What the vault reported during the save, a rename elsewhere or a
        // file gone, is taken in now. A write refused for a change on disk
        // read the file itself, and the fields have taken what it found.
        renamed();
        if (report.moved === undefined) reread();
        if (report.focus === "fields" && readable) fields.focus();
        else input.focus();
      });
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
      markNotice(new Notice(`${name} was deleted, so it was not inserted.`));
      return;
    }
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    if (
      !(view instanceof MarkdownView) ||
      view.file === null ||
      view.getMode() !== "source"
    ) {
      markNotice(
        new Notice("Open a note in editing view to insert a symbol there."),
      );
      return;
    }
    const { editor } = view;
    const embed = embedFor(this.app, file, view.file.path);
    const text = editor.getValue();
    const place = insertionAt(text, editor.posToOffset(editor.getCursor()));
    writeAt(editor, place.at, place.before + embed);
  }
}
