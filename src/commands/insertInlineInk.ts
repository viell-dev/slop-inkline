import { Option } from "effect";
import { Notice } from "obsidian";
import type { App, Editor, MarkdownFileInfo, TFile } from "obsidian";
import { openInkEditor } from "../editor/openInkEditor";
import { getNextAutoName } from "../inkFiles/getNextAutoName";
import { createImageEmbed } from "../markdown/createImageEmbed";
import { findImageTokenAtCursor } from "../markdown/findImageTokenAtCursor";

/** Dependencies of {@link insertInlineInk}. */
export interface InsertInlineInkDeps {
  /** The Obsidian app, used for naming, file creation, and link building. */
  app: App;
  /** Stored resolution for the new ink (the imageSize setting). */
  imageSize: number;
  /** CSS display height passed through to the editor's baseline guides. */
  displayHeight: string;
  /**
   * Refresh rendered embeds after any save from the opened editor.
   *
   * @param file - The ink file that was just saved.
   */
  onSaved(file: TFile): void;
}

/**
 * The "Insert inline ink" command: open the editor for a new auto-named ink
 * and insert its embed at the (captured) cursor once it is first saved.
 *
 * @remarks
 * The insertion range is captured before the editor opens, so the embed
 * lands where the command was invoked even if the cursor moves while the
 * editor is open. Nothing is inserted when the editor is closed without
 * saving.
 *
 * @param deps - The command's dependencies.
 * @param editor - The active Markdown editor the embed is inserted into.
 * @param ctx - The file context of that editor, used for naming and link
 *   generation.
 * @returns A promise that resolves once the ink editor has been opened.
 */
export async function insertInlineInk(
  deps: InsertInlineInkDeps,
  editor: Editor,
  ctx: MarkdownFileInfo,
): Promise<void> {
  moveCursorPastEnclosingImage(editor);

  const sourcePath = ctx.file?.path ?? "";
  const name = await getNextAutoName(deps.app, sourcePath);
  const insertStart = editor.getCursor("from");
  const insertEnd = editor.getCursor("to");

  openInkEditor(deps.app, null, {
    newInk: {
      name,
      sourcePath,
      imageSize: deps.imageSize,
      onCreate: (created) => {
        const markdown = createImageEmbed(
          deps.app.fileManager.generateMarkdownLink(created.file, sourcePath),
        );
        editor.replaceRange(markdown, insertStart, insertEnd);
        new Notice(`Created inline ink: ${created.name}`);
      },
    },
    displayHeight: deps.displayHeight,
    onSave: (file) => deps.onSaved(file),
  });
}

/**
 * If the cursor sits strictly inside an existing image link, move it to the
 * end of that link so inserting a new ink appends after it instead of
 * splitting the `![](...)` in two.
 *
 * @remarks
 * Boundary positions (just before or after the link) and active selections
 * are left untouched.
 *
 * @param editor - The editor whose cursor may be moved.
 */
function moveCursorPastEnclosingImage(editor: Editor): void {
  if (editor.somethingSelected()) {
    return;
  }

  const cursor = editor.getCursor();
  const token = Option.getOrNull(findImageTokenAtCursor(editor));
  if (token && cursor.ch > token.from && cursor.ch < token.to) {
    editor.setCursor({ line: cursor.line, ch: token.to });
  }
}
