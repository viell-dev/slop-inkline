import { Option } from "effect";
import type { Editor } from "obsidian";
import type { ImageToken } from "./imageToken";

/**
 * Find the Markdown or wiki image embed under the editor cursor.
 *
 * @remarks
 * Both the start offset and the exclusive end offset count as inside the
 * token, so a cursor sitting at either boundary still matches.
 *
 * @param editor - The editor whose cursor line is scanned.
 * @returns The token containing the cursor, or none.
 */
export function findImageTokenAtCursor(
  editor: Editor,
): Option.Option<ImageToken> {
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  const cursorCh = cursor.ch;
  const tokens = [
    ...findMarkdownImageTokens(line),
    ...findWikiImageTokens(line),
  ];

  return Option.fromNullable(
    tokens.find((token) => token.from <= cursorCh && cursorCh <= token.to),
  );
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
