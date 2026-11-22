// Renaming a symbol's file through Obsidian, so that the links to it follow as
// Obsidian's settings say: after an editor's save, and from the library, with
// or without its text. Every rename of a symbol comes through renameSaved.
//
// What is checked and when: a rename is checked as it is asked, with
// renamingOf or checkRename, and again, with confirmRenaming, immediately
// before Obsidian's renameFile is called, once the open notes are saved and
// Obsidian's own waits are clear, so that nothing waits between that check and
// Obsidian's move. A second rename of a file Obsidian is still renaming for
// Inkline is refused at once, through the set SymbolFiles keeps for each load.
// Nothing is renamed once the load's unload signal has aborted. The one write
// after that is the embed a new symbol's editor follows to the name Obsidian
// has already given its file, which nothing could take back.

import {
  MarkdownView,
  Notice,
  type App,
  type TAbstractFile,
  type TFile,
} from "obsidian";
import { inkExtension } from "../format/ink-file.ts";
import { markNotice, message } from "../notices.ts";
import {
  RenameDisturbed,
  watchRename,
  type RenameWait,
} from "./file-writes.ts";
import { sameText } from "./insertion.ts";
import { symbolStem, type NameChoice } from "./names.ts";
import type { SymbolFiles } from "./symbol-files.ts";
import { chosen, claimName, pathIn } from "./symbol-paths.ts";
import {
  parentPath,
  present,
  stillAlive,
  stillSymbol,
  type SymbolWork,
} from "./symbol-writes.ts";

/**
 * Throws if Obsidian is renaming `file` for Inkline, as
 * {@link SymbolFiles.beingRenamed} says.
 */
function notBeingRenamed(files: SymbolFiles, file: TFile): void {
  if (files.beingRenamed.has(file)) {
    throw new Error("Obsidian is still renaming this symbol.");
  }
}

/**
 * Saves every open note whose editor holds text its file lacks, or throws
 * without going on if one cannot be saved. A save that fails rejects, and on
 * Obsidian 1.13 one that comes during another returns before its text is
 * written, so the file is read again to be sure.
 *
 * Each read waits, and a note found saved can be typed in while a later one is
 * read. So this returns a check, which waits for nothing, of whether every open
 * note's editor still holds the text found saved in it; a note opened since, or
 * one whose tab shows another note now, has not been looked at, and fails it.
 * Once `unloaded` aborts, it saves no more notes, and throws.
 */
async function saveOpenNotes(
  app: App,
  unloaded: AbortSignal,
): Promise<() => boolean> {
  const found = new Map<MarkdownView, { file: TFile; text: string }>();
  for (const { view } of app.workspace.getLeavesOfType("markdown")) {
    if (!(view instanceof MarkdownView) || view.file === null) continue;
    const { file } = view;
    /** What the editor holds, if the file holds it too. */
    const saved = async (): Promise<string | undefined> => {
      const text = await app.vault.read(file);
      const shown = view.getViewData();
      return sameText(text, shown) ? shown : undefined;
    };
    let text = await saved();
    if (text === undefined) {
      stillAlive(unloaded);
      // Obsidian reports a save that fails, and keeps the editor's text.
      text = await view.save().then(saved, () => undefined);
    }
    if (text === undefined) {
      throw new Error(`the note ${file.basename} could not be saved first`);
    }
    found.set(view, { file, text });
  }
  return () =>
    app.workspace.getLeavesOfType("markdown").every(({ view }) => {
      if (!(view instanceof MarkdownView) || view.file === null) return true;
      const seen = found.get(view);
      return seen?.file === view.file && seen.text === view.getViewData();
    });
}

/**
 * How many times a rename goes through the open notes, for one typed in while
 * they were being saved, before it gives up.
 */
const notePasses = 3;

/**
 * Waits for `waiting`, or until `unloaded` aborts, whichever comes first. The
 * signal lasts as long as Inkline does, so this stops listening to it once the
 * wait ends.
 */
async function unlessUnloaded(
  waiting: Promise<void>,
  unloaded: AbortSignal,
): Promise<void> {
  if (unloaded.aborted) return;
  let unload = (): void => undefined;
  const aborted = new Promise<void>((resolve) => {
    unload = resolve;
  });
  unloaded.addEventListener("abort", unload, { once: true });
  try {
    await Promise.race([waiting, aborted]);
  } finally {
    unloaded.removeEventListener("abort", unload);
  }
}

/** The notes that link to the file at `path`, as Obsidian last indexed them. */
function notesLinking(app: App, path: string): Set<string> {
  const notes = new Set<string>();
  const { resolvedLinks } = app.metadataCache;
  for (const [note, targets] of Object.entries(resolvedLinks)) {
    if ((targets[path] ?? 0) > 0) notes.add(note);
  }
  return notes;
}

