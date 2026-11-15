// Shows symbols in notes as characters. Every image of a symbol file, on any
// surface that shows one, is tagged, so that styles.css sizes it to the line
// box, puts its baseline on the text's, and paints its ink in the text colour
// through a mask of its own pixels. One observer per window finds them as
// Obsidian adds them.

import {
  aspectRatio,
  cssUrl,
  dropFor,
  explicitHeight,
  explicitWidth,
  isSymbolUrl,
  symbolName,
} from "./layout.ts";

/** The class a symbol's image gets, which styles.css styles. */
export const symbolClass = "inkline-symbol";

/**
 * A class that marks an element whose symbols are text, as a list of them
 * is, alongside a note's own text.
 */
export const textClass = "inkline-text";

/**
 * Where symbols are text: a note's rendered text, as in Reading view, embeds,
 * hover previews, and canvas cards; the editor's text; and what marks itself
 * so. A symbol file shown on its own, as in its own tab or a canvas's image
 * node, is a picture there, and keeps its size.
 */
const textSelector = `.markdown-rendered, .cm-content, .${textClass}`;

/**
 * The class the embed around a symbol's image gets: in Live Preview the
 * image is a block inside an inline embed, which is what lines up with the
 * text, so the embed takes the drop there.
 */
export const embedClass = "inkline-symbol-embed";

/**
 * The custom properties a tagged image gets: its mask; its width over its
 * height, from which styles.css sizes the mask; and, with an explicit size,
 * its drop, and the width a size of only a width asks for, from which
 * styles.css lessens the drop where a narrower space shrinks it.
 */
const maskProperty = "--inkline-mask";
const ratioProperty = "--inkline-ratio";
const dropProperty = "--inkline-drop";
const widthProperty = "--inkline-width";

/** The properties that follow the image's size, which its embed gets too. */
const sizeProperties = [ratioProperty, dropProperty, widthProperty];

/**
 * The attribute a symbol's name goes in: Obsidian shows it as a tooltip on
 * hover, and screen readers read it as the image's name.
 */
const nameAttribute = "aria-label";

/** Where the name Inkline gave an image is kept, so that only it is removed. */
const nameMark = "data-inkline-name";

/**
 * Where Obsidian shows the tooltip: above, as it does for its own links in
 * text, rather than over the next line; and the mark that Inkline set it.
 */
const placeAttribute = "data-tooltip-position";
const placeMark = "data-inkline-placed";

/**
 * The text an embed's author wrote for its image, as an alias or alt text,
 * if any: not what Obsidian puts there of itself, which is the link as
 * written, ending in `.ink.png`, or followed by the heading or block it
 * names, as `x.ink.png > top`, or a size, as `24` or `24x36`.
 */
function authoredText(image: HTMLImageElement): string | undefined {
  const alt = image.getAttribute("alt")?.trim() ?? "";
  if (
    alt === "" ||
    /\.ink\.png(?:$| > )/i.test(alt) ||
    /^\d+(?:x\d+)?$/.test(alt)
  ) {
    return undefined;
  }
  return alt;
}

/**
 * Gives `image` a name, which Obsidian shows as its tooltip and screen
 * readers read: the text its embed's author wrote for it, or else its
 * symbol's name. An image hidden from screen readers, as a picture beside
 * its name in a list is, or with a name of its own, keeps what it has.
 */
function nameImage(image: HTMLImageElement, src: string): void {
  if (image.getAttribute("aria-hidden") === "true") return;
  const current = image.getAttribute(nameAttribute);
  if (current !== null && current !== image.getAttribute(nameMark)) return;
  const name = authoredText(image) ?? symbolName(src);
  image.setAttribute(nameAttribute, name);
  image.setAttribute(nameMark, name);
  if (!image.hasAttribute(placeAttribute)) {
    image.setAttribute(placeAttribute, "top");
    image.setAttribute(placeMark, "");
  }
}

