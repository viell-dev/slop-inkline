// PROTOTYPE for #167, section 5, not for release: adding and changing what
// the dictionary says, from a note and from a symbol's menu.
//
// The dictionary is a view over two places, each holding what is about it:
// what one symbol is (its readings, translations, and whether it is only a
// part of others) stays in its own file's text chunks, where the library
// already edits it and where it travels with the file; what a string of
// symbols means stays in a lexicon note, whose embeds Obsidian renames. So
// "Add to dictionary" on one symbol changes its file, and on several a row
// of a lexicon note.

import {
  type App,
  type Editor,
  Modal,
  Notice,
  TFile,
  type MarkdownView,
} from "obsidian";
import { readChunks } from "../format/png.ts";
import {
  isTextChunk,
  partRole,
  readKeyword,
  readText,
  roleKeyword,
  writeKeyword,
  writeText,
} from "../format/text.ts";
import { isInkPath } from "../format/ink-file.ts";
import { segment, wordKey } from "../render/words.ts";
import type { SymbolTexts } from "./suggest.ts";
import {
  changedRow,
  columnsOf,
  embedPattern,
  type LexiconIndex,
  newRow,
  rowCells,
  symbolPath,
} from "./words.ts";

/** A symbol written in a note: where its embed is, and its file. */
interface Written {
  readonly from: number;
  readonly to: number;
  readonly path: string;
  readonly text: string;
}

/**
 * The symbols a person means on `editor`'s line: those the selection holds,
 * which must be one run with nothing between them, or with no selection,
 * the known word or the run the cursor is in.
 */
export function chosenSymbols(
  app: App,
  editor: Editor,
  notePath: string,
  index: LexiconIndex,
): Written[] | string {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  if (from.line !== to.line) return "Select symbols on one line.";
  const line = editor.getLine(from.line);
  const runs: Written[][] = [];
  let run: Written[] = [];
  let last = -1;
  for (const match of line.matchAll(embedPattern)) {
    const link = match[1] ?? decodeURIComponent(match[2] ?? "");
    const start = match.index;
    const end = start + match[0].length;
    const path = symbolPath(app, link, notePath);
    if (path === undefined || start !== last) {
      if (run.length > 0) runs.push(run);
      run = [];
    }
    if (path !== undefined) run.push({ from: start, to: end, path, text: match[0] });
    last = end;
  }
  if (run.length > 0) runs.push(run);
  if (from.ch !== to.ch) {
    const inside = runs
      .flat()
      .filter((each) => each.from >= from.ch && each.to <= to.ch);
    if (inside.length === 0) return "The selection holds no symbols.";
    const together = runs.some(
      (each) =>
        inside.every((symbol) => each.includes(symbol)) &&
        inside.every(
          (symbol, at) => at === 0 || inside[at - 1]?.to === symbol.from,
        ),
    );
    return together
      ? inside
      : "Select symbols written together, with nothing between them.";
  }
  const around = runs.find(
    (each) =>
      (each[0]?.from ?? 0) <= from.ch && (each.at(-1)?.to ?? 0) >= from.ch,
  );
  if (around === undefined) return "Put the cursor in a word of symbols.";
  for (const piece of segment(
    around.map((symbol) => symbol.path),
    index.lexicon,
  )) {
    const first = around[piece.start];
    const final = around[piece.end - 1];
    if (piece.entry === undefined || first === undefined || final === undefined)
      continue;
    if (first.from <= from.ch && final.to >= from.ch) {
      return around.slice(piece.start, piece.end);
    }
  }
  return around;
}

/** What the modal asks for, and what was there before. */
interface Entry {
  readonly reading: string;
  readonly meaning: string;
}

/** A small form: the symbols' pictures, a reading, and a meaning. */
class EntryModal extends Modal {
  readonly #done: (entry: Entry | undefined) => void;
  #given = false;

  constructor(
    app: App,
    symbols: readonly TFile[],
    title: string,
    now: Entry,
    composed: string,
    done: (entry: Entry | undefined) => void,
  ) {
    super(app);
    this.#done = done;
    this.modalEl.addClass("inkline-dictionary-modal");
    this.setTitle(title);
    const pictures = this.contentEl.createDiv({
      cls: "inkline-dictionary-symbols inkline-text",
    });
    for (const file of symbols) {
      pictures.createEl("img", {
        cls: "inkline-dictionary-picture",
        attr: {
          src: app.vault.getResourcePath(file),
          alt: file.basename.replace(/.ink$/i, ""),
        },
      });
    }
    const form = this.contentEl.createEl("form");
    const field = (label: string, value: string, placeholder: string) => {
      const wrap = form.createEl("label", { cls: "inkline-dictionary-field" });
      wrap.createSpan({ text: label });
      return wrap.createEl("input", {
        type: "text",
        value,
        attr: { placeholder, "data-inkline-dictionary": label.toLowerCase() },
      });
    };
    const reading = field(
      "Reading",
      now.reading,
      composed === "" ? "" : `${composed} (from the symbols)`,
    );
    const meaning = field("Meaning", now.meaning, "");
    const buttons = form.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", {
      text: "Save",
      cls: "mod-cta",
      attr: { type: "submit" },
    });
    const cancel = buttons.createEl("button", {
      text: "Cancel",
      attr: { type: "button" },
    });
    cancel.addEventListener("click", () => {
      this.close();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#given = true;
      this.#done({
        reading: reading.value.trim(),
        meaning: meaning.value.trim(),
      });
      this.close();
    });
    window.setTimeout(() => {
      (now.meaning === "" ? meaning : reading).focus();
    }, 0);
  }

  override onClose(): void {
    if (!this.#given) this.#done(undefined);
  }
}