/**
 * A rename of a symbol's file, as {@link renamingOf} checked it: the file, the
 * path it had then, and the name it takes in that path's folder.
 */
export interface Renaming {
  readonly file: TFile;
  /** Where the file was when its new name was checked. */
  readonly from: string;
  /** The file's name then, which notices call it by. */
  readonly fileName: string;
  /** The new name, without `.ink.png`. */
  readonly name: string;
  /** The new path, in the folder of `from`. */
  readonly to: string;
}

/**
 * Throws unless `renaming` still holds as it was checked: its file is still the
 * vault's file at the path it had then, which one deleted, replaced by another
 * file at that path, or renamed elsewhere is not, and no other file in that
 * folder has come by the new name. The name's own rules depend only on what was
 * typed and the file's name, which that keeps as it was.
 */
function confirmRenaming(app: App, renaming: Renaming): void {
  const { file, from, name } = renaming;
  if (app.vault.getFileByPath(from) !== file) {
    throw new Error(
      present(app.vault, file)
        ? `the file was renamed to ${file.path} meanwhile`
        : "the file was deleted or replaced meanwhile",
    );
  }
  claimName(app, parentPath(from), name, file);
}

/**
 * What Obsidian's `renameFile` waits for before it moves a file, as far as
 * {@link moveWaits} can see it.
 */
interface MoveWaits {
  /**
   * Whether `renameFile`, called now, would reach its move without waiting for
   * anything: no rename moving files, none queued or asking about links, and
   * the index caught up with the whole vault. Waits for nothing.
   */
  readonly clear: () => boolean;
  /**
   * Waits for the renames queued now, and then for the index, as `renameFile`
   * would. More can start meanwhile, so {@link MoveWaits.clear} is asked
   * again once it ends.
   */
  readonly settle: () => Promise<void>;
}

/**
 * What Obsidian's `renameFile` waits for, where this version of Obsidian keeps
 * it, or undefined, which leaves a rename as it was without this. None of it is
 * in Obsidian's API, so this is the one place that reads it, and anything of
 * another shape counts as missing (#10). It can go once Obsidian's API has a
 * rename that moves a file only if it is still at its path, or a way to know
 * that `renameFile` will not wait.
 *
 * In Obsidian 1.13.4 and 1.15.0, `renameFile` hands the move to the file
 * manager's `runAsyncLinkUpdate`. While another rename is moving its files,
 * which `inProgressUpdates` shows, that takes the move into that rename and
 * resolves at once. Otherwise it queues the move on `updateQueue`, a promise
 * chain behind every rename still moving files or asking about links, and then
 * waits for the metadata cache's `onCleanCache`, which is when `isCacheClean`
 * finds every file indexed and its links resolved. Only then does `vault.rename`
 * move whatever is at the file's path, without checking that it is still the
 * file. With all of that clear, `renameFile` reaches `vault.rename` within
 * microtasks, before any event, timer, or person can come between, and that
 * takes the file's path at once. The disk still does first what Obsidian had
 * begun to do before, which {@link watchMove} hears of.
 *
 * The public `resolved` event cannot stand in for this: it comes only when the
 * links were being resolved, so a wait for it, with the cache already clean,
 * would never end, and it says nothing of the index or the queue.
 */
function moveWaits(app: App): MoveWaits | undefined {
  const cache = app.metadataCache;
  const manager = app.fileManager;
  const isCacheClean: unknown = Reflect.get(cache, "isCacheClean");
  const onCleanCache: unknown = Reflect.get(cache, "onCleanCache");
  const queue: unknown = Reflect.get(manager, "updateQueue");
  /** The promise that the last rename queued ends with. */
  const last = (): unknown =>
    typeof queue === "object" && queue !== null
      ? Reflect.get(queue, "promise")
      : undefined;
  /** An array while a rename moves its files, of those taken into it. */
  const moving = (): unknown => Reflect.get(manager, "inProgressUpdates");
  const idle = moving();
  if (
    typeof isCacheClean !== "function" ||
    typeof onCleanCache !== "function" ||
    !(last() instanceof Promise) ||
    !(idle === null || Array.isArray(idle))
  ) {
    return undefined;
  }
  const clean = (): boolean => Boolean(Reflect.apply(isCacheClean, cache, []));
  const ignore = (): void => undefined;
  /** The last queued rename's promise, once it was seen to end. */
  let ended: unknown;
  /**
   * Set once Obsidian is found not to work as read above, so that a wait that
   * could never end, or never wait, is not waited for.
   */
  let unlike = false;
  return {
    clear: () => unlike || (moving() === null && last() === ended && clean()),
    settle: async () => {
      const queued = last();
      try {
        if (queued instanceof Promise) await queued.then(ignore, ignore);
        await new Promise<void>((resolve) => {
          Reflect.apply(onCleanCache, cache, [resolve]);
        });
      } catch {
        unlike = true;
      }
      ended = queued;
      // Every rename queued has ended, which leaves none moving files.
      if (last() === queued && clean() && moving() !== null) unlike = true;
    },
  };
}