/** Removes the name {@link nameImage} gave `image`, if it still has it. */
function unnameImage(image: HTMLImageElement): void {
  const given = image.getAttribute(nameMark);
  if (given === null) return;
  if (image.getAttribute(nameAttribute) === given) {
    image.removeAttribute(nameAttribute);
  }
  image.removeAttribute(nameMark);
  if (image.hasAttribute(placeMark)) {
    // Unless it was changed since.
    if (image.getAttribute(placeAttribute) === "top") {
      image.removeAttribute(placeAttribute);
    }
    image.removeAttribute(placeMark);
  }
}

/** Whether an image has a size of its own, as `![[x.ink.png|24]]` gives. */
function sized(image: HTMLImageElement): boolean {
  return image.hasAttribute("width") || image.hasAttribute("height");
}

/**
 * Tags `image` as a symbol if its URL is a symbol file's, or untags it if it
 * is not one any more, keeping its mask and drop current.
 */
export function tagImage(image: HTMLImageElement, vault: string): void {
  // The attribute's address, which currentSrc follows only once it loads.
  const src = image.src || image.currentSrc;
  if (!isSymbolUrl(src, vault) || image.closest(textSelector) === null) {
    untagImage(image);
    return;
  }
  image.addClass(symbolClass);
  image.style.setProperty(maskProperty, cssUrl(src));
  nameImage(image, src);
  const embed = image.parentElement?.closest(".image-embed");
  if (embed?.instanceOf(HTMLElement) === true) embed.addClass(embedClass);
  if (!sized(image)) {
    for (const holder of holdersOf(image)) {
      holder.style.removeProperty(dropProperty);
      holder.style.removeProperty(widthProperty);
    }
  }
  measureImage(image);
}

/** A tagged image, and in Live Preview the embed that takes its drop. */
function holdersOf(image: HTMLImageElement): HTMLElement[] {
  const embed = image.parentElement?.closest(`.${embedClass}`);
  return embed?.instanceOf(HTMLElement) === true ? [image, embed] : [image];
}

/**
 * Gives a tagged image the properties that follow its size: with an explicit
 * size, its drop, at once for a size with a height and once the image's own
 * size is known for one of only a width; and once that is known, its width
 * over its height, and the width a size of only a width asks for. Before it
 * loads, the load listener of the document it is in, which
 * {@link SymbolRenderer.watch} adds, calls this again: one listener for a
 * document rather than one for each image, as tagging a thousand images
 * measurably slowed with one each.
 */
function measureImage(image: HTMLImageElement): void {
  // Untagged meanwhile, as when its address changed or Inkline stopped.
  if (!image.hasClass(symbolClass)) return;
  const holders = holdersOf(image);
  const width = image.getAttribute("width");
  const height = image.getAttribute("height");
  if (sized(image)) {
    const shown = explicitHeight(
      width,
      height,
      image.naturalWidth,
      image.naturalHeight,
    );
    if (shown !== undefined) {
      for (const holder of holders) {
        holder.style.setProperty(dropProperty, dropFor(shown));
      }
    }
  }
  const ratio = aspectRatio(image.naturalWidth, image.naturalHeight);
  if (ratio === undefined) return;
  const asked = sized(image) ? explicitWidth(width, height) : undefined;
  for (const holder of holders) {
    holder.style.setProperty(ratioProperty, String(ratio));
    if (asked === undefined) holder.style.removeProperty(widthProperty);
    else holder.style.setProperty(widthProperty, `${String(asked)}px`);
  }
}

/**
 * Whether an event's target is a node. A load's target in a popout window,
 * or in a canvas card's editor frame, is an image of the main window's, of
 * which that window's own `HTMLImageElement` knows nothing: Obsidian's
 * `instanceOf` tells it apart in any window, but needs a node.
 */
function isNode(target: EventTarget | null): target is Node {
  return target !== null && "nodeType" in target;
}

/** Removes what {@link tagImage} added. */
export function untagImage(image: HTMLImageElement): void {
  if (!image.hasClass(symbolClass)) return;
  image.removeClass(symbolClass);
  image.style.removeProperty(maskProperty);
  for (const property of sizeProperties) image.style.removeProperty(property);
  unnameImage(image);
  const embed = image.parentElement?.closest(`.${embedClass}`);
  if (embed?.instanceOf(HTMLElement) === true) {
    embed.removeClass(embedClass);
    for (const property of sizeProperties) embed.style.removeProperty(property);
  }
}

