// PROTOTYPE for #167, section 3, not for release: the lexicon, a word list
// kept as notes, and words in Live Preview.
//
// A lexicon is a note whose `inkline` property says `lexicon`. Each row of a
// table in it is a word: its first cell holds the word's symbols as embeds,
// with nothing between them, its second the word's reading, if the symbols'
// own do not make it, and its third its meaning. Because the symbols are
// ordinary embeds, Obsidian updates them when a symbol is renamed, and the
// note reads as a word list without Inkline.

import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type App,
  type CachedMetadata,
  editorInfoField,
  editorLivePreviewField,
  getLinkpath,
  TFile,
} from "obsidian";
import { isInkPath } from "../format/ink-file.ts";
import {
  emptyLexicon,
  type Lexicon,
  segment,
  wordAttributes,
  wordClass,
  type WordEntry,
  wordKey,
} from "../render/words.ts";
import { cells, columnsOf, type Columns } from "./lexicon-table.ts";
export {
  changedRow,
  columnsOf,
  newRow,
  rowCells,
  type Columns,
} from "./lexicon-table.ts";

/** Whether a note's metadata makes it a lexicon. */
function isLexicon(cache: CachedMetadata | null | undefined): boolean {
  return cache?.frontmatter?.["inkline"] === "lexicon";
}

/** The vault's lexicon notes, read into one lexicon. */
export class LexiconIndex {
  readonly #app: App;
  readonly #changed: () => void;
  #lexicon: Lexicon = emptyLexicon;
  #notes = new Set<string>();
  #timer: number | undefined;
  /** When each rebuild finished, for the prototype's measurements. */
  readonly builds: number[] = [];

  constructor(app: App, changed: () => void) {
    this.#app = app;
    this.#changed = changed;
  }

  get lexicon(): Lexicon {
    return this.#lexicon;
  }

  /** Whether a change to `file` with `cache` could change the lexicon. */
  concerns(file: TFile, cache?: CachedMetadata | null): boolean {
    return this.#notes.has(file.path) || isLexicon(cache);
  }

