// Where a symbol sits in a line of text, how its address is told apart, and
// which address a refreshed symbol's images should have, as plain code that
// needs neither Obsidian nor a page, so that unit tests can check it.
// symbols.ts applies it to the page.

import { isInkPath } from "../format/ink-file.ts";
import { lineBox } from "../ink/geometry.ts";

/**
 * How far below its bottom edge, as a fraction of its height, a symbol's
 * baseline lies: the line box's, a quarter of the way up.
 */
export const baselineFraction =
  (lineBox.height - lineBox.baseline) / lineBox.height;

/**
 * Whether an image's URL is a symbol file's in the vault: whether it starts
 * with `vault`, the address Obsidian gives the vault's files, and its path,
 * before any query or fragment, ends in `.ink.png`, in any letter case.
 * Obsidian gives vault images their file's path, with a query that changes
 * when the file does. Images from elsewhere are not the vault's symbols, and
 * a mask of one could fail where the image itself loads.
 */
export function isSymbolUrl(src: string, vault: string): boolean {
  if (vault === "" || !src.startsWith(vault)) return false;
  const path = fileAddress(src);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A stray % leaves the path as it is.
  }
  return isInkPath(decoded);
}

/**
 * The file an image's URL shows: the URL before any query or fragment, which
 * is the same for every version of the file.
 */
