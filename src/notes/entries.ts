// Where a symbol in a note can be opened for editing from: the embed at the
// cursor, for a command, and a symbol's image, for a right-click or a
// double-click, wherever it is. editSymbol in symbols.ts opens it. Also the
// clicks and keys that would open Obsidian's image viewer on a symbol, which
// Inkline keeps shut: a symbol is read at the size of the text around it.

import {
  Component,
  Menu,
  parseLinktext,
  type App,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { isInkPath } from "../format/ink-file.ts";
import { symbolClass } from "../render/symbols.ts";
import { insideCodeBlock } from "./code.ts";
import { embedAt } from "./links.ts";

/**
 * The symbol file that the embed at `offset` in `text`, the note at
 * `notePath`, shows: the embed with the offset on it or at either end, as a
 * cursor just after one is. Undefined when there is no embed there, it
 * shows no symbol, or it is in front matter or a code block, where it is
 * text and shows nothing.
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
 * The symbol file at `src`, an image's address, which Obsidian gives as the
 * file's resource path; undefined for any other address.
 */
export function symbolAtAddress(app: App, src: string): TFile | undefined {
  const address = withoutQuery(src);
  if (address === "") return undefined;
  return app.vault
    .getFiles()
    .find(
      (file) =>
        isInkPath(file.path) &&
        withoutQuery(app.vault.getResourcePath(file)) === address,
    );
}

/** The symbol file an image shows, by its address; undefined for any other. */
export function symbolOfImage(
  app: App,
  image: HTMLImageElement,
): TFile | undefined {
  return symbolAtAddress(app, image.src || image.currentSrc);
}

/** `node` if it is a symbol's image, which Inkline has tagged. */
function asSymbol(node: Node | null): HTMLImageElement | undefined {
  // Not `instanceof`: a popout window's notes are drawn with the main
  // window's classes, and its own elements have the popout's.
  return node?.instanceOf(HTMLImageElement) === true &&
    node.hasClass(symbolClass)
    ? node
    : undefined;
}

/**
 * The note around `image`, rendered or in an editor. A list of symbols, as
 * type to insert shows, is in neither.
 */
function noteAround(image: HTMLImageElement): Element | null {
  return image.closest(".markdown-preview-view, .markdown-source-view");
}

/**
 * The symbol right-clicked in a rendered note, as in Reading view, an
 * embedded note, or a focused canvas card, if any.
 */
export function symbolInRenderedNote(
  event: MouseEvent,
): HTMLImageElement | undefined {
  const image = asSymbol(event.targetNode);
  if (image === undefined) return undefined;
  return noteAround(image)?.hasClass("markdown-preview-view") === true
    ? image
    : undefined;
}

/**
 * The symbol right-clicked through the sheet a canvas keeps over a card that
 * is not focused, which takes the pointer, so that the event never names the
 * image. The symbol is the one at the pointer within that card alone: another
 * card can lie beneath it. Without such a sheet, as if Obsidian renames it,
 * there is none, and the canvas's menu stays as it is.
 */
function symbolUnderCardSheet(event: MouseEvent): HTMLImageElement | undefined {
  const sheet = event.targetNode;
  if (
    sheet?.instanceOf(HTMLElement) !== true ||
    !sheet.hasClass("canvas-node-content-blocker")
  ) {
    return undefined;
  }
  const card = sheet.parentElement;
  for (const found of sheet.doc.elementsFromPoint(
    event.clientX,
    event.clientY,
  )) {
    const image = asSymbol(found);
    if (image !== undefined && card?.contains(image) === true) return image;
  }
  return undefined;
}

/**
 * The symbol right-clicked where Obsidian may build a menu of its own, if
 * any: in an editor, and under a canvas card's sheet.
 */
export function symbolInBlock(event: MouseEvent): HTMLImageElement | undefined {
  const image = asSymbol(event.targetNode);
  if (image === undefined) return symbolUnderCardSheet(event);
  return noteAround(image)?.hasClass("markdown-source-view") === true
    ? image
    : undefined;
}

/**
 * Whether `event` is a click of the main button with no key held, as a
 * double-click that opens a symbol is: Shift, Ctrl, Alt, or Cmd with a click
 * keep what Obsidian does with them, as extending a selection.
 */
function plainClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  );
}

