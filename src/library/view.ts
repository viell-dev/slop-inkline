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
import type { SymbolText, TextField } from "../format/text.ts";
import { embedFor } from "../notes/embeds.ts";
import { showLinkMenu } from "../notes/entries.ts";
import { writeAt } from "../notes/insertion.ts";
import { insertionAt } from "../notes/links.ts";
import { symbolStem } from "../notes/names.ts";
import type { SymbolTexts } from "../notes/suggest.ts";
import {
  readSymbolText,
  renameSymbol,
  TextMoved,
  writeSymbolText,
} from "../notes/symbols.ts";
import {
  fieldLabel,
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
  /** What the filter holds. */
  #query = "";
  /** The folder shown, or undefined for every folder. */
  #folder: string | undefined;
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

  constructor(leaf: WorkspaceLeaf, texts: SymbolTexts) {
    super(leaf);
    this.#texts = texts;
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
    this.#searchField = search;
    this.#status = root.createDiv({
      cls: "inkline-library-status",
      text: "Still reading symbols, so more may match.",
    });
    this.#status.hide();
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

  /** Shows the library as the vault holds it now, keeping the focus. */
  #render(): void {
    if (this.#editing !== undefined) return;
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
    this.#status?.toggle(this.#query.trim() !== "" && this.#texts.reading);
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
    /** Counts reads, so that only the latest is taken. */
    let reads = 0;
    const fields = new TextFields(form, noText, () => {
      if (!saving) error.setText("");
    });
    fields.enabled = false;
    const note = form.createDiv({ cls: "inkline-library-text-note" });
    const error = form.createDiv({
      cls: "inkline-library-rename-error",
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
    /** Says which of `moved` the file changed under what was typed. */
    const warn = (moved: readonly TextField[], now: SymbolText): void => {
      note.empty();
      if (moved.length === 0) return;
      note.createDiv({
        text: "The file changed meanwhile. Saving replaces what it now says:",
      });
      for (const field of moved) {
        if (now[field].length > 0) showValues(note, field, now[field]);
        else note.createDiv({ text: `${fieldLabel(field, 2)}: none` });
      }
    };
    const reread = (): void => {
      if (saving) return;
      const read = ++reads;
      void readSymbolText(this.app, file).then(
        (now) => {
          if (closed || read !== reads || saving) return;
          warn(fields.take(now), now);
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
    cancel.addEventListener("click", finish);
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (!saving) finish();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (saving || save.disabled || fields.problem() !== undefined) return;
      const changes = fields.changes();
      if (Object.keys(changes).length === 0) {
        finish();
        return;
      }
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
      void writeSymbolText(this.app, file, changes, fields.given)
        .then(() => this.#texts.refresh(file))
        .then(finish, (failure: unknown) => {
          if (closed) return;
          again();
          if (failure instanceof TextMoved) {
            warn(fields.take(failure.text), failure.text);
          } else {
            error.setText(
              failure instanceof Error
                ? failure.message
                : "The symbol could not be saved.",
            );
          }
        });
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
    this.#startEditing(input);
    let saving = false;
    const finish = () => {
      this.#stopEditing(input, file, "rename");
    };
    cancel.addEventListener("click", finish);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!saving) finish();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      save.disabled = true;
      cancel.disabled = true;
      input.readOnly = true;
      error.setText("");
      void renameSymbol(this.app, file, input.value).then(
        finish,
        (failure: unknown) => {
          if (this.#editing !== input) return;
          saving = false;
          save.disabled = false;
          cancel.disabled = false;
          input.readOnly = false;
          error.setText(
            failure instanceof Error
              ? failure.message
              : "The symbol could not be renamed.",
          );
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
