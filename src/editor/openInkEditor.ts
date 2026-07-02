import { Modal } from "obsidian";
import type { App, TFile } from "obsidian";
import { buildInkEditor } from "./buildInkEditor";
import type { InkEditorOptions } from "./inkEditorOptions";

/**
 * Open the ink editor in a modal.
 *
 * @remarks
 * This is the only place the editor touches Obsidian's `Modal` class: a
 * plain instance is configured here and everything else is assembled
 * functionally by `buildInkEditor`.
 *
 * @param app - The Obsidian app the modal belongs to.
 * @param file - The ink file to edit, or `null` to draw a new ink (then
 *   `options.newInk` describes where it is created on first save).
 * @param options - The editor's configuration and callbacks.
 */
export function openInkEditor(
  app: App,
  file: TFile | null,
  options: InkEditorOptions = {},
): void {
  const modal = new Modal(app);

  modal.onOpen = () => {
    buildInkEditor(modal, file, options);
  };

  modal.onClose = () => {
    modal.modalEl.removeClass("inkline-editor-modal-frame");
    modal.contentEl.empty();
  };

  modal.open();
}
