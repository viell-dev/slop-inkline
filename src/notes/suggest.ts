// Inserting a symbol you already have: a suggestion that opens as you type a
// trigger and a few letters of its name, and a searchable list for a
// command. Both list the vault's symbols with their pictures, as
// search.ts ranks them, and insert a plain embed.

import {
  EditorSuggest,
  prepareFuzzySearch,
  SuggestModal,
  type App,
  type Editor,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
  type TFile,
} from "obsidian";
import { isInkPath } from "../format/ink-file.ts";
import { embedFromLink, symbolStem } from "./names.ts";
import { rankSymbols, triggerQuery } from "./search.ts";

/** The most symbols a list shows at once. */
const shownAtMost = 50;

/** A symbol's name: its file's name without `.ink.png`. */
function nameOf(file: TFile): string {
  return symbolStem(file.name) ?? file.basename;
}

/**
 * The vault's symbols whose names match `query`, as Obsidian's fuzzy search
 * matches them, best first: by the match, then by how often the note at
 * `notePath` uses each, then by how recently each changed. An empty query
 * matches every symbol.
 */
export function findSymbols(
  app: App,
  query: string,
  notePath: string,
): TFile[] {
  const typed = query.trim();
  const match = typed === "" ? undefined : prepareFuzzySearch(typed);
  const uses = app.metadataCache.resolvedLinks[notePath] ?? {};
  const candidates = app.vault
    .getFiles()
    .filter((file) => isInkPath(file.path))
    .flatMap((file) => {
      const name = nameOf(file);
      const found = match === undefined ? { score: 0 } : match(name);
      if (found === null) return [];
      return [
        {
          file,
          name,
          path: file.path,
          score: found.score,
          uses: uses[file.path] ?? 0,
          modified: file.stat.mtime,
        },
      ];
    });
  return rankSymbols(candidates)
    .slice(0, shownAtMost)
    .map((candidate) => candidate.file);
}

/** Shows a symbol in a list: its picture, its name, and its folder. */
function renderSymbol(app: App, file: TFile, el: HTMLElement): void {
  el.addClass("inkline-suggestion");
  el.createEl("img", {
    cls: "inkline-suggestion-picture",
    attr: { src: app.vault.getResourcePath(file), alt: "" },
  });
  const text = el.createDiv({ cls: "inkline-suggestion-text" });
  text.createDiv({ cls: "inkline-suggestion-name", text: nameOf(file) });
  const folder = file.parent;
  if (folder !== null && !folder.isRoot()) {
    text.createDiv({ cls: "inkline-suggestion-folder", text: folder.path });
  }
}

/** The embed that shows `file` in the note at `notePath`. */
function embedFor(app: App, file: TFile, notePath: string): string {
  return embedFromLink(app.fileManager.generateMarkdownLink(file, notePath));
}

/**
 * Offers the vault's symbols as their name is typed after a trigger, such
 * as `;;tow`, and replaces the trigger and the name with the chosen one's
 * embed.
 */
export class SymbolSuggest extends EditorSuggest<TFile> {
  readonly #trigger: () => string;

  constructor(app: App, trigger: () => string) {
    super(app);
    this.#trigger = trigger;
    this.setInstructions([
      { command: "↑↓", purpose: "to choose" },
      { command: "↵", purpose: "to insert the symbol" },
      { command: "esc", purpose: "to keep typing" },
    ]);
  }

  override onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (file === null) return null;
    const found = triggerQuery(
      editor.getLine(cursor.line),
      cursor.ch,
      this.#trigger(),
    );
    if (found === undefined) return null;
    return {
      start: { line: cursor.line, ch: found.start },
      end: cursor,
      query: found.query,
    };
  }

  override getSuggestions(context: EditorSuggestContext): TFile[] {
    return findSymbols(this.app, context.query, context.file.path);
  }

  override renderSuggestion(file: TFile, el: HTMLElement): void {
    renderSymbol(this.app, file, el);
  }

  override selectSuggestion(file: TFile): void {
    const { context } = this;
    if (context === null) return;
    context.editor.replaceRange(
      embedFor(this.app, file, context.file.path),
      context.start,
      context.end,
    );
  }
}

/** The vault's symbols to search by name, inserting the one chosen. */
export class SymbolSearch extends SuggestModal<TFile> {
  readonly #notePath: string;
  readonly #chosen: (embed: string) => void;

  constructor(app: App, notePath: string, chosen: (embed: string) => void) {
    super(app);
    this.#notePath = notePath;
    this.#chosen = chosen;
    this.setPlaceholder("Insert which symbol?");
    this.emptyStateText = "No symbol has that name.";
  }

  override getSuggestions(query: string): TFile[] {
    return findSymbols(this.app, query, this.#notePath);
  }

  override renderSuggestion(file: TFile, el: HTMLElement): void {
    renderSymbol(this.app, file, el);
  }

  override onChooseSuggestion(file: TFile): void {
    this.#chosen(embedFor(this.app, file, this.#notePath));
  }
}