/** What {@link watchMove} heard of a rename once Obsidian had it. */
interface Move {
  /**
   * What came between the check and Obsidian's move of the file, if anything,
   * with where the file is now. Once Obsidian is `done`, with no move heard
   * of, that it has not moved it; once it has failed, with the file at the new
   * path all the same, that it has the new name.
   */
  readonly disturbed: (done: boolean) => RenameDisturbed | undefined;
  readonly stop: () => void;
}

/**
 * Listens, from Inkline's last check of `renaming` until Obsidian moves the
 * file, for anything else created, deleted, or renamed at the file's path or
 * the new one, in any letter case, as Windows and macOS read names. Obsidian
 * moves whatever is at the file's path, and nothing can stop a move it has
 * begun, so this only tells: a change Obsidian had begun to write before the
 * move, one made outside Obsidian at that moment, or, without
 * {@link moveWaits}, one in Obsidian's own wait.
 *
 * A report takes where the file is from the file itself, which the vault
 * keeps up to date, and not from what is at the new path, which can have come
 * there any way. It says that Obsidian moved something only once Obsidian's
 * rename went through, which moves nothing onto a file already there, and of
 * a file heard going from the checked path to the new one.
 */
function watchMove(app: App, renaming: Renaming): Move {
  const { file, from, to } = renaming;
  const ours = new Set([from.toLowerCase(), to.toLowerCase()]);
  const touches = (path: string): boolean => ours.has(path.toLowerCase());
  /** Whether the file went from its path to the new one, by any rename. */
  let moved = false;
  /** Whether another file did, as Obsidian moves whatever is at the path. */
  let movedOther = false;
  let cause: string | undefined;
  const saw = (what: string): void => {
    if (!moved) cause ??= what;
  };
  const events = [
    app.vault.on("create", (created) => {
      if (touches(created.path)) saw(`${created.path} was created`);
    }),
    app.vault.on("delete", (deleted) => {
      if (deleted === file) saw("the file was deleted");
      else if (touches(deleted.path)) saw(`${deleted.path} was deleted`);
    }),
    app.vault.on("rename", (renamed, old) => {
      if (renamed === file && old === from && renamed.path === to) {
        moved = true;
      } else if (renamed === file) {
        saw(`the file was renamed to ${renamed.path}`);
      } else if (touches(old) || touches(renamed.path)) {
        if (old === from && renamed.path === to) movedOther = true;
        saw(`${old} was renamed to ${renamed.path}`);
      }
    }),
  ];
  return {
    disturbed: (done) => {
      const named = present(app.vault, file) && file.path === to;
      const name = to.slice(to.lastIndexOf("/") + 1);
      if (!done && named) {
        // Obsidian failed with the file at the new name: a rename elsewhere
        // to that very name left its move nowhere to go, or it moved the file
        // and then failed to update the links. Either way, links may not
        // have followed.
        const unfinished = `Obsidian did not finish the rename, though the file is ${to} now, so links to it may still have the old name`;
        return new RenameDisturbed(
          cause === undefined
            ? unfinished
            : `${cause} while Obsidian was renaming it, and ${unfinished}`,
          true,
        );
      }
      if (cause === undefined) {
        return !done || moved || named
          ? undefined
          : new RenameDisturbed(
              "Obsidian had not renamed the file when it said it had, so it may still be renamed",
              false,
            );
      }
      // Where the file is, in the words a cause would use, so that a cause
      // that says so already is not followed by the same words.
      const where = named
        ? `Obsidian renamed the file to ${name} all the same`
        : !present(app.vault, file)
          ? "the file was deleted"
          : file.path === from
            ? `the file is still ${from}`
            : `the file was renamed to ${file.path}`;
      const outcomes = [
        ...(where === cause ? [] : [where]),
        ...(done && movedOther
          ? [`Obsidian renamed another file to ${name}`]
          : []),
      ];
      return new RenameDisturbed(
        [`${cause} while Obsidian was renaming it`, ...outcomes].join(", and "),
        named,
      );
    },
    stop: () => {
      for (const event of events) app.vault.offref(event);
    },
  };
}

