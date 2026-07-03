import { Notice } from "obsidian";
import type {
  App,
  Editor,
  EditorPosition,
  MarkdownFileInfo,
  TFile,
} from "obsidian";
import { openInkEditor } from "../editor/openInkEditor";
import { getNextAutoName } from "../inkFiles/getNextAutoName";
import { createImageEmbed } from "../markdown/createImageEmbed";
import { findAtomicRangesOnLine } from "../markdown/findAtomicRangesOnLine";
import type { AtomicRange } from "../markdown/findAtomicRangesOnLine";

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
 * and insert its embed at the (captured) insertion point once it is first
 * saved.
 *
 * @remarks
 * Inserting never replaces note content: the embed lands at the selection
 * end (or the cursor), slid past any atomic span — image embeds, wiki
 * links, Markdown links — so existing markup is never split. The
 * position is captured before the editor opens, so the embed lands where
 * the command was invoked even if the cursor moves while the editor is
 * open. Nothing is inserted when the editor is closed without saving.
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
  const sourcePath = ctx.file?.path ?? "";
  const name = await getNextAutoName(deps.app, sourcePath);
  const insertAt = resolveInsertionPosition(editor);

  openInkEditor(deps.app, null, {
    newInk: {
      name,
      sourcePath,
      imageSize: deps.imageSize,
      onCreate: (created) => {
        const markdown = createImageEmbed(
          deps.app.fileManager.generateMarkdownLink(created.file, sourcePath),
        );
        editor.replaceRange(markdown, insertAt, insertAt);
        new Notice(`Created inline ink: ${created.name}`);
      },
    },
    displayHeight: deps.displayHeight,
    onSave: (file) => deps.onSaved(file),
  });
}

/**
 * Resolve where the new embed is inserted: the selection end (or the
 * cursor), slid to the end of any atomic span it falls strictly inside so
 * the insertion never splits an existing embed or link.
 *
 * @param editor - The editor whose selection end is resolved.
 * @returns The insertion position.
 */
function resolveInsertionPosition(editor: Editor): EditorPosition {
  const end = editor.getCursor("to");
  const ranges = findAtomicRangesOnLine(editor.getLine(end.line));

  let ch = end.ch;
  let enclosing: AtomicRange | undefined;
  while (
    (enclosing = ranges.find((range) => range.from < ch && ch < range.to)) !==
    undefined
  ) {
    ch = enclosing.to;
  }

  return { line: end.line, ch };
}
