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

/** What {@link RefreshedAddresses} knows of a file since it was forgotten. */
interface FileRefreshes {
  /**
   * Which of the files that have been at this path it is, so that an image
   * seen before the path's file was deleted, made, or moved is not taken for
   * an image of this one.
   */
  readonly generation: number;
  /** How many times it has been refreshed. */
  refreshes: number;
  /** The address its latest refresh gave its images. */
  latest: string | undefined;
}

/** What {@link RefreshedAddresses} last saw of one image. */
interface ImageRefreshes {
  /** The file it showed, its address without the query. */
  readonly file: string;
  /** That file's generation then. */
  readonly generation: number;
  /** How many times the file had been refreshed then. */
  readonly refreshes: number;
  /** The address the image had then, or was given. */
  readonly src: string;
}

/**
 * Which address each symbol's images should have once the symbol changed. A
 * refresh gives the images it finds a new address, which loads the file
 * again. An image out of every watched document then, as when Obsidian takes
 * images out and puts the same ones back, misses it, and comes back with the
 * address it had, whose picture the page has kept.
 *
 * So each image, the element itself, is remembered with how many times its
 * file had been refreshed when it was last seen, and the address it had. One
 * that comes back with that address, behind its file's refreshes, takes the
 * latest refresh's address. One whose address changed meanwhile, as Obsidian
 * gives once the file changes again, keeps it. An image made anew is new to
 * this and keeps the address it comes with, even an old one: only an image
 * seen before is brought up to date.
 *
 * Each file is remembered with only its generation, its refreshes, and its
 * latest refresh's address, until it is deleted, made, or moved, when it is
 * forgotten: a new file at its path is another generation, so that an image
 * of the old one keeps its own address rather than take the new file's, and
 * an image of the new one never gets an address of the old. Nothing here
 * reads an address beyond the part before its query, and an image is
 * remembered only as long as the page keeps it.
 */
export class RefreshedAddresses {
  /** How many records of files there have been, which numbers each. */
  #generations = 0;
  readonly #files = new Map<string, FileRefreshes>();
  readonly #images = new WeakMap<object, ImageRefreshes>();

  /**
   * Records that `image` shows `src`, and gives the address it should show
   * instead: its file's latest refresh's, if it has had `src` since before
   * that refresh.
   */
  shown(image: object, src: string): string | undefined {
    const file = fileAddress(src);
    const known = this.#known(file);
    const last = this.#images.get(image);
    const behind =
      last?.file === file &&
      last.generation === known.generation &&
      last.src === src &&
      last.refreshes < known.refreshes;
    const now = behind ? (known.latest ?? src) : src;
    this.#images.set(image, {
      file,
      generation: known.generation,
      refreshes: known.refreshes,
      src: now,
    });
    return now === src ? undefined : now;
  }

  /**
   * Records a refresh of the file at `src`, the address Obsidian gives it
   * now, and gives the address its images take: a distinct request even if
   * two writes share a modification time.
   */
  refreshed(src: string): string {
    const known = this.#known(fileAddress(src));
    known.refreshes += 1;
    const next = new URL(src);
    next.searchParams.set("inkline", crypto.randomUUID());
    known.latest = next.href;
    return next.href;
  }

  /** Forgets the file `src` shows, as when it is deleted, made, or moved. */
  forget(src: string): void {
    this.#files.delete(fileAddress(src));
  }

  /**
   * How many files it remembers: one for each symbol file seen or refreshed
   * and not forgotten since, however often each was refreshed.
   */
  get size(): number {
    return this.#files.size;
  }

  /** What is known of `file`, from now on if nothing yet. */
  #known(file: string): FileRefreshes {
    const known = this.#files.get(file);
    if (known !== undefined) return known;
    this.#generations += 1;
    const fresh: FileRefreshes = {
      generation: this.#generations,
      refreshes: 0,
      latest: undefined,
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
