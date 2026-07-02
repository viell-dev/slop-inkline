/**
 * Normalize a display name into an ink filename stem: lowercase ASCII with
 * hyphen separators, ink/png extensions stripped. Returns "" when nothing
 * usable remains.
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
