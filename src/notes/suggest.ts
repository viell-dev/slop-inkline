// Inserting a symbol you already have: a suggestion that opens as you type a
// trigger and a few letters of its name, and a searchable list for a
// command. Both list the vault's symbols with their pictures, as
// search.ts ranks them, and insert a plain embed.

import {
  EditorSuggest,
  Notice,
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
import { embedFor } from "./embeds.ts";
import { symbolStem } from "./names.ts";
import {
  holdsTyped,
  insideCodeBlock,
  insideCodeSpan,
  rankSymbols,
  triggerQuery,
} from "./search.ts";

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
 * matches every symbol. A query with a space matches only names that hold
 * it, so that a sentence typed on after a trigger stops matching.
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
      if (query.includes(" ") && !holdsTyped(name, query)) return [];
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
  // Its picture is text, as the renderer paints symbols in text.
  el.addClass("inkline-suggestion", "inkline-text");
  // Beside its name, the picture says nothing more to a screen reader.
  el.createEl("img", {
    cls: "inkline-suggestion-picture",
    attr: {
      src: app.vault.getResourcePath(file),
      alt: "",
      "aria-hidden": "true",
    },
  });
  const text = el.createDiv({ cls: "inkline-suggestion-text" });
  text.createDiv({ cls: "inkline-suggestion-name", text: nameOf(file) });
  const folder = file.parent;
  if (folder !== null && !folder.isRoot()) {
    text.createDiv({ cls: "inkline-suggestion-folder", text: folder.path });
  }
}

/**
 * Whether `file` is still the vault's, as it may not be when it was deleted
 * while a list showed it; a notice says so when it is not.
 */
function stillThere(app: App, file: TFile): boolean {
  if (app.vault.getFileByPath(file.path) === file) return true;
  new Notice(`${nameOf(file)} was deleted, so it was not inserted.`);
  return false;
}

/**
 * Offers the vault's symbols as their name is typed after a trigger, such
 * as `;;tow`, and replaces the trigger and the name with the chosen one's
 * embed.
 */
export class SymbolSuggest extends EditorSuggest<TFile> {
  readonly #trigger: () => string;
  /** Whether the list last showed symbols, as it does when Esc closes it. */
  #listed = false;
  /** Whether the list is closing because a symbol was chosen. */
  #choosing = false;
  /**
   * The trigger whose list was dismissed, by its note, line, and column:
   * the text typed after it is text, until that trigger goes or moves.
   */
  #dismissed: { path: string; line: number; ch: number } | undefined;

  constructor(app: App, trigger: () => string) {
    super(app);
    this.#trigger = trigger;
    this.setInstructions([
      { command: "↑↓", purpose: "to choose" },
      { command: "↵", purpose: "to insert the symbol" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  override onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    const found = this.#find(cursor, editor, file);
    // A list that closes because no trigger is being typed any more, as when
    // a `[` after the name ends it, dismisses nothing.
    if (found === null) this.#listed = false;
    return found;
  }

  /** The trigger and name being typed before `cursor`, if any is listed. */
  #find(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (file === null) return null;
    const line = editor.getLine(cursor.line);
    const found = triggerQuery(line, cursor.ch, this.#trigger());
    const dismissed = this.#dismissed;
    if (
      dismissed !== undefined &&
      (found === undefined ||
        dismissed.path !== file.path ||
        dismissed.line !== cursor.line ||
        dismissed.ch !== found.start)
    ) {
      this.#dismissed = undefined;
    }
    if (found === undefined || this.#dismissed !== undefined) return null;
    // Not in code or front matter, where a trigger is the note's own text.
    if (
      insideCodeSpan(line, found.start) ||
      insideCodeBlock(
        (index) =>
          index < editor.lineCount() ? editor.getLine(index) : undefined,
        cursor.line,
      )
    ) {
      return null;
    }
    return {
      start: { line: cursor.line, ch: found.start },
      end: cursor,
      query: found.query,
    };
  }

  override getSuggestions(context: EditorSuggestContext): TFile[] {
    const found = findSymbols(this.app, context.query, context.file.path);
    this.#listed = found.length > 0;
    return found;
  }

  /**
   * Closes the list. Closed while it showed symbols for a trigger still
   * being typed, and not by a choice, as Esc or leaving the editor closes
   * it, it stays closed for that trigger, so that what is typed after it is
   * text. Obsidian also closes it when nothing matches, or when the trigger
   * ends, which dismisses nothing.
   */
  override close(): void {
    const { context } = this;
    if (this.#listed && !this.#choosing && context !== null) {
      this.#dismissed = {
        path: context.file.path,
        line: context.start.line,
        ch: context.start.ch,
      };
    }
    this.#listed = false;
    this.#choosing = false;
    super.close();
  }

  override renderSuggestion(file: TFile, el: HTMLElement): void {
    renderSymbol(this.app, file, el);
  }

  override selectSuggestion(file: TFile): void {
    const { context } = this;
    if (context === null) return;
    // Closed by a choice, the list dismisses nothing, unless its symbol has
    // gone, below.
    this.#choosing = true;
    if (!stillThere(this.app, file)) {
      // Dismissed, so that Obsidian's next look at the trigger, which can
      // still be due from the last key typed, does not list it again.
      this.#dismissed = {
        path: context.file.path,
        line: context.start.line,
        ch: context.start.ch,
      };
      this.close();
      return;
    }
    const { editor, start } = context;
    // Obsidian updates the context a moment after each change, so a choice
    // made straight after typing finds the end of the name anew, as far as
    // the cursor, when the same trigger still starts it.
    const cursor = editor.getCursor();
    const found =
      cursor.line === start.line
        ? triggerQuery(editor.getLine(cursor.line), cursor.ch, this.#trigger())
        : undefined;
    const end = found?.start === start.ch ? cursor : context.end;
    editor.replaceRange(
      embedFor(this.app, file, context.file.path),
      start,
      end,
    );
    this.close();
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
    if (!stillThere(this.app, file)) return;
    this.#chosen(embedFor(this.app, file, this.#notePath));
  }
}
