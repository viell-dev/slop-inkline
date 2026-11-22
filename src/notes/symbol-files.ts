// What Inkline's work on symbol files shares for one load of the plugin.
//
// Obsidian makes a new instance of the plugin for each load, and main.ts makes
// one SymbolFiles in it, once, which the editors it opens and its library
// views are given. Each load has its own, so nothing of one load's writes
// waits on, or is refused by, another's.

import type { App, TFile } from "obsidian";
import { pathIn } from "./symbol-paths.ts";
import { SymbolWrites } from "./symbol-writes.ts";

/** What Inkline's writes and renames of symbol files share. */
export interface SymbolFiles {
  readonly app: App;
  /**
   * Aborts as the plugin unloads. What looks at it, and what then stops, is
   * said where it is read: `SymbolWrites`, the renames, and the editors' saves.
   */
  readonly unloaded: AbortSignal;
  /**
   * Every write of a symbol's file, in one line, with the look an editor's
   * save takes, as {@link SymbolWrites} says.
   */
  readonly writes: SymbolWrites<TFile>;
  /**
   * The symbols Obsidian is renaming for Inkline, from the call to its
   * `renameFile` until that ends, which lasts as long as its question about
   * links. A second rename of one of them is refused at once, as a failed
   * rename is, rather than waiting behind the first for as long as that takes.
   *
   * This covers Inkline's own renames of one symbol, not every rename Obsidian
   * puts off. Asked for a rename of any file while it is moving the files of
   * another, Obsidian takes it into that one: it says it has renamed the file
   * at once, and moves it once the other's moves end, so nothing could tell
   * whether the name was given. `renameSaved` asks only once Obsidian is moving
   * nothing, where `moveWaits` can see that. Where it cannot, `watchMove` finds
   * the file not yet moved when Obsidian says it is done.
   */
  readonly beingRenamed: WeakSet<TFile>;
}

/**
 * The {@link SymbolFiles} of one load of the plugin: its `folder`, where a
 * save that makes a symbol's file writes it first, `unloaded`, which aborts as
 * the load ends, and `refreshed`, which has the text index read a file a save
 * wrote.
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
    writes: new SymbolWrites(app.vault, folder, unloaded, refreshed, pathIn),
    beingRenamed: new WeakSet(),
  };
}
