// Inserting a symbol you already have: a suggestion that opens as you type a
// trigger and a few letters of its name, reading, or translation, and a
// searchable list for a command. Both list the vault's symbols with their
// pictures, as search.ts ranks them, and insert a plain embed.

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
import { insideCode } from "./code.ts";
import { embedFor } from "./embeds.ts";
import { symbolStem } from "./names.ts";
import {
  findText,
  holdsTyped,
  rankSymbols,
  textQuery,
  triggerQuery,
  type Candidate,
  type FoundText,
} from "./search.ts";
import { showValues } from "./text-fields.ts";
import type { SymbolTextIndex } from "./text-index.ts";

/** The most symbols a list shows at once. */
const shownAtMost = 50;

/** The vault's symbols' text, as a list reads it. */
export type SymbolTexts = SymbolTextIndex<TFile>;

/**
 * A line for a list that may be missing symbols, as the index has not read
 * every file yet, when it starts or after much has changed.
 */
const stillReading = {
  command: "…",
  purpose: "still reading symbols, so more may match",
};

/** What the list shows under a suggestion's rows. */
const instructions = [
  { command: "↑↓", purpose: "to choose" },
  { command: "↵", purpose: "to insert the symbol" },
  { command: "esc", purpose: "to dismiss" },
];

/** Below any match, as a value's match is sure to have a score of its own. */
const lowestScore = -1e9;

/** A symbol that matched, and the value that did where its name did not. */
export interface SymbolMatch extends Candidate {
  readonly file: TFile;
  readonly found?: FoundText;
}

/** A symbol's name: its file's name without `.ink.png`. */
function nameOf(file: TFile): string {
  return symbolStem(file.name) ?? file.basename;
}

/**
 * The vault's symbols whose names match `query`, as Obsidian's fuzzy search
 * matches them, or with a reading or translation that holds it, best first: by
 * the match, then by how often the note at `notePath` uses each, then by how
 * recently each changed. An empty query matches every symbol. A query with a
 * space matches only names and values that hold it, so that a sentence typed on
 * after a trigger stops matching. A value must hold what was typed: a fuzzy
 * match of the words of a translation would find nearly anything.
 */
export function matchSymbols(
  app: App,
  texts: SymbolTexts,
  query: string,
  notePath: string,
): SymbolMatch[] {
  const typed = query.trim();
  const match = typed === "" ? undefined : prepareFuzzySearch(typed);
  const wanted = textQuery(typed);
  const matchKey =
    wanted === undefined ? undefined : prepareFuzzySearch(wanted.needle);
  const uses = app.metadataCache.resolvedLinks[notePath] ?? {};
  const candidates = app.vault
    .getFiles()
    .filter((file) => isInkPath(file.path))
    .flatMap((file): SymbolMatch[] => {
      const name = nameOf(file);
      const named =
        query.includes(" ") && !holdsTyped(name, query)
          ? null
          : match === undefined
            ? { score: 0 }
            : match(name);
      const text = wanted && texts.textOf(file);
      const found = wanted && text && findText(text, wanted);
      if (named === null && found === undefined) return [];
      const valued = found && matchKey?.(found.key);
      return [
        {
          file,
          name,
          path: file.path,
          score: Math.max(
            named?.score ?? lowestScore,
            valued?.score ?? lowestScore,
          ),
          byName: named !== null,
          uses: uses[file.path] ?? 0,
          modified: file.stat.mtime,
          // A name that holds what was typed needs no explaining; a fuzzy
          // match of one, as `ta` in `tower gate`, may well.
          ...(found === undefined || holdsTyped(name, typed) ? {} : { found }),
        },
      ];
    });
  return rankSymbols(candidates);
}

/** The first symbols of {@link matchSymbols}, as many as a list shows. */
export function findSymbols(
  app: App,
  texts: SymbolTexts,
  query: string,
  notePath: string,
): SymbolMatch[] {
  return matchSymbols(app, texts, query, notePath).slice(0, shownAtMost);
}