  /** Reads the lexicon again soon, once for many changes. */
  schedule(): void {
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      void this.rebuild();
    }, 30);
  }

  stop(): void {
    window.clearTimeout(this.#timer);
  }

  /** PROTOTYPE (#167, section 5): everything the lexicon notes say. */
  get dictionary(): Dictionary {
    return this.#dictionary;
  }

  #dictionary: Dictionary = emptyDictionary;

  /** PROTOTYPE: a symbol's own main translation, for a literal gloss. */
  translationOf: (path: string) => string | undefined = () => undefined;

  async rebuild(): Promise<void> {
    const { metadataCache, vault } = this.#app;
    const entries = new Map<string, WordEntry>();
    const notes = new Set<string>();
    const rows: DictionaryRow[] = [];
    const byKey = new Map<string, DictionaryRow>();
    const builtWith = new Map<string, Set<string>>();
    const inWords = new Map<string, Set<string>>();
    const nameOf = (path: string) =>
      path.replace(/^.*\//, "").replace(/\.ink\.png$/i, "");
    let longest = 0;
    for (const file of vault.getMarkdownFiles()) {
      const cache = metadataCache.getFileCache(file);
      if (!isLexicon(cache)) continue;
      notes.add(file.path);
      const lines = (await vault.cachedRead(file)).split("\n");
      const embeds = cache?.embeds ?? [];
      /** The symbols linked in `line` between columns `from` and `to`. */
      const symbolsIn = (line: number, from: number, to: number) =>
        embeds
          .filter(
            (embed) =>
              embed.position.start.line === line &&
              embed.position.start.col >= from &&
              embed.position.end.col <= to,
          )
          .sort((a, b) => a.position.start.col - b.position.start.col);
      const resolve = (link: string): string | undefined => {
        const target = metadataCache.getFirstLinkpathDest(
          getLinkpath(link),
          file.path,
        );
        return target === null || !isInkPath(target.path)
          ? undefined
          : target.path;
      };
      for (const section of cache?.sections ?? []) {
        if (section.type !== "table") continue;
        const header = section.position.start.line;
        const columns = columnsOf(cells(lines[header] ?? ""));
        // After the header and the line under it.
        const first = header + 2;
        for (let line = first; line <= section.position.end.line; line++) {
          const row = cells(lines[line] ?? "");
          const word = row[columns.word];
          if (word === undefined) continue;
          const here = symbolsIn(line, word.from, word.to);
          if (here.length === 0) continue;
          // One word: its symbols with nothing between them.
          const apart = here.some(
            (embed, index) =>
              index > 0 &&
              embed.position.start.col !==
                (here[index - 1]?.position.end.col ?? -1),
          );
          if (apart) continue;
          const paths = here.flatMap((embed) => resolve(embed.link) ?? []);
          if (paths.length !== here.length) continue;
          const reading =
            columns.reading === undefined
              ? ""
              : (row[columns.reading]?.text.trim() ?? "");
          const meaning =
            columns.meaning === undefined
              ? ""
              : (row[columns.meaning]?.text.trim() ?? "");
          // What a symbol is made of, with an IDS-like layout between them.
          const partsCell =
            columns.parts === undefined ? undefined : row[columns.parts];
          const partEmbeds =
            partsCell === undefined
              ? []
              : symbolsIn(line, partsCell.from, partsCell.to);
          const parts = partEmbeds.flatMap(
            (embed) => resolve(embed.link) ?? [],
          );
          let structure: string | undefined;
          if (partsCell !== undefined && parts.length > 0) {
            const text = lines[line] ?? "";
            let shown = "";
            let at = partsCell.from;
            for (const [index, embed] of partEmbeds.entries()) {
              shown += text.slice(at, embed.position.start.col);
              shown += ` ${nameOf(parts[index] ?? embed.link)} `;
              at = embed.position.end.col;
            }
            shown += text.slice(at, partsCell.to);
            structure = shown.replace(/\s+/g, " ").trim();
          }
          const key = wordKey(paths);
          if (byKey.has(key)) continue;
          const entryRow: DictionaryRow = {
            note: file.path,
            line,
            columns,
            paths,
            ...(reading === "" ? {} : { reading }),
            ...(meaning === "" ? {} : { meaning }),
            ...(parts.length === 0 ? {} : { parts }),
            ...(structure === undefined ? {} : { structure }),
          };
          rows.push(entryRow);
          byKey.set(key, entryRow);
          if (paths.length === 1 && parts.length > 0) {
            for (const part of parts) {
              const users = builtWith.get(part) ?? new Set<string>();
              users.add(paths[0] ?? "");
              builtWith.set(part, users);
            }
          }
          if (paths.length > 1) {
            for (const path of paths) {
              const words = inWords.get(path) ?? new Set<string>();
              words.add(key);
              inWords.set(path, words);
            }
          }
          if (reading === "" && meaning === "") continue;
          const own = paths.map((path) => this.translationOf(path));
          // Only for a compound of symbols that each mean something: a
          // syllable has no meaning to show.
          const literal =
            paths.length > 1 && own.every((value) => value !== undefined)
              ? own.join(" + ")
              : undefined;
          entries.set(key, {
            ...(reading === "" ? {} : { reading }),
            ...(meaning === "" ? {} : { meaning }),
            ...(literal === undefined ? {} : { literal }),
          });
          longest = Math.max(longest, paths.length);
        }
      }
    }
    this.#lexicon = { entries, longest };
    this.#dictionary = { rows, byKey, builtWith, inWords };
    currentDictionary = this.#dictionary;
    this.#notes = notes;
    this.builds.push(Date.now());
    this.#changed();
  }
}

/** PROTOTYPE: a row of a lexicon note. */
export interface DictionaryRow {
  readonly note: string;
  /** Its line in the note, from 0. */
  readonly line: number;
  readonly columns: Columns;
  /** The word's symbols, or the one symbol a composition row is about. */
  readonly paths: readonly string[];
  readonly reading?: string;
  readonly meaning?: string;
  /** The symbols a one-symbol row says it is made of, in order. */
  readonly parts?: readonly string[];
  /** The parts cell with names for its embeds, such as `⿰ left adult`. */
  readonly structure?: string;
}

/** PROTOTYPE: what every lexicon note says, with indexes built from it. */
export interface Dictionary {
  readonly rows: readonly DictionaryRow[];
  readonly byKey: ReadonlyMap<string, DictionaryRow>;
  /** Each part's path, and the symbols made with it: a radical index. */
  readonly builtWith: ReadonlyMap<string, ReadonlySet<string>>;
  /** Each symbol's path, and the keys of the words it is written in. */
  readonly inWords: ReadonlyMap<string, ReadonlySet<string>>;
}

export const emptyDictionary: Dictionary = {
  rows: [],
  byKey: new Map(),
  builtWith: new Map(),
  inWords: new Map(),
};

/** PROTOTYPE: the dictionary now, for the library to show. */
let currentDictionary: Dictionary = emptyDictionary;

export function prototypeDictionary(): Dictionary {
  return currentDictionary;
}

/** Asks Live Preview to group its words again, as the lexicon changed. */
export const refreshWords = StateEffect.define<null>();

/** A wiki embed or a Markdown image, and the link of either. */
export const embedPattern =
  /!\[\[([^[\]|#^]+?)(?:#[^[\]|]*)?(?:\|[^[\]]*)?\]\]|!\[[^[\]]*\]\(([^()\s]+)\)/g;

/**
 * Marks each word Live Preview shows, around Obsidian's own embeds: a mark
 * that wraps the widgets of the word's symbols, with its values as
 * attributes, which styles.css shows. A word the selection touches stays
 * unmarked, as Obsidian shows a link being edited as its text.
 */
export function wordsExtension(
  lexicon: () => Lexicon,
  resolve: (link: string, from: string) => string | undefined,
  views: Set<EditorView>,
): ViewPlugin<{ decorations: DecorationSet }> {
  const build = (view: EditorView): DecorationSet => {
    const state = view.state;
    if (state.field(editorLivePreviewField, false) !== true) {
      return Decoration.none;
    }
    const from = state.field(editorInfoField, false)?.file?.path ?? "";
    const known = lexicon();
    const builder = new RangeSetBuilder<Decoration>();
    let done = -1;
    for (const range of view.visibleRanges) {
      for (let pos = range.from; pos <= range.to; ) {
        const line = state.doc.lineAt(pos);
        pos = line.to + 1;
        if (line.from <= done) continue;
        done = line.from;
        const runs: { from: number; to: number; path: string }[][] = [];
        let run: { from: number; to: number; path: string }[] = [];
        let last = -1;
        for (const match of line.text.matchAll(embedPattern)) {
          let link = match[1];
          if (link === undefined) {
            try {
              link = decodeURIComponent(match[2] ?? "");
            } catch {
              link = match[2] ?? "";
            }
          }
          const start = line.from + match.index;
          const end = start + match[0].length;
          const path = resolve(link, from);
          if (path === undefined || start !== last) {
            if (run.length > 0) runs.push(run);
            run = [];
          }
          if (path !== undefined) run.push({ from: start, to: end, path });
          last = end;
        }
        if (run.length > 0) runs.push(run);
        for (const each of runs) {
          for (const piece of segment(
            each.map((unit) => unit.path),
            known,
          )) {
            if (piece.entry === undefined) continue;
            const a = each[piece.start]?.from ?? 0;
            const b = each[piece.end - 1]?.to ?? 0;
            if (
              state.selection.ranges.some(
                (selected) => selected.from <= b && selected.to >= a,
              )
            ) {
              continue;
            }
            builder.add(
              a,
              b,
              Decoration.mark({
                class: wordClass,
                attributes: wordAttributes(piece.entry),
                inclusive: true,
              }),
            );
          }
        }
      }
    }
    return builder.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      readonly #view: EditorView;
      constructor(view: EditorView) {
        this.#view = view;
        views.add(view);
        this.decorations = build(view);
      }
      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.startState.field(editorLivePreviewField, false) !==
            update.state.field(editorLivePreviewField, false) ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(refreshWords)),
          )
        ) {
          this.decorations = build(update.view);
        }
      }
      destroy(): void {
        views.delete(this.#view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/** Resolves a link in a note to the path of the symbol it names, if one. */
export function symbolPath(
  app: App,
  link: string,
  from: string,
): string | undefined {
  const target = app.metadataCache.getFirstLinkpathDest(
    getLinkpath(link),
    from,
  );
  return target instanceof TFile && isInkPath(target.path)
    ? target.path
    : undefined;
}