/**
 * Gives a symbol's file the path `renaming` chose, through Obsidian, so that the
 * links to it follow as its settings say. Every rename of a symbol comes
 * through here.
 *
 * Obsidian collects the offsets of a file's links, once its index has caught up
 * with what was saved, then asks whether to update them, and writes at those
 * offsets after the answer without checking what is there. An editor saves
 * itself two seconds after an edit, so a save during the question would have it
 * write a link over other text. Saving every open note first leaves those saves
 * nothing to do. Throws, having renamed nothing, if a note cannot be saved.
 *
 * Saving the notes waits, as can whatever came before this, and so does
 * Obsidian's `renameFile` before it moves the file: for other renames, and for
 * its index to catch up with the notes just saved. The vault goes on changing
 * meanwhile: the symbol can be deleted and another file put at its path, which
 * Obsidian would move in its place, or it can be renamed elsewhere, which
 * Obsidian would undo, its new name taken, or a note typed in after it was
 * saved. So the rename first waits for what Obsidian would, where
 * {@link moveWaits} can see it, and then checks all that was checked again,
 * with nothing waiting between that check, the call to `renameFile`, and
 * Obsidian's move. The file moved is then the one checked, from the path it was
 * checked at, to a name no other file has, with every open note saved. A note
 * typed in meanwhile is saved again, up to {@link notePasses} times. Any other
 * change throws, having renamed nothing, with the reason. One that came before
 * this was called, as while the caller wrote the symbol, throws at once, before
 * any note is saved or anything waited for. The check after the waits would
 * almost always refuse it too; it would not only if the vault changed back
 * meanwhile, as when another symbol gave the name up again, and the refusal
 * then changes nothing, with the name kept for the next save to try.
 *
 * What can still come between, a change Obsidian had begun to write before the
 * move, one made outside Obsidian at that moment, or, where Obsidian's waits
 * cannot be seen, one while Obsidian waits, {@link watchMove} hears of. Then this
 * throws {@link RenameDisturbed}, which says what happened and where the file
 * is, rather than resolving as if the rename went as asked. So it does when
 * Obsidian fails with the file at the new name all the same, rather than
 * rejecting as if nothing was renamed.
 *
 * `wait` hears if that all stops for long enough, which only a person being
 * asked, or a report of the symbol or a note that links to it, puts off.
 * `starting` is called just before the rename reaches Obsidian, and can throw to
 * stop it: a note's save, or Obsidian's index, can take as long as anything
 * else. Throws, having renamed nothing, if Obsidian is still renaming the file.
 *
 * Once `files.unloaded` aborts, as Inkline unloads, the rename throws at its
 * next step, having renamed nothing and saved no more notes, unless Obsidian
 * has it already. Its wait for Obsidian ends then too, as nothing of it is
 * Obsidian's yet, and what Obsidian waits for, such as another rename's
 * question, can last any time.
 */
async function renameSaved(
  files: SymbolFiles,
  renaming: Renaming,
  wait: RenameWait,
  starting: () => void = () => undefined,
): Promise<void> {
  const { app, unloaded } = files;
  const { file } = renaming;
  const notes = notesLinking(app, file.path);
  let moved = false;
  const reported = (changed: TAbstractFile): void => {
    if (changed === file || notes.has(changed.path)) moved = true;
  };
  const reports = [
    app.vault.on("modify", reported),
    app.vault.on("rename", reported),
  ];
  const work = async (): Promise<void> => {
    notBeingRenamed(files, file);
    // Refuses what has changed already, without waiting. It does not stand in
    // for the check below, after which nothing waits before Obsidian's move.
    confirmRenaming(app, renaming);
    const waits = moveWaits(app);
    let saved = false;
    for (let pass = 0; pass < notePasses && !saved; pass++) {
      stillAlive(unloaded);
      const unchanged = await saveOpenNotes(app, unloaded);
      // Saving a note sets Obsidian's index going again.
      while (waits?.clear() === false) {
        await unlessUnloaded(waits.settle(), unloaded);
        stillAlive(unloaded);
      }
      saved = unchanged();
    }
    if (!saved) {
      throw new Error("the open notes kept changing while they were saved");
    }
    // Nothing from here waits until Obsidian has moved the file, where it lets
    // its waits be seen, so that nothing checked, the notes above included,
    // can change before it does.
    stillAlive(unloaded);
    confirmRenaming(app, renaming);
    notBeingRenamed(files, file);
    starting();
    files.beingRenamed.add(file);
    const move = watchMove(app, renaming);
    try {
      await app.fileManager.renameFile(file, renaming.to);
    } catch (error) {
      // What came between, if anything, is why Obsidian could not move it.
      throw move.disturbed(false) ?? error;
    } finally {
      files.beingRenamed.delete(file);
      move.stop();
    }
    const disturbed = move.disturbed(true);
    if (disturbed !== undefined) throw disturbed;
  };
  const moving = (): boolean => {
    const seen = moved;
    moved = false;
    return seen || wait.asked();
  };
  try {
    await watchRename(work(), moving, wait.told);
  } finally {
    for (const report of reports) app.vault.offref(report);
  }
}

