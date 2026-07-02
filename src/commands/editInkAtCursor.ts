import { Option } from "effect";
import { Notice } from "obsidian";
import type { App, Editor, MarkdownFileInfo, TFile } from "obsidian";
import { inkFileAtCursor } from "./inkFileAtCursor";

export interface EditInkAtCursorDeps {
  app: App;
  openEditor(file: TFile): void;
  /** Fallback for a selected rendered image without a cursor link. */
  openSelectedInkImage(): boolean;
}

/** The "Edit inline ink at cursor" command. */
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
