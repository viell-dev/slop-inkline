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

/** Whether a note's metadata makes it a lexicon. */
function isLexicon(cache: CachedMetadata | null | undefined): boolean {
  return cache?.frontmatter?.["inkline"] === "lexicon";
}

/** The cells of a table row: their text and where each starts and ends. */
function cells(row: string): { text: string; from: number; to: number }[] {
  const bars: number[] = [];
  let inLink = 0;
  for (let at = 0; at < row.length; at++) {
    if (row.startsWith("[[", at)) inLink++;
    if (row.startsWith("]]", at) && inLink > 0) inLink--;
    if (row[at] === "|" && row[at - 1] !== "\\" && inLink === 0) {
      bars.push(at);
    }
  }
  const found: { text: string; from: number; to: number }[] = [];
  const starts = row.trimStart().startsWith("|") ? bars : [-1, ...bars];
  for (let index = 0; index < starts.length; index++) {
    const from = (starts[index] ?? 0) + 1;
    const to = starts[index + 1] ?? row.length;
    if (index === starts.length - 1 && row.slice(from).trim() === "") break;
    found.push({ text: row.slice(from, to), from, to });
  }
  return found;
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

  async rebuild(): Promise<void> {
    const { metadataCache, vault } = this.#app;
    const entries = new Map<string, WordEntry>();
    const notes = new Set<string>();
    let longest = 0;
    for (const file of vault.getMarkdownFiles()) {
      const cache = metadataCache.getFileCache(file);
      if (!isLexicon(cache)) continue;
      notes.add(file.path);
      const lines = (await vault.cachedRead(file)).split("\n");
      const embeds = cache?.embeds ?? [];
      for (const section of cache?.sections ?? []) {
        if (section.type !== "table") continue;
        // After the header and the line under it.
        const first = section.position.start.line + 2;
        for (let line = first; line <= section.position.end.line; line++) {
          const row = cells(lines[line] ?? "");
          const word = row[0];
          if (word === undefined) continue;
          const here = embeds
            .filter(
              (embed) =>
                embed.position.start.line === line &&
                embed.position.start.col >= word.from &&
                embed.position.end.col <= word.to,
            )
            .sort((a, b) => a.position.start.col - b.position.start.col);
          if (here.length === 0) continue;
          // One word: its symbols with nothing between them.
          const apart = here.some(
            (embed, index) =>
              index > 0 &&
              embed.position.start.col !==
                (here[index - 1]?.position.end.col ?? -1),
          );
          if (apart) continue;
          const paths: string[] = [];
          for (const embed of here) {
            const target = metadataCache.getFirstLinkpathDest(
              getLinkpath(embed.link),
              file.path,
            );
            if (target === null || !isInkPath(target.path)) break;
            paths.push(target.path);
          }
          if (paths.length !== here.length) continue;
          const reading = row[1]?.text.trim() ?? "";
          const meaning = row[2]?.text.trim() ?? "";
          if (reading === "" && meaning === "") continue;
          const key = wordKey(paths);
          if (entries.has(key)) continue;
          entries.set(key, {
            ...(reading === "" ? {} : { reading }),
            ...(meaning === "" ? {} : { meaning }),
          });
          longest = Math.max(longest, paths.length);
        }
      }
    }
    this.#lexicon = { entries, longest };
    this.#notes = notes;
    this.builds.push(Date.now());
    this.#changed();
  }
}

/** Asks Live Preview to group its words again, as the lexicon changed. */
export const refreshWords = StateEffect.define<null>();

/** A wiki embed or a Markdown image, and the link of either. */
const embedPattern =
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
