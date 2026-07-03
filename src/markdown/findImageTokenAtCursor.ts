import { Option } from "effect";
import type { Editor } from "obsidian";
import { findImageTokensOnLine } from "./findImageTokensOnLine";
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
  const cursorCh = cursor.ch;
  const tokens = findImageTokensOnLine(editor.getLine(cursor.line));

  return Option.fromNullable(
    tokens.find((token) => token.from <= cursorCh && cursorCh <= token.to),
  );
}
