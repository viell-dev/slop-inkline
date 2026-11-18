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

/** What {@link RefreshedAddresses} knows of a refreshed file. */
interface Refreshed {
  /** The address its latest refresh gave its images. */
  latest: string;
  /** How many refreshes, of any file, there had been by then. */
  at: number;
}

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
 * known to be older is replaced. A file deleted, made, or moved is forgotten,
 * so that a new file at its path starts afresh, and an image of it never
 * gets an address of the old one back, even where the new file's own address
 * is one the old one had, as with the same modification time.
 */
export class RefreshedAddresses {
  /** How many refreshes there have been, of any file. */
  #refreshes = 0;
  /** Each address seen, and how many refreshes there had been by then. */
  readonly #seen = new Map<string, number>();
  /** Each file refreshed since it was last forgotten. */
  readonly #files = new Map<string, Refreshed>();

  /**
   * Records that an image shows `src`, and gives the address it should show
   * instead, if the latest refresh of its file superseded `src`. Until any
   * file is refreshed, this is one lookup in a map.
   */
  shown(src: string): string | undefined {
    const first = this.#seen.get(src);
    if (first === undefined) {
      this.#seen.set(src, this.#refreshes);
      return undefined;
    }
    if (this.#files.size === 0) return undefined;
    const file = this.#files.get(fileAddress(src));
    return file !== undefined && first < file.at ? file.latest : undefined;
  }

  /** Records a refresh that gives the images of its file `next`. */
  refreshed(next: string): void {
    this.#refreshes += 1;
    this.#files.set(fileAddress(next), {
      latest: next,
      at: this.#refreshes,
    });
    this.#seen.set(next, this.#refreshes);
  }

  /** Forgets the file `src` shows, as when it is deleted, made, or moved. */
  forget(src: string): void {
    this.#files.delete(fileAddress(src));
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
