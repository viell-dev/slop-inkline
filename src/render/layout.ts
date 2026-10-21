// Where a symbol sits in a line of text, and how its address is told apart,
// as plain functions that need neither Obsidian nor a page, so that unit
// tests can check them. symbols.ts applies them to the page.

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
  const path = src.split(/[?#]/, 1)[0] ?? "";
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A stray % leaves the path as it is.
  }
  return decoded.toLowerCase().endsWith(".ink.png");
}

/**
 * A symbol's name from its image's URL: its file's name, decoded, without
 * the `.ink.png` ending in any letter case, and without the folder or the
 * query Obsidian adds.
 */
export function symbolName(src: string): string {
  const path = src.split(/[?#]/, 1)[0] ?? "";
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
