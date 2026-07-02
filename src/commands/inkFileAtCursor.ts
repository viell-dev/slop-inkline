import { Option } from "effect";
import type { App, Editor, TFile } from "obsidian";
import { isInkFile } from "../inkFiles/isInkFile";
import { findImageTokenAtCursor } from "../markdown/findImageTokenAtCursor";

/**
 * Resolve the ink file behind the image link under the editor cursor.
 *
 * @param app - The Obsidian app, used to resolve the link path.
 * @param editor - The editor whose cursor position is inspected.
 * @param sourcePath - The path of the note being edited, used as the link
 *   resolution context.
 * @returns The resolved `.ink.png` file, or none when the cursor is not on
 *   an image link or the link does not resolve to an ink file.
 */
export function inkFileAtCursor(
  app: App,
  editor: Editor,
  sourcePath: string,
): Option.Option<TFile> {
  return findImageTokenAtCursor(editor).pipe(
    Option.flatMap((token) =>
      Option.fromNullable(
        app.metadataCache.getFirstLinkpathDest(token.path, sourcePath),
      ),
    ),
    Option.filter(isInkFile),
  );
}
