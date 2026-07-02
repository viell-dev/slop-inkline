import { Option } from "effect";
import type { App, Editor, TFile } from "obsidian";
import { isInkFile } from "../inkFiles/isInkFile";
import { findImageTokenAtCursor } from "../markdown/findImageTokenAtCursor";

/** The ink file behind the image link under the editor cursor, if any. */
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
