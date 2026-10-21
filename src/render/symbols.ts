// Shows symbols in notes as characters. Every image of a symbol file, on any
// surface that shows one, is tagged, so that styles.css sizes it to the line
// box, puts its baseline on the text's, and paints its ink in the text colour
// through a mask of its own pixels. One observer per window finds them as
// Obsidian adds them.

import {
  cssUrl,
  dropFor,
  explicitHeight,
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

/** The custom properties a tagged image gets: its mask, and its drop. */
const maskProperty = "--inkline-mask";
const dropProperty = "--inkline-drop";

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
 * written, ending in `.ink.png`, or a size, as `24` or `24x36`.
 */
function authoredText(image: HTMLImageElement): string | undefined {
  const alt = image.getAttribute("alt")?.trim() ?? "";
  if (alt === "" || /\.ink\.png$/i.test(alt) || /^\d+(?:x\d+)?$/.test(alt)) {
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
    image.removeAttribute(placeAttribute);
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
  const holders: HTMLElement[] = [image];
  if (embed?.instanceOf(HTMLElement) === true) {
    embed.addClass(embedClass);
    holders.push(embed);
  }
  if (!sized(image)) {
    for (const holder of holders) holder.style.removeProperty(dropProperty);
    return;
  }
  const drop = (): void => {
    // Untagged meanwhile, as when its address changed or Inkline stopped.
    if (!image.hasClass(symbolClass)) return;
    const height = explicitHeight(
      image.getAttribute("width"),
      image.getAttribute("height"),
      image.naturalWidth,
      image.naturalHeight,
    );
    if (height === undefined) return;
    for (const holder of holders) {
      holder.style.setProperty(dropProperty, dropFor(height));
    }
  };
  drop();
  // The width alone gives the height only once the image's own size is known.
  if (!image.complete) image.addEventListener("load", drop, { once: true });
}

/** Removes what {@link tagImage} added. */
export function untagImage(image: HTMLImageElement): void {
  if (!image.hasClass(symbolClass)) return;
  image.removeClass(symbolClass);
  image.style.removeProperty(maskProperty);
  image.style.removeProperty(dropProperty);
  unnameImage(image);
  const embed = image.parentElement?.closest(`.${embedClass}`);
  if (embed?.instanceOf(HTMLElement) === true) {
    embed.removeClass(embedClass);
    embed.style.removeProperty(dropProperty);
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

  constructor(vault: string) {
    this.#vault = vault;
  }

  readonly #observers = new Map<Document, MutationObserver>();

  /** Starts tagging symbols in `doc`, a window's document. */
  watch(doc: Document): void {
    if (this.#observers.has(doc)) return;
    const view = doc.defaultView;
    if (view === null) return;
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
      attributeFilter: ["src", "width", "height"],
    });
    this.#observers.set(doc, observer);
    tagWithin(doc.body, this.#vault);
  }

  /** Stops tagging symbols in `doc`, and untags those it has. */
  unwatch(doc: Document): void {
    const observer = this.#observers.get(doc);
    if (observer === undefined) return;
    observer.disconnect();
    this.#observers.delete(doc);
    for (const image of Array.from(doc.getElementsByTagName("img"))) {
      untagImage(image);
    }
  }

  /** Stops tagging in every window. */
  stop(): void {
    for (const doc of [...this.#observers.keys()]) this.unwatch(doc);
  }
}
