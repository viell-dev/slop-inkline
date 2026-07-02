import { Option } from "effect";
import { Notice } from "obsidian";
import type { App, Editor, MarkdownFileInfo, TFile } from "obsidian";
import { openInkEditor } from "../editor/openInkEditor";
import { getNextAutoName } from "../inkFiles/getNextAutoName";
import { createImageEmbed } from "../markdown/createImageEmbed";
import { findImageTokenAtCursor } from "../markdown/findImageTokenAtCursor";

export interface InsertInlineInkDeps {
  app: App;
  /** Stored resolution for the new ink (the imageSize setting). */
  imageSize: number;
  displayHeight: string;
  /** Refresh rendered embeds after any save from the opened editor. */
  onSaved(file: TFile): void;
}

/**
 * The "Insert inline ink" command: open the editor for a new auto-named ink
 * and insert its embed at the (captured) cursor once it is first saved.
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
 * splitting the `![](...)` in two. Boundary positions (just before or after
 * the link) and active selections are left untouched.
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
