// Where a symbol in a note can be opened for editing from: the embed at the
// cursor, for a command and the editor's menu, and a symbol's image, for a
// menu where Obsidian shows none. editSymbol in symbols.ts opens it.

import { Menu, type App, type TFile } from "obsidian";
import { isInkPath } from "../format/ink-file.ts";
import { embedAt } from "./links.ts";

/**
 * The symbol file that the embed at `offset` in `text`, the note at
 * `notePath`, shows: the embed with the offset on it or at either end, as a
 * cursor just after one is. Undefined when there is no embed there, or it
 * shows no symbol.
 */
export function symbolAt(
  app: App,
  text: string,
  offset: number,
  notePath: string,
): TFile | undefined {
  const embed = embedAt(text, offset);
  if (embed === undefined || embed.target === "") return undefined;
  const file = app.metadataCache.getFirstLinkpathDest(embed.target, notePath);
  return file !== null && isInkPath(file.path) ? file : undefined;
}

/** An address without the query or fragment Obsidian adds to it. */
function withoutQuery(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? "";
}

/**
 * The symbol file an image shows, by its address, which Obsidian gives as
 * the file's resource path; undefined for any other image.
 */
export function symbolOfImage(
  app: App,
  image: HTMLImageElement,
): TFile | undefined {
  const address = withoutQuery(image.src || image.currentSrc);
  if (address === "") return undefined;
  return app.vault
    .getFiles()
    .find(
      (file) =>
        isInkPath(file.path) &&
        withoutQuery(app.vault.getResourcePath(file)) === address,
    );
}

/**
 * Shows the menu Obsidian shows for a file, for `file`, at the pointer of
 * `event`: Obsidian's own items and every plugin's, Inkline's Edit symbol
 * among them, as in Live Preview's menu for an image.
 */
export function showSymbolMenu(app: App, file: TFile, event: MouseEvent): void {
  const menu = new Menu();
  app.workspace.trigger("file-menu", menu, file, "inkline-symbol");
  menu.showAtMouseEvent(event);
}
