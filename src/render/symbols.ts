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

/**
 * PROTOTYPE for #167, section 3, not for release: a symbol's main reading and
 * translation, shown as ruby above and below it.
 */
export interface Annotation {
  readonly reading?: string;
  readonly translation?: string;
}

/** PROTOTYPE: what a symbol's image says about it, by its address. */
export type Annotate = (src: string) => Annotation | undefined;

/** PROTOTYPE: the class of the ruby elements Inkline puts around a symbol. */
export const rubyClass = "inkline-ruby";

/** PROTOTYPE: what an image's ruby holds now, so that it is not redone. */
const rubyMark = "data-inkline-ruby";

/** PROTOTYPE: the ruby elements Inkline put around `image`, innermost first. */
function rubiesAround(image: HTMLImageElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  let base: Element = image;
  let parent = image.parentElement;
  while (
    parent !== null &&
    parent.localName === "ruby" &&
    parent.hasClass(rubyClass) &&
    parent.firstElementChild === base
  ) {
    found.push(parent);
    base = parent;
    parent = parent.parentElement;
  }
  return found;
}

/** PROTOTYPE: takes away the ruby Inkline put around `image`. */
function unwrapRuby(image: HTMLImageElement): void {
  const rubies = rubiesAround(image);
  image.removeAttribute(rubyMark);
  const outer = rubies.at(-1);
  if (outer !== undefined) outer.replaceWith(image);
}

/** PROTOTYPE: puts `base` in a ruby with `text` over or under it. */
function wrapRuby(
  base: Element,
  text: string,
  position: "over" | "under",
): HTMLElement {
  const doc = base.ownerDocument;
  const ruby = doc.createElement("ruby");
  ruby.addClass(rubyClass, `${rubyClass}-${position}`);
  const rt = doc.createElement("rt");
  // A value can hold bidirectional controls: keep them to itself.
  const bdi = doc.createElement("bdi");
  bdi.textContent = text;
  rt.append(bdi);
  base.replaceWith(ruby);
  ruby.append(base, rt);
  return ruby;
}

/** PROTOTYPE: gives `image` the ruby `annotation` asks for, or none. */
function annotateImage(
  image: HTMLImageElement,
  annotation: Annotation | undefined,
): void {
  const reading = annotation?.reading ?? "";
  const translation = annotation?.translation ?? "";
  const key = `${reading}\u0000${translation}`;
  const wanted = reading !== "" || translation !== "";
  if (wanted && image.getAttribute(rubyMark) === key) {
    if (rubiesAround(image).length > 0) return;
  }
  if (!wanted && !image.hasAttribute(rubyMark)) return;
  unwrapRuby(image);
  if (!wanted) return;
  let base: Element = image;
  if (reading !== "") base = wrapRuby(base, reading, "over");
  if (translation !== "") wrapRuby(base, translation, "under");
  image.setAttribute(rubyMark, key);
}

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
export function tagImage(
  image: HTMLImageElement,
  vault: string,
  annotate?: Annotate,
): void {
  // The attribute's address, which currentSrc follows only once it loads.
  const src = image.src || image.currentSrc;
  if (!isSymbolUrl(src, vault) || image.closest(textSelector) === null) {
    untagImage(image);
    return;
  }
  image.addClass(symbolClass);
  image.style.setProperty(maskProperty, cssUrl(src));
  nameImage(image, src);
  annotateImage(image, annotate?.(src));
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
  unwrapRuby(image);
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
export function tagWithin(
  node: Node,
  vault: string,
  annotate?: Annotate,
): void {
  if (node.instanceOf(HTMLImageElement)) {
    tagImage(node, vault, annotate);
    return;
  }
  if (!node.instanceOf(Element)) return;
  for (const image of Array.from(node.getElementsByTagName("img"))) {
    tagImage(image, vault, annotate);
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
  /** PROTOTYPE: where readings and translations come from, if shown. */
  #annotate: Annotate | undefined;
  /** PROTOTYPE: a class for every watched document's root, if any. */
  #rubyRoot = "";

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

  /**
   * PROTOTYPE: shows readings and translations from `annotate` as ruby, with
   * `root` as a class on every watched document's root.
   */
  annotateWith(annotate: Annotate | undefined, root: string): void {
    this.#annotate = annotate;
    for (const doc of this.#watching.keys()) {
      if (this.#rubyRoot !== "")
        doc.documentElement.removeClass(this.#rubyRoot);
    }
    this.#rubyRoot = root;
    for (const doc of this.#watching.keys()) this.#configureDocument(doc);
    this.retag();
  }

  /** PROTOTYPE: tags every watched image again, as what they say changed. */
  retag(): void {
    for (const doc of this.#watching.keys()) {
      tagWithin(doc.body, this.#vault, this.#annotate);
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
    if (this.#rubyRoot !== "") doc.documentElement.addClass(this.#rubyRoot);
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
            tagImage(record.target, this.#vault, this.#annotate);
          }
          continue;
        }
        for (const node of Array.from(record.addedNodes)) {
          tagWithin(node, this.#vault, this.#annotate);
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
    const closed = (): void => {
      this.unwatch(doc);
    };
    view.addEventListener("unload", closed, { once: true });
    this.#watching.set(doc, () => {
      observer.disconnect();
      view.removeEventListener("unload", closed);
    });
    tagWithin(doc.body, this.#vault, this.#annotate);
  }

  /** Stops tagging symbols in `doc`, and untags those it has. */
  unwatch(doc: Document): void {
    const stop = this.#watching.get(doc);
    if (stop === undefined) return;
    stop();
    this.#watching.delete(doc);
    doc.documentElement.style.removeProperty("--inkline-scale");
    doc.documentElement.removeClass("inkline-stored-color");
    if (this.#rubyRoot !== "") doc.documentElement.removeClass(this.#rubyRoot);
    for (const image of Array.from(doc.getElementsByTagName("img"))) {
      untagImage(image);
    }
  }

  /** Stops tagging in every window. */
  stop(): void {
    for (const doc of [...this.#watching.keys()]) this.unwatch(doc);
  }
}
