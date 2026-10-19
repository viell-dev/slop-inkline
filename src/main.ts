import { Plugin, TFile } from "obsidian";
import { isInkPath } from "./format/ink-file.ts";
import { editSymbol, insertSymbol } from "./notes/symbols.ts";

/** Inkline: symbols drawn once and written in notes like characters. */
export default class InklinePlugin extends Plugin {
  override onload(): void {
    this.addCommand({
      id: "insert-symbol",
      name: "Insert symbol",
      editorCallback: (editor, context) => {
        insertSymbol(this.app, editor, context.file?.path ?? "");
      },
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || !isInkPath(file.path)) return;
        menu.addItem((item) =>
          item
            .setTitle("Edit symbol")
            .setIcon("pencil")
            .onClick(() => void this.editSymbol(file)),
        );
      }),
    );
  }

  /** Opens the editor for a symbol file. */
  editSymbol(file: TFile): Promise<void> {
    return editSymbol(this.app, file);
  }
}
