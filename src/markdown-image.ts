import { Editor } from "obsidian";

export interface ImageToken {
  path: string;
  from: number;
  to: number;
}

export interface InsertedImageMatch {
  offset: number;
  length: number;
}

export function createMarkdownImage(path: string): string {
  return `![](${formatMarkdownDestination(path)})`;
}

export function findImageTokenAtCursor(editor: Editor): ImageToken | null {
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  const cursorCh = cursor.ch;
  const tokens = [
    ...findMarkdownImageTokens(line),
    ...findWikiImageTokens(line),
  ];

  return tokens.find((token) => token.from <= cursorCh && cursorCh <= token.to) ?? null;
}

/**
 * Locate the embed inserted for `path` so it can be removed when a new ink is
 * discarded. Prefers the verbatim inserted Markdown, then any Markdown image
 * that points at the same path in case the editor reflowed it.
 */
export function locateInsertedImage(
  documentText: string,
  insertedMarkdown: string,
  path: string,
): InsertedImageMatch | null {
  const literalOffset = documentText.indexOf(insertedMarkdown);
  if (literalOffset >= 0) {
    return { offset: literalOffset, length: insertedMarkdown.length };
  }

  const pathOffset = findMarkdownImageOffset(documentText, path);
  if (pathOffset < 0) {
    return null;
  }

  const markdown = matchMarkdownImageAt(documentText, pathOffset) ?? insertedMarkdown;
  return { offset: pathOffset, length: markdown.length };
}

function formatMarkdownDestination(path: string): string {
  if (!/[\s()<>]/.test(path)) {
    return path;
  }

  return `<${path.replace(/>/g, "%3E")}>`;
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
  const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;

  return decodeURI(unwrapped.split("#", 1)[0]);
}

function findMarkdownImageOffset(documentText: string, path: string): number {
  const escapedPath = escapeRegExp(path);
  const pattern = new RegExp(`!\\[[^\\]]*\\]\\((?:<)?${escapedPath}(?:>)?\\)`);
  const match = pattern.exec(documentText);
  return match?.index ?? -1;
}

function matchMarkdownImageAt(documentText: string, offset: number): string | null {
  const match = /^!\[[^\]]*\]\((?:<)?[^)>]+(?:>)?\)/.exec(documentText.slice(offset));
  return match?.[0] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
