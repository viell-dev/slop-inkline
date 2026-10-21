// Where a symbol in a note can be opened for editing from: the embed at the
// cursor, for a command, and a symbol's image, for a menu where Obsidian
// shows none. editSymbol in symbols.ts opens it.

import {
  Menu,
  parseLinktext,
  type App,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { isInkPath } from "../format/ink-file.ts";
import { embedAt } from "./links.ts";
import { insideCodeBlock } from "./search.ts";

/**
 * The symbol file that the embed at `offset` in `text`, the note at
 * `notePath`, shows: the embed with the offset on it or at either end, as a
 * cursor just after one is. Undefined when there is no embed there, it
 * shows no symbol, or it is in front matter or a fenced code block, where
 * it is text and shows nothing.
 */
export function symbolAt(
  app: App,
  text: string,
  offset: number,
  notePath: string,
): TFile | undefined {
  const embed = embedAt(text, offset);
  if (embed === undefined || embed.target === "") return undefined;
  const lines = text.split("\n");
  const line = text.slice(0, offset).split("\n").length - 1;
  if (insideCodeBlock((index) => lines[index], line)) return undefined;
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

/** The leaf whose view holds `element`, if any, as a hover preview has none. */
function leafOf(app: App, element: Element): WorkspaceLeaf | undefined {
  let found: WorkspaceLeaf | undefined;
  app.workspace.iterateAllLeaves((leaf) => {
    if (found === undefined && leaf.view.containerEl.contains(element)) {
      found = leaf;
    }
  });
  return found;
}

/**
 * Shows the menu Obsidian shows for a link to `file`, as from `leaf`, at
 * the pointer of `event`, as Live Preview's menu for an image holds it: open in a new tab or to the right, rename, and the file's menu
 * with every plugin's items, Inkline's Edit symbol among them. A path that
 * does not read back as a link to the file, as one with a `#`, gets the
 * file's menu alone.
 */
export function showLinkMenu(
  app: App,
  file: TFile,
  leaf: WorkspaceLeaf | undefined,
  event: MouseEvent,
): void {
  const menu = new Menu();
  const linked = app.metadataCache.getFirstLinkpathDest(
    parseLinktext(file.path).path,
    "",
  );
  if (linked === file) {
    app.workspace.handleLinkContextMenu(menu, file.path, "", leaf);
  } else {
    app.workspace.trigger("file-menu", menu, file, "link-context-menu", leaf);
  }
  menu.showAtMouseEvent(event);
}

/** Shows {@link showLinkMenu} for the symbol `image`, from the leaf it is in. */
export function showSymbolMenu(
  app: App,
  file: TFile,
  image: HTMLImageElement,
  event: MouseEvent,
): void {
  showLinkMenu(app, file, leafOf(app, image), event);
}