/**
 * How `file` takes the name `name` chose, in its own folder, or undefined to
 * keep its name, as an empty name does for a symbol that has one. Throws if
 * another file there has that name. What this finds holds only until something
 * waits, so {@link renameSaved} checks it again before the rename.
 */
export function renamingOf(
  app: App,
  file: TFile,
  name: NameChoice,
): Renaming | undefined {
  if (name.kind !== "name" || symbolStem(file.name) === name.name) {
    return undefined;
  }
  const from = file.path;
  const folder = parentPath(from);
  claimName(app, folder, name.name, file);
  return {
    file,
    from,
    fileName: file.name,
    name: name.name,
    to: pathIn(folder, `${name.name}${inkExtension}`),
  };
}

/**
 * The rename that `typed` asks of `file`, as the vault is now, or undefined if
 * it keeps its name; throws with the reason it is refused: a name it cannot
 * take or another symbol in its folder has, a file no longer in the vault, or
 * one that Obsidian is still renaming. Renames nothing, so that the library can
 * refuse a name before it writes anything else, and then rename the file that
 * was checked, from the path it was checked at, with {@link renameChecked}.
 */
export function checkRename(
  files: SymbolFiles,
  file: TFile,
  typed: string,
): Renaming | undefined {
  const { app } = files;
  stillSymbol(app.vault, file);
  const renaming = renamingOf(app, file, chosen(typed, file));
  if (renaming !== undefined) notBeingRenamed(files, file);
  return renaming;
}

/**
 * Renames a symbol as {@link checkRename} found it, without writing its
 * drawing, using Obsidian's link updates. A file deleted, replaced, or renamed
 * elsewhere since it was checked, as while the library wrote its readings
 * first, or while the rename saves the open notes or waits for Obsidian, is
 * refused, as is a name another symbol took meanwhile. Rejects on failure, so
 * the caller can keep the requested name to retry, and with
 * {@link RenameDisturbed} if something came between once Obsidian had it, or
 * Obsidian failed with the file renamed. `wait` hears if it stops for long
 * enough; {@link SymbolWork.stop} then stops it, unless Obsidian has it, which
 * cannot be taken back. Once `files.unloaded` aborts, as Inkline unloads, it
 * stops as well, as an editor's rename does, and at once if it is waiting for
 * Obsidian.
 */
export function renameChecked(
  files: SymbolFiles,
  renaming: Renaming,
  wait: RenameWait,
): SymbolWork {
  let stopped = false;
  let reached = false;
  const done = renameSaved(files, renaming, wait, () => {
    if (stopped) throw new Error("The rename was stopped.");
    reached = true;
  });
  return {
    done,
    stop: () => {
      stopped = true;
      return !reached;
    },
  };
}

/**
 * Gives a symbol's file the path {@link renamingOf} found, through Obsidian, so
 * that the links to it follow as its settings say; returns whether the file has
 * that name now, or no rename was requested. The drawing is written by then, so
 * a rename that fails says so in a notice and leaves the file as it is, rather
 * than failing the save. A save that wrote to another file than the one
 * checked, as after that one was deleted, renames nothing: it is not the file
 * checked. Nothing is renamed once Inkline is disabled, which saving the notes
 * first leaves time for. A rename that something came between once Obsidian
 * had it, or that Obsidian failed with the file renamed, says what happened,
 * whatever the file's name now.
 */
export async function rename(
  files: SymbolFiles,
  renaming: Renaming | undefined,
  wait: RenameWait,
): Promise<boolean> {
  if (renaming === undefined) return true;
  try {
    await renameSaved(files, renaming, wait);
    return true;
  } catch (error) {
    const { fileName } = renaming;
    if (error instanceof RenameDisturbed) {
      markNotice(new Notice(`${fileName} is saved, but ${error.message}`));
      return error.renamed;
    }
    markNotice(
      new Notice(
        `${fileName} is saved, but could not be renamed: ${message(error)}`,
      ),
    );
    return false;
  }
}
