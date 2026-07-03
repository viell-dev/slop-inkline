import type { ImageToken } from "./imageToken";

/**
 * Collect every Markdown (`![alt](path)`) and wiki (`![[path]]`) image
 * embed on a line.
 *
 * @param line - The line text to scan.
 * @returns The Markdown-style tokens followed by the wiki-style tokens,
 *   each group in source order.
 */
export function findImageTokensOnLine(line: string): ImageToken[] {
  return [...findMarkdownImageTokens(line), ...findWikiImageTokens(line)];
}

/**
 * Collect every Markdown image embed (`![alt](path)`) on a line.
 *
 * @param line - The line text to scan.
 * @returns The tokens in source order, with cleaned destinations.
 */
function findMarkdownImageTokens(line: string): ImageToken[] {
  const tokens: ImageToken[] = [];
  const pattern = /!\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    tokens.push({
      path: cleanMarkdownDestination(match[1]),
      from: match.index,
      to: match.index + match[0].length,
    });
  }

  return tokens;
}

/**
 * Collect every wiki image embed (`![[path]]`) on a line.
 *
 * @param line - The line text to scan.
 * @returns The tokens in source order, with alias and hash parts stripped
 *   from the paths.
 */
function findWikiImageTokens(line: string): ImageToken[] {
  const tokens: ImageToken[] = [];
  const pattern = /!\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    tokens.push({
      path: match[1].split("|", 1)[0].split("#", 1)[0].trim(),
      from: match.index,
      to: match.index + match[0].length,
    });
  }

  return tokens;
}

/**
 * Normalize a Markdown link destination into a plain path.
 *
 * @param destination - The raw destination, possibly `<angle-wrapped>`,
 *   URI-encoded, or carrying a `#hash`.
 * @returns The decoded path without angle brackets or hash.
 */
function cleanMarkdownDestination(destination: string): string {
  const trimmed = destination.trim();
  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">")
      ? trimmed.slice(1, -1)
      : trimmed;

  return decodeURI(unwrapped.split("#", 1)[0]);
}