/** Tags every image in or at `node`. */
export function tagWithin(node: Node, vault: string): void {
  if (node.instanceOf(HTMLImageElement)) {
    tagImage(node, vault);
    return;
  }
  if (!node.instanceOf(Element)) return;
  for (const image of Array.from(node.getElementsByTagName("img"))) {
    tagImage(image, vault);
  }
}

/**
 * Tags symbols' images in the windows it watches, as they are added or their
 * sources change, and untags them all when it stops.
 */
export class SymbolRenderer {
  /** The address the vault's files start with: `Platform.resourcePathPrefix`. */
  readonly #vault: string;
  #scale = 1;
  #textColor = true;

  constructor(vault: string) {
    this.#vault = vault;
  }

  /** How each watched document stops its observer and close listener. */
  readonly #watching = new Map<Document, () => void>();

  /** Reloads instances of one changed file in every watched document. */
  refresh(src: string): void {
    if (!isSymbolUrl(src, this.#vault)) return;
    const address = src.split(/[?#]/, 1)[0];
    const refreshed = new URL(src);
    // A distinct request even if two writes share a filesystem timestamp.
    refreshed.searchParams.set("inkline", crypto.randomUUID());
    for (const doc of this.#watching.keys()) {
      for (const image of Array.from(doc.getElementsByTagName("img"))) {
        if (
          image.hasClass(symbolClass) &&
          image.src.split(/[?#]/, 1)[0] === address
        ) {
          image.src = refreshed.href;
          tagImage(image, this.#vault);
        }
      }
    }
  }

  /** Applies display settings to existing windows and those opened later. */
  configure(scale: number, textColor: boolean): void {
    this.#scale = scale;
    this.#textColor = textColor;
    for (const doc of this.#watching.keys()) this.#configureDocument(doc);
  }

  #configureDocument(doc: Document): void {
    doc.documentElement.style.setProperty(
      "--inkline-scale",
      String(this.#scale),
    );
    doc.documentElement.toggleClass("inkline-stored-color", !this.#textColor);
  }

  /** Starts tagging symbols in `doc`, a window's document. */
  watch(doc: Document): void {
    if (this.#watching.has(doc)) return;
    const view = doc.defaultView;
    if (view === null || view.closed) return;
    this.#configureDocument(doc);
    const observer = new view.MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          if (record.target.instanceOf(HTMLImageElement)) {
            tagImage(record.target, this.#vault);
          }
          continue;
        }
        for (const node of Array.from(record.addedNodes)) {
          tagWithin(node, this.#vault);
        }
      }
    });
    observer.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      // The address and size, and the alt text, which Live Preview changes
      // in place as an alias is edited, and which a name can come from.
      attributeFilter: ["src", "width", "height", "alt"],
    });
    // An image's load does not bubble, but the document sees it on the way
    // down, before the image does.
    const loaded = (event: Event): void => {
      const { target } = event;
      if (isNode(target) && target.instanceOf(HTMLImageElement)) {
        measureImage(target);
      }
    };
    doc.addEventListener("load", loaded, true);
    const closed = (): void => {
      this.unwatch(doc);
    };
    view.addEventListener("unload", closed, { once: true });
    this.#watching.set(doc, () => {
      observer.disconnect();
      doc.removeEventListener("load", loaded, true);
      view.removeEventListener("unload", closed);
    });
    tagWithin(doc.body, this.#vault);
  }

  /** Stops tagging symbols in `doc`, and untags those it has. */
  unwatch(doc: Document): void {
    const stop = this.#watching.get(doc);
    if (stop === undefined) return;
    stop();
    this.#watching.delete(doc);
    doc.documentElement.style.removeProperty("--inkline-scale");
    doc.documentElement.removeClass("inkline-stored-color");
    for (const image of Array.from(doc.getElementsByTagName("img"))) {
      untagImage(image);
    }
  }

  /** Stops tagging in every window. */
  stop(): void {
    for (const doc of [...this.#watching.keys()]) this.unwatch(doc);
  }
}