/**
 * The symbol that a double-click, or a click after the first of one, lands
 * on in a note, if any: its image in an editor or a rendered note, or one
 * under the sheet a canvas keeps over a card that is not focused. A click
 * that Obsidian answers by redrawing the symbol, as a Live Preview callout
 * shown as text does, leaves the next click nothing to land on.
 */
export function symbolDoubleClicked(
  event: MouseEvent,
): HTMLImageElement | undefined {
  if (event.detail < 2 || !plainClick(event)) return undefined;
  const image = asSymbol(event.targetNode);
  if (image === undefined) return symbolUnderCardSheet(event);
  return noteAround(image) === null ? undefined : image;
}

/**
 * The embed of the picture an editor in Live Preview has selected, as a click
 * on it leaves it: Obsidian marks it so, and takes the mark off as the
 * selection moves, in every version tested.
 */
const selectedEmbed = ".image-embed.is-selected";

/** Whether `image`, in an editor, is the picture Live Preview has selected. */
function selectedInEditor(image: HTMLImageElement): boolean {
  const embed = image.parentElement?.closest(".image-embed");
  return embed?.matches(selectedEmbed) === true;
}

/**
 * The symbol that `event`, a click, would open Obsidian's image viewer on, if
 * any, whatever keys it has: in a rendered note, as in Reading view, an
 * embedded note, a hover preview, or a focused canvas card, a click on any
 * picture opens it; in an editor, a click on the picture Live Preview has
 * selected does, while a click on any other selects it. Obsidian opens the
 * viewer only for a click whose default is not prevented by then, and nothing
 * else it does with such a click waits on that, as selecting text with Shift
 * or following a link the picture is in.
 */
export function symbolViewerClicked(
  event: MouseEvent,
): HTMLImageElement | undefined {
  const image = asSymbol(event.targetNode);
  if (image === undefined) return undefined;
  const note = noteAround(image);
  if (note === null) return undefined;
  return note.hasClass("markdown-preview-view") || selectedInEditor(image)
    ? image
    : undefined;
}

/**
 * The symbol that `event`, a key, would open Obsidian's image viewer on, if
 * any: Space alone, in an editor whose selected picture is a symbol. The
 * editor is the one the key goes to, whose text is its target: a table's
 * cells in Live Preview have editors of their own, inside the note's.
 */
export function symbolViewerKey(
  event: KeyboardEvent,
): HTMLImageElement | undefined {
  if (
    event.key !== " " ||
    event.isComposing ||
    event.shiftKey ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    return undefined;
  }
  const text = event.targetNode;
  if (text?.instanceOf(HTMLElement) !== true || !text.hasClass("cm-content")) {
    return undefined;
  }
  for (const embed of text.findAll(selectedEmbed)) {
    if (embed.closest(".cm-content") !== text) continue;
    const image = asSymbol(embed.querySelector("img"));
    if (image !== undefined) return image;
  }
  return undefined;
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
 * Keeps a menu that has been chosen from off the keyboard, as a child of it.
 *
 * Obsidian shows a menu at once, but the menu takes the keyboard only when it
 * loads, in a timer that hiding it doesn't cancel. When that timer runs after
 * an item is chosen, the menu takes the keyboard from whatever the item opened
 * though nothing shows it, and the editor's shortcuts stop working: the next
 * Escape only unloads the menu, and goes on to Obsidian's own Escape handling,
 * which sends the focus to the note and so back to the name field.
 *
 * A menu's children load with it, so this one undoes that load before any key
 * can reach the menu, whenever the timer runs: a key is a task of its own, and
 * a microtask runs first. Waiting for the microtask also keeps this right
 * whichever order the menu and its children load in, as unloading a menu before
 * it has finished loading would leave it holding the keyboard for good. A menu
 * that loads before the choice has nothing to undo: hiding it unloads it. See
 * #78.
 */
export class MenuChoice extends Component {
  /** Whether an item of the menu was chosen. */
  chosen = false;
  readonly #menu: Menu;

  constructor(menu: Menu) {
    super();
    this.#menu = menu;
  }

  override onload(): void {
    if (!this.chosen) return;
    queueMicrotask(() => {
      this.#menu.unload();
    });
  }
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
