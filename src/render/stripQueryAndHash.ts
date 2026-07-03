/**
 * Strip the query and hash parts from a URL-like string.
 *
 * @param value - The string to strip.
 * @returns Everything before the first `#` or `?`.
 */
export function stripQueryAndHash(value: string): string {
  return value.split("#", 1)[0].split("?", 1)[0];
}