export function fileAddress(src: string): string {
  return src.split(/[?#]/, 1)[0] ?? "";
}

/**
 * How many of the addresses that Obsidian gives one file are remembered: one
 * for each version of it seen. An image that comes back with an address
 * older than that many versions keeps it, as it did before Inkline kept any.
 */
export const historyLimit = 32;

/** What {@link RefreshedAddresses} knows of a file since it was forgotten. */
interface FileAddresses {
  /**
   * Which of the files that have been at this path it is, so that the
   * addresses its refreshes make are its own.
   */
  readonly generation: number;
  /** How many times it has been refreshed. */
  refreshes: number;
  /** The address its latest refresh gave its images. */
  latest: string | undefined;
  /**
   * Each other address its images have been seen with, as Obsidian gives,
   * and how many refreshes there had been when it was first seen: at most
   * {@link historyLimit}, the earliest seen going first.
   */
  readonly seen: Map<string, number>;
}

/** The mark on an address that a refresh made, before any `&` or `#`. */
const refreshMark = /[?&]inkline=([^&#]*)/;

/**
 * Which address each symbol's images should have once the symbol changed. A
 * refresh gives the images it finds a new address, which loads the file
 * again; an image out of the document then, as Obsidian takes images out and
 * puts the same ones back, misses it and comes back with the address it had,
 * whose picture the page has kept. That address was seen before the refresh,
 * so the refresh superseded it, and the image takes the refresh's address.
 *
 * An address first seen after the latest refresh is kept, as Obsidian gives
 * once the file changes again, as are addresses never seen: only an address
 * known to be older is replaced. What is known of a file, its refreshes and
 * the addresses seen, is kept apart from every other file's, and forgotten
 * when it is deleted, made, or moved, so that a new file at its path starts
 * afresh and an image of it never gets an address of the old one, even where
 * Obsidian gives the new file an address the old one had.
 *
 * The addresses a refresh makes are not stored: each carries a mark of this
 * load of Inkline, of the file's record, and of the refresh, so that one
 * earlier than the latest is known by its mark. What is stored is bounded:
 * for each file shown and not forgotten, its latest address and at most
 * {@link historyLimit} of Obsidian's.
 */
export class RefreshedAddresses {
  /** Marks this load's addresses apart from those of an earlier one. */
  readonly #load = crypto.randomUUID();
  /** How many records of files there have been, which numbers each. */
  #generations = 0;
  readonly #files = new Map<string, FileAddresses>();

  /**
   * Records that an image shows `src`, and gives the address it should show
   * instead, if the latest refresh of its file superseded `src`.
   */
  shown(src: string): string | undefined {
    const known = this.#known(src);
    const refresh = this.#refreshOf(src, known);
    if (refresh !== undefined) {
      return refresh < known.refreshes ? known.latest : undefined;
    }
    const first = known.seen.get(src);
    if (first !== undefined) {
      return first < known.refreshes ? known.latest : undefined;
    }
    known.seen.set(src, known.refreshes);
    if (known.seen.size > historyLimit) {
      for (const earliest of known.seen.keys()) {
        known.seen.delete(earliest);
        break;
      }
    }
    return undefined;
  }

  /**
   * Records a refresh of the file at `src`, the address Obsidian gives it
   * now, and gives the address its images take: a distinct request even if
   * two writes share a modification time, and in each load of Inkline.
   */
  refreshed(src: string): string {
    const known = this.#known(src);
    known.refreshes += 1;
    const next = new URL(src);
    next.searchParams.set(
      "inkline",
      `${this.#load}.${String(known.generation)}.${String(known.refreshes)}`,
    );
    known.latest = next.href;
    return next.href;
  }

  /** Forgets the file `src` shows, as when it is deleted, made, or moved. */
  forget(src: string): void {
    this.#files.delete(fileAddress(src));
  }

  /**
   * How many addresses it keeps, of every file: each file's latest, whether
   * or not it has one, and those of Obsidian's it has seen. This is what its
   * memory grows with.
   */
  get size(): number {
    let size = 0;
    for (const known of this.#files.values()) size += 1 + known.seen.size;
    return size;
  }

  /**
   * Which refresh of `known` made `src`, if one did: not one of an earlier
   * record at its path, nor of an earlier load of Inkline.
   */
  #refreshOf(src: string, known: FileAddresses): number | undefined {
    const mark = refreshMark.exec(src)?.[1];
    if (mark === undefined) return undefined;
    const own = `${this.#load}.${String(known.generation)}.`;
    if (!mark.startsWith(own)) return undefined;
    const refresh = Number(mark.slice(own.length));
    return Number.isInteger(refresh) &&
      refresh >= 1 &&
      refresh <= known.refreshes
      ? refresh
      : undefined;
  }

  /** What is known of the file `src` shows, from now on if nothing yet. */
  #known(src: string): FileAddresses {
    const file = fileAddress(src);
    const known = this.#files.get(file);
    if (known !== undefined) return known;
    this.#generations += 1;
    const fresh: FileAddresses = {
      generation: this.#generations,
      refreshes: 0,
      latest: undefined,
      seen: new Map(),
    };
    this.#files.set(file, fresh);
    return fresh;
  }
}

/**
 * A symbol's name from its image's URL: its file's name, decoded, without
 * the `.ink.png` ending in any letter case, and without the folder or the
 * query Obsidian adds.
 */
export function symbolName(src: string): string {
  const path = fileAddress(src);
  let file = path.slice(path.lastIndexOf("/") + 1);
  try {
    file = decodeURIComponent(file);
  } catch {
    // A stray % leaves the name as it is.
  }
  return file.replace(/\.ink\.png$/i, "");
}

/** A CSS `url()` for `src`, with what would end its string escaped. */
export function cssUrl(src: string): string {
  const escaped = src
    .replace(/["\\]/g, "\\$&")
    .replace(/\n/g, "\\a ")
    .replace(/\r/g, "\\d ")
    .replace(/\f/g, "\\c ");
  return `url("${escaped}")`;
}

/**
 * How far below the text's baseline a symbol shown `height` pixels tall puts
 * its bottom edge, as a CSS `vertical-align`, so that its own baseline is on
 * the text's.
 */
export function dropFor(height: number): string {
  return `${String(-height * baselineFraction)}px`;
}

/**
 * A symbol's width over its height, from its image's own size. Undefined
 * while that is not known yet, as before it loads.
 */
export function aspectRatio(
  naturalWidth: number,
  naturalHeight: number,
): number | undefined {
  if (naturalWidth <= 0 || naturalHeight <= 0) return undefined;
  return naturalWidth / naturalHeight;
}

/**
 * The width, in CSS pixels, that an explicit size of only a width asks a
 * symbol to show at, as `![[x.ink.png|1000]]` does: a space narrower than it
 * shrinks the symbol evenly, its height following. Undefined for a size that
 * gives a height, whose drop follows that height, and for no size.
 */
export function explicitWidth(
  widthAttribute: string | null,
  heightAttribute: string | null,
): number | undefined {
  if (heightAttribute !== null) return undefined;
  const width = Number.parseFloat(widthAttribute ?? "");
  return Number.isFinite(width) && width > 0 ? width : undefined;
}

/**
 * The height, in CSS pixels, at which a symbol with an explicit size shows:
 * its `height` attribute, or else its `width` attribute at its own aspect
 * ratio. Undefined while that is not known yet, as before it loads.
 */
export function explicitHeight(
  widthAttribute: string | null,
  heightAttribute: string | null,
  naturalWidth: number,
  naturalHeight: number,
): number | undefined {
  const height = Number.parseFloat(heightAttribute ?? "");
  if (Number.isFinite(height) && height > 0) return height;
  const width = Number.parseFloat(widthAttribute ?? "");
  if (!Number.isFinite(width) || width <= 0) return undefined;
  if (naturalWidth <= 0 || naturalHeight <= 0) return undefined;
  return (width * naturalHeight) / naturalWidth;
}
