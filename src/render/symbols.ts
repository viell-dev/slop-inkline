// Shows symbols in notes as characters. Every image of a symbol file, on any
// surface that shows one, is tagged, so that styles.css sizes it to the line
// box, puts its baseline on the text's, and paints its ink in the text colour
// through a mask of its own pixels. One observer per window finds them as
// Obsidian adds them.

import { lineBox } from "../ink/geometry.ts";

/** The class a symbol's image gets, which styles.css styles. */
export const symbolClass = "inkline-symbol";

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
 * How far below its bottom edge, as a fraction of its height, a symbol's
 * baseline lies: the line box's, a quarter of the way up.
 */
const baselineFraction = (lineBox.height - lineBox.baseline) / lineBox.height;

/**
 * Whether an image's URL is a symbol file's: whether its path, before any
 * query or fragment, ends in `.ink.png`, in any letter case. Obsidian gives
 * vault images their file's path, with a query that changes when the file
 * does.
 */
export function isSymbolUrl(src: string): boolean {
  const path = src.split(/[?#]/, 1)[0] ?? "";
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A stray % leaves the path as it is.
  }
  return decoded.toLowerCase().endsWith(".ink.png");
}

/** A CSS `url()` for `src`, with what would end its string escaped. */
export function cssUrl(src: string): string {
  const escaped = src
    .replace(/["\\]/g, "\\$&")
    .replace(/\n/g, "\\a ")
    .replace(/\r/g, "\\d ")
    .replace(/\f/g, "\\c ");
  return `url("${escaped}")`;
}

/**
 * How far below the text's baseline a symbol shown `height` pixels tall puts
 * its bottom edge, as a CSS `vertical-align`, so that its own baseline is on
 * the text's.
 */
export function dropFor(height: number): string {
  return `${String(-height * baselineFraction)}px`;
}

/**
 * The height, in CSS pixels, at which a symbol with an explicit size shows:
 * its `height` attribute, or else its `width` attribute at its own aspect
 * ratio. Undefined while that is not known yet, as before it loads.
 */
export function explicitHeight(
  widthAttribute: string | null,
  heightAttribute: string | null,
  naturalWidth: number,
  naturalHeight: number,
): number | undefined {
  const height = Number.parseFloat(heightAttribute ?? "");
  if (Number.isFinite(height) && height > 0) return height;
  const width = Number.parseFloat(widthAttribute ?? "");
  if (!Number.isFinite(width) || width <= 0) return undefined;
  if (naturalWidth <= 0 || naturalHeight <= 0) return undefined;
  return (width * naturalHeight) / naturalWidth;
}

/** Whether an image has a size of its own, as `![[x.ink.png|24]]` gives. */
function sized(image: HTMLImageElement): boolean {
  return image.hasAttribute("width") || image.hasAttribute("height");
}

/**
 * Tags `image` as a symbol if its URL is a symbol file's, or untags it if it
 * is not one any more, keeping its mask and drop current.
 */
export function tagImage(image: HTMLImageElement): void {
  // The attribute's address, which currentSrc follows only once it loads.
  const src = image.src || image.currentSrc;
  if (!isSymbolUrl(src)) {
    untagImage(image);
    return;
  }
  image.addClass(symbolClass);
  image.style.setProperty(maskProperty, cssUrl(src));
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
  const embed = image.parentElement?.closest(`.${embedClass}`);
  if (embed?.instanceOf(HTMLElement) === true) {
    embed.removeClass(embedClass);
    embed.style.removeProperty(dropProperty);
  }
}

/** Tags every image in or at `node`. */
export function tagWithin(node: Node): void {
  if (node.instanceOf(HTMLImageElement)) {
    tagImage(node);
    return;
  }
  if (!node.instanceOf(Element)) return;
  for (const image of Array.from(node.getElementsByTagName("img"))) {
    tagImage(image);
  }
}

/**
 * Tags symbols' images in the windows it watches, as they are added or their
 * sources change, and untags them all when it stops.
 */
export class SymbolRenderer {
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
            tagImage(record.target);
          }
          continue;
        }
        for (const node of Array.from(record.addedNodes)) tagWithin(node);
      }
    });
    observer.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "width", "height"],
    });
    this.#observers.set(doc, observer);
    tagWithin(doc.body);
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
