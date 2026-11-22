// What Inkline's work on symbol files shares for one load of the plugin.
//
// Obsidian makes a new instance of the plugin for each load, and main.ts makes
// one SymbolFiles in it, once, which the editors it opens and its library views
// are given. Each load has its own, so nothing of one load's writes waits on, or
// is refused by, another's.

import type { App, TFile } from "obsidian";
import { SymbolWrites } from "./symbol-writes.ts";

/** What Inkline's writes of symbol files share. */
export interface SymbolFiles {
  readonly app: App;
  /** Aborts as the plugin unloads; nothing is written once it has. */
  readonly unloaded: AbortSignal;
  /**
   * Every write of a symbol's file, in one line, with the look an editor's
   * save takes, as {@link SymbolWrites} says.
   */
  readonly writes: SymbolWrites<TFile>;
}

/**
 * The {@link SymbolFiles} of one load of the plugin: its `folder`, where a save
 * that makes a symbol's file writes it first, `unloaded`, which aborts as the
 * load ends, and `refreshed`, which has the text index read a file a save wrote.
 */
export function symbolFiles(
  app: App,
  folder: string,
  unloaded: AbortSignal,
  refreshed: (file: TFile) => Promise<void>,
): SymbolFiles {
  return {
    app,
    unloaded,
    writes: new SymbolWrites(app.vault, folder, unloaded, refreshed),
  };
}
