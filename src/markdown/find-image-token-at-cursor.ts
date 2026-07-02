import { Option } from "effect";
import type { Editor } from "obsidian";
import type { ImageToken } from "./image-token";

/**
 * The Markdown or wiki image embed under the editor cursor, if any. Both the
 * start offset and the exclusive end offset count as inside the token.
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

function cleanMarkdownDestination(destination: string): string {
  const trimmed = destination.trim();
  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">")
      ? trimmed.slice(1, -1)
      : trimmed;

  return decodeURI(unwrapped.split("#", 1)[0]);
}
