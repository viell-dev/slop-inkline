import { Option } from "effect";
import { Notice } from "obsidian";
import type { App, Editor, MarkdownFileInfo, TFile } from "obsidian";
import { inkFileAtCursor } from "./inkFileAtCursor";

/** Dependencies of {@link editInkAtCursor}. */
export interface EditInkAtCursorDeps {
  /** The Obsidian app, used to resolve the link under the cursor. */
  app: App;
  /**
   * Open the ink editor for a resolved ink file.
   *
   * @param file - The `.ink.png` vault file to edit.
   */
  openEditor(file: TFile): void;
  /**
   * Fallback for a selected rendered image without a cursor link: open the
   * editor for the currently selected ink image, if any.
   *
   * @returns Whether a selected ink image was found and opened.
   */
  openSelectedInkImage(): boolean;
}

/**
 * The "Edit inline ink at cursor" command: open the ink editor for the ink
 * file the cursor points at.
 *
 * @remarks
 * Tries the image link under the cursor first, then the currently selected
 * rendered image; shows a notice when neither yields an ink file.
 *
 * @param deps - The command's dependencies.
 * @param editor - The active Markdown editor whose cursor is inspected.
 * @param ctx - The file context of that editor, used to resolve links.
 */
export function editInkAtCursor(
  deps: EditInkAtCursorDeps,
  editor: Editor,
  ctx: MarkdownFileInfo,
): void {
  const file = Option.getOrNull(
    inkFileAtCursor(deps.app, editor, ctx.file?.path ?? ""),
  );
  if (file) {
    deps.openEditor(file);
    return;
  }

  if (deps.openSelectedInkImage()) {
    return;
  }

  new Notice("No Inkline image at cursor.");
}
