import { Modal } from "obsidian";
import type { App, TFile } from "obsidian";
import { buildInkEditor } from "./buildInkEditor";
import type { InkEditorOptions } from "./inkEditorOptions";

/**
 * Open the ink editor. This is the only place the editor touches Obsidian's
 * Modal class: a plain instance is configured here and everything else is
 * assembled functionally by buildInkEditor.
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