/** `values` with `value` first, or as they are for an empty one. */
function first(values: readonly string[], value: string): string[] {
  if (value === "") return [...values];
  return [value, ...values.filter((each) => each !== value)];
}

/**
 * "Add to dictionary" for the symbols chosen in `view`'s note: one symbol's
 * main reading and translation in its file, or several symbols' word in a
 * lexicon note, made if the vault has none.
 */
export async function addToDictionary(
  app: App,
  view: MarkdownView,
  index: LexiconIndex,
  texts: SymbolTexts,
): Promise<void> {
  const note = view.file;
  if (note === null) return;
  const chosen = chosenSymbols(app, view.editor, note.path, index);
  if (typeof chosen === "string") {
    new Notice(chosen);
    return;
  }
  const files = chosen.flatMap((symbol) => {
    const file = app.vault.getFileByPath(symbol.path);
    return file === null ? [] : [file];
  });
  const paths = chosen.map((symbol) => symbol.path);
  const own = files.map((file) => texts.textOf(file)?.text);
  const composed = own.map((text) => text?.reading[0] ?? "?").join("");
  if (files.length === 1) {
    const [file] = files;
    if (file === undefined) return;
    const text = own[0];
    const entry = await ask(app, files, file.basename.replace(/.ink$/i, ""), {
      reading: text?.reading[0] ?? "",
      meaning: text?.translation[0] ?? "",
    }, "");
    if (entry === undefined) return;
    let bytes: Uint8Array = new Uint8Array(await app.vault.readBinary(file));
    const now = await readText(readChunks(bytes, (type) => isTextChunk({ type })));
    bytes = await writeText(bytes, "reading", first(now.reading, entry.reading));
    bytes = await writeText(
      bytes,
      "translation",
      first(now.translation, entry.meaning),
    );
    await app.vault.modifyBinary(file, bytes.slice().buffer);
    await texts.refresh(file);
    return;
  }
  const row = index.dictionary.byKey.get(wordKey(paths));
  const entry = await ask(
    app,
    files,
    row === undefined ? "Add a word" : "Change a word",
    { reading: row?.reading ?? "", meaning: row?.meaning ?? "" },
    composed,
  );
  if (entry === undefined) return;
  const embeds = chosen.map((symbol) => symbol.text).join("");
  if (row !== undefined) {
    const lexicon = app.vault.getFileByPath(row.note);
    if (lexicon === null) return;
    await app.vault.process(lexicon, (data) => {
      const lines = data.split("\n");
      const line = lines[row.line];
      if (line === undefined) return data;
      lines[row.line] = changedRow(line, row.columns, entry.reading, entry.meaning);
      return lines.join("\n");
    });
    return;
  }
  // The first lexicon note's last table, or a new note.
  const lexicons = app.vault
    .getMarkdownFiles()
    .filter(
      (file) =>
        app.metadataCache.getFileCache(file)?.frontmatter?.["inkline"] ===
        "lexicon",
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  const target = lexicons[0];
  if (target === undefined) {
    await app.vault.create(
      "Lexicon.md",
      [
        "---",
        "inkline: lexicon",
        "---",
        "",
        "| Word | Reading | Meaning |",
        "| ---- | ------- | ------- |",
        newRow({ word: 0, reading: 1, meaning: 2 }, 3, embeds, entry.reading, entry.meaning),
        "",
      ].join("\n"),
    );
    new Notice("Made Lexicon.md for the word.");
    return;
  }
  const table = (app.metadataCache.getFileCache(target)?.sections ?? [])
    .filter((section) => section.type === "table")
    .at(-1);
  await app.vault.process(target, (data) => {
    const lines = data.split("\n");
    if (table === undefined) {
      lines.push(
        "",
        "| Word | Reading | Meaning |",
        "| ---- | ------- | ------- |",
        newRow({ word: 0, reading: 1, meaning: 2 }, 3, embeds, entry.reading, entry.meaning),
      );
      return lines.join("\n");
    }
    const header = rowCells(lines[table.position.start.line] ?? "");
    const columns = columnsOf(header);
    lines.splice(
      table.position.end.line + 1,
      0,
      newRow(columns, header.length, embeds, entry.reading, entry.meaning),
    );
    return lines.join("\n");
  });
}

function ask(
  app: App,
  files: readonly TFile[],
  title: string,
  now: Entry,
  composed: string,
): Promise<Entry | undefined> {
  return new Promise((resolve) => {
    new EntryModal(app, files, title, now, composed, resolve).open();
  });
}

/** Whether the index says `file` is only a part of other symbols. */
export function isPart(texts: SymbolTexts, file: TFile): boolean {
  return texts.textOf(file)?.role?.includes(partRole) === true;
}

/**
 * Marks `file` as only a part of others, or takes the mark away, in its own
 * "Inkline role" text chunk, leaving every other byte as it was.
 */
export async function togglePart(
  app: App,
  file: TFile,
  texts: SymbolTexts,
): Promise<void> {
  const bytes = new Uint8Array(await app.vault.readBinary(file));
  const role = await readKeyword(
    readChunks(bytes, (type) => isTextChunk({ type })),
    roleKeyword,
  );
  const next = role.includes(partRole)
    ? role.filter((value) => value !== partRole)
    : [partRole, ...role];
  const written = await writeKeyword(bytes, roleKeyword, next);
  await app.vault.modifyBinary(file, written.slice().buffer);
  await texts.refresh(file);
}

/** Whether `file` is a symbol, for the file menu. */
export function isSymbolFile(file: unknown): file is TFile {
  return file instanceof TFile && isInkPath(file.path);
}
