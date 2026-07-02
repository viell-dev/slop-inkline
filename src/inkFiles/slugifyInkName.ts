/**
 * Normalize a display name into an ink filename stem.
 *
 * @remarks
 * Strips `.ink.png`/`.png` extensions, lowercases, folds accented letters
 * to ASCII, and collapses every other character run into single hyphens.
 *
 * @param value - The display name to slugify.
 * @returns The lowercase ASCII stem with hyphen separators, or "" when
 *   nothing usable remains.
 */
export function slugifyInkName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.ink\.png$/i, "")
    .replace(/\.png$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