/**
 * Shows a symbol in a list: its picture, its name, its folder, and the value
 * `found` that it was found by, so that a match with another name is no mystery.
 */
export function renderSymbol(
  app: App,
  file: TFile,
  el: HTMLElement,
  found?: FoundText,
): void {
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
  if (found !== undefined) showValues(text, found.field, [found.value]);
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
export class SymbolSuggest extends EditorSuggest<SymbolMatch> {
  readonly #trigger: () => string;
  readonly #texts: SymbolTexts;
  /** Whether the list last showed symbols, as it does when Esc closes it. */
  #listed = false;
  /** Whether the list is closing because a symbol was chosen. */
  #choosing = false;
  /**
   * The trigger whose list was dismissed, by its note, line, and column:
   * the text typed after it is text, until that trigger goes or moves.
   */
  #dismissed: { path: string; line: number; ch: number } | undefined;

  constructor(app: App, trigger: () => string, texts: SymbolTexts) {
    super(app);
    this.#trigger = trigger;
    this.#texts = texts;
    this.setInstructions(instructions);
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
    const lines = editor.lineCount();
    if (
      insideCode(
        (index) => (index < lines ? editor.getLine(index) : undefined),
        cursor.line,
        found.start,
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

  override getSuggestions(context: EditorSuggestContext): SymbolMatch[] {
    const found = findSymbols(
      this.app,
      this.#texts,
      context.query,
      context.file.path,
    );
    this.#listed = found.length > 0;
    this.setInstructions(
      this.#texts.reading ? [...instructions, stillReading] : instructions,
    );
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

  override renderSuggestion(match: SymbolMatch, el: HTMLElement): void {
    renderSymbol(this.app, match.file, el, match.found);
  }

  override selectSuggestion({ file }: SymbolMatch): void {
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

/**
 * The vault's symbols to search, inserting the one chosen. It closes as
 * `unloaded` aborts, when Inkline unloads, as Obsidian leaves a plugin's
 * dialogs open, and a choice that still reaches it then inserts nothing.
 */
export class SymbolSearch extends SuggestModal<SymbolMatch> {
  readonly #texts: SymbolTexts;
  readonly #notePath: string;
  readonly #unloaded: AbortSignal;
  readonly #chosen: (embed: string) => void;
  readonly #unload = (): void => {
    this.close();
  };

  constructor(
    app: App,
    texts: SymbolTexts,
    notePath: string,
    unloaded: AbortSignal,
    chosen: (embed: string) => void,
  ) {
    super(app);
    this.#texts = texts;
    this.#notePath = notePath;
    this.#unloaded = unloaded;
    this.#chosen = chosen;
    this.setPlaceholder("Insert which symbol?");
    this.emptyStateText = "No symbol has that name, reading, or translation.";
  }

  // The list listens for the unload from when it opens until it closes: one
  // never opened has nothing to close, and the signal lasts as long as Inkline
  // does, so the list stops listening to it as it closes.
  override onOpen(): Promise<void> | void {
    this.#unloaded.addEventListener("abort", this.#unload, { once: true });
    return super.onOpen();
  }

  override onClose(): void {
    this.#unloaded.removeEventListener("abort", this.#unload);
    super.onClose();
  }

  override getSuggestions(query: string): SymbolMatch[] {
    this.setInstructions(this.#texts.reading ? [stillReading] : []);
    return findSymbols(this.app, this.#texts, query, this.#notePath);
  }

  override renderSuggestion(match: SymbolMatch, el: HTMLElement): void {
    renderSymbol(this.app, match.file, el, match.found);
  }

  override onChooseSuggestion({ file }: SymbolMatch): void {
    if (this.#unloaded.aborted || !stillThere(this.app, file)) return;
    this.#chosen(embedFor(this.app, file, this.#notePath));
  }
}
