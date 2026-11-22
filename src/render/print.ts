// Prints symbols in the text colour without a CSS mask (#255). Chromium's PDF
// writer draws a masked fill twice, the first time through a soft mask that
// adds nothing, and PDF viewers that anti-alias the two draws apart leave a
// faint line along a symbol's box where it meets the edge of the group they
// are drawn in. A symbol in its stored colour is an image with its own alpha,
// drawn once, and shows no such line. So in Obsidian's PDF export window, each
// symbol in the text colour shows, once it is ready, a copy of its file's
// pixels in the colour its text prints in, the way a symbol in its stored
// colour shows its own. Until its copy is ready, or if none can be made, a
// symbol keeps its mask, and prints as it did before.
//
// Obsidian prints once the promises that the Markdown post-processors it ran
// for the export returned have resolved, and 200 ms more, in 1.13.4 and in
// 1.15.1 alike, for the note's own text and for the notes it embeds. Inkline's
// post-processor returns the promise of {@link PrintCopies.copy}.

import { readChunks, writeChunks } from "../format/png.ts";
import { decodePng, nextTask, readPixels } from "../ink/canvas.ts";
import type { RgbaPixels } from "../ink/pixels.ts";

/**
 * The class an image gets while it shows its print copy, which styles.css
 * styles.
 */
export const printCopyClass = "inkline-print-copy";

/**
 * How long a post-processor's promise goes on waiting once no copy, and no
 * stylesheet its colours come from, has got any further: a symbol whose copy
 * is not ready then prints from its mask, as before. Copies take well under a
 * second, even of a symbol 4,000 pixels wide, but the export shares the main
 * window with Obsidian's own work for it, and a fixed limit would cut off a
 * busy export that is still getting on: in Obsidian 1.13.4 in a busy
 * container, Obsidian took about 5 seconds to render a note of 127 symbols,
 * and some of their copies were not ready 10 seconds after that. A read of a
 * file that never ends holds the export this long.
 */
export const printWait = 10_000;

/** An RGBA colour, each channel 0 to 255. */
export type Rgba = readonly [number, number, number, number];

/**
 * Pixels in `colour`, in the shape of `pixels`: each pixel `colour`, with the
 * alpha of the pixel at its place times the colour's own. That is what a CSS
 * mask of the picture makes of a background of that colour.
 */
export function tinted(pixels: RgbaPixels, colour: Rgba): RgbaPixels {
  const [red, green, blue, alpha] = colour;
  const { width, height, data } = pixels;
  const out = new Uint8ClampedArray(data.length);
  for (let at = 0; at < data.length; at += 4) {
    out[at] = red;
    out[at + 1] = green;
    out[at + 2] = blue;
    out[at + 3] = Math.round(((data[at + 3] ?? 0) * alpha) / 255);
  }
  return { width, height, data: out };
}

/**
 * A PNG file of `pixels`, its rows unfiltered and stored without
 * compression. A copy lives only while its export window does, and Obsidian
 * waits for it, so the time compressing it would take matters more than its
 * size: compressing one 4,000 pixels wide in slices, as a save does, took
 * seconds while the export kept the main window busy.
 */
export function storedPng(pixels: RgbaPixels): Uint8Array<ArrayBuffer> {
  const { width, height, data } = pixels;
  const stride = width * 4;
  // Each row after a byte for its filter: 0, none.
  const rows = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rows.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  // zlib's header, stored blocks of at most 65,535 bytes, and its Adler-32.
  const most = 65_535;
  const blocks = Math.max(1, Math.ceil(rows.length / most));
  const zlib = new Uint8Array(2 + blocks * 5 + rows.length + 4);
  zlib.set([0x78, 0x01]);
  let at = 2;
  for (let block = 0; block < blocks; block++) {
    const start = block * most;
    const length = Math.min(most, rows.length - start);
    zlib.set(
      [
        block === blocks - 1 ? 1 : 0,
        length & 0xff,
        length >>> 8,
        ~length & 0xff,
        (~length >>> 8) & 0xff,
      ],
      at,
    );
    zlib.set(rows.subarray(start, start + length), at + 5);
    at += 5 + length;
  }
  let low = 1;
  let high = 0;
  // The remainders are taken every 5,552 bytes, as zlib's own code does,
  // rather than for every byte.
  for (let start = 0; start < rows.length; start += 5552) {
    const end = Math.min(rows.length, start + 5552);
    for (let index = start; index < end; index++) {
      low += rows[index] ?? 0;
      high += low;
    }
    low %= 65_521;
    high %= 65_521;
  }
  new DataView(zlib.buffer).setUint32(at, ((high << 16) | low) >>> 0);
  const header = new Uint8Array(13);
  const fields = new DataView(header.buffer);
  fields.setUint32(0, width);
  fields.setUint32(4, height);
  // Bit depth 8, colour type 6 (RGBA), deflate, no filtering, no interlace.
  header.set([8, 6, 0, 0, 0], 8);
  return writeChunks([
    { type: "IHDR", data: header },
    { type: "IDAT", data: zlib },
    { type: "IEND", data: new Uint8Array(0) },
  ]);
}

/**
 * The text of a media query list that matches on the screen where `text`
 * matches in print, as far as its media types go: `print` becomes `all`, and
 * `screen` a type that nothing has. Media features are left to the screen's
 * values. So `print` and `not screen` match, and `screen` and `not print`
 * do not.
 */
export function printMediaText(text: string): string {
  return text.replace(/\b(?:print|screen)\b/gi, (type) =>
    type.toLowerCase() === "print" ? "all" : "inkline-screen",
  );
}

/**
 * Whether a PNG file says which way up it shows, in an `eXIf` chunk, or
 * cannot be read as one. Inkline never writes one, and its decoder ignores
 * it, as the file format says, but Chromium 150 turns such a file's image and
 * mask to match it, where 120 does not: a picture whose ink is at its left
 * printed at its right through the mask in Obsidian 1.15.1, and at its left
 * from a copy, as measured. So such a file makes no copy, and prints from its
 * mask, as the screen shows it.
 */
export function oriented(bytes: Uint8Array): boolean {
  try {
    return readChunks(bytes, () => false).some(({ type }) => type === "eXIf");
  } catch {
    return true;
  }
}

/** A reader of a symbol's file, by the address an image shows it at. */
export type SymbolReader = (src: string) => Promise<Uint8Array> | undefined;

/** What an image that shows its print copy showed before. */
interface Copied {
  readonly source: string;
  readonly copy: string;
}

/** The images that show a print copy. */
const copied = new WeakMap<HTMLImageElement, Copied>();

/**
 * The address of the file `image` shows: its own, rather than its print
 * copy's. An image given another address meanwhile, as by a refresh of its
 * symbol, shows that address, and its copy is done with.
 */
export function ownSource(image: HTMLImageElement): string {
  const src = image.src || image.currentSrc;
  const shown = copied.get(image);
  if (shown === undefined) return src;
  if (src === shown.copy) return shown.source;
  copied.delete(image);
  image.removeClass(printCopyClass);
  return src;
}

/** Shows `image`'s own file again, if it shows its print copy. */
export function uncopy(image: HTMLImageElement): void {
  const shown = copied.get(image);
  if (shown === undefined) return;
  copied.delete(image);
  image.removeClass(printCopyClass);
  if (image.src === shown.copy) image.src = shown.source;
}

/**
 * `colour`, as `getComputedStyle` gives it, in RGBA bytes, by a canvas, which
 * reads every colour syntax that CSS has, or undefined if it cannot read it.
 */
function colourBytes(colour: string): Rgba | undefined {
  const context = new OffscreenCanvas(1, 1).getContext("2d");
  if (context === null) return undefined;
  // A colour that a canvas cannot read leaves its fill as it was.
  context.fillStyle = "#000000";
  context.fillStyle = colour;
  const first = context.fillStyle;
  context.fillStyle = "#ffffff";
  context.fillStyle = colour;
  if (context.fillStyle !== first) return undefined;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(
    0,
    0,
    1,
    1,
  ).data;
  return [red, green, blue, alpha];
}

/**
 * Whether `rule` has a media query list, as `@media` and `@import` rules
 * do. These and the two below ask what a rule has rather than what it is an
 * instance of: the export window's rules are instances of its own window's
 * classes in Obsidian 1.13.4, and of the main window's in 1.15.1, as
 * measured.
 */
function withMedia(rule: CSSRule): rule is CSSRule & { media: MediaList } {
  return "media" in rule;
}

/** Whether `rule` holds rules, as `@media`, `@supports`, and a style rule do. */
function grouping(rule: CSSRule): rule is CSSRule & { cssRules: CSSRuleList } {
  return "cssRules" in rule;
}

/** Whether `rule` brings in a sheet, as `@import` does. */
function importing(rule: CSSRule): rule is CSSImportRule {
  return "styleSheet" in rule;
}

/**
 * Every media query list in `doc`'s stylesheets: each sheet's own, as a
 * link's `media` gives it, and those of its `@media` and `@import` rules, at
 * any depth. A sheet from another origin cannot be read, and is left out.
 */
function mediaLists(doc: Document): MediaList[] {
  const lists: MediaList[] = [];
  const fromSheet = (sheet: CSSStyleSheet): void => {
    lists.push(sheet.media);
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      return;
    }
    fromRules(rules);
  };
  const fromRules = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (withMedia(rule)) lists.push(rule.media);
      if (importing(rule)) {
        if (rule.styleSheet !== null) fromSheet(rule.styleSheet);
      } else if (grouping(rule)) {
        fromRules(rule.cssRules);
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) fromSheet(sheet);
  for (const sheet of doc.adoptedStyleSheets) fromSheet(sheet);
  return lists;
}

/** Whether `element` has an inline style, as HTML and SVG elements do. */
function styled(element: Element): element is Element & ElementCSSInlineStyle {
  return "style" in element;
}

/**
 * Holds off CSS transitions on each of `images` and on every element it
 * inherits its colour from, until the function this returns is called,
 * which gives each back the inline `transition-property` it had. An inline
 * `!important` declaration outranks any stylesheet's. A transition on
 * `color`, as a theme or snippet can give anything, would otherwise make a
 * colour read after a change of media its start, the screen's colour, and
 * the print does not run it. Finishing such transitions once started is not
 * enough: in Chromium 120, a colour read afterwards started another from the
 * screen's colour, as measured.
 */
function holdTransitions(images: readonly HTMLImageElement[]): () => void {
  const held = new Map<ElementCSSInlineStyle, readonly [string, string]>();
  for (const image of images) {
    for (
      let element: Element | null = image;
      element !== null && styled(element) && !held.has(element);
      element = element.parentElement
    ) {
      const { style } = element;
      held.set(element, [
        style.getPropertyValue("transition-property"),
        style.getPropertyPriority("transition-property"),
      ]);
      style.setProperty("transition-property", "none", "important");
    }
  }
  return () => {
    for (const [{ style }, [value, priority]] of held) {
      if (value === "") style.removeProperty("transition-property");
      else style.setProperty("transition-property", value, priority);
    }
  };
}

/**
 * The text colour each of `images` prints in. The page is not printing when
 * this runs, so it reads their computed colours with the rules for print in
 * force and those for the screen out of it: each media query list of the
 * page's stylesheets that names `print` or `screen` takes the text
 * {@link printMediaText} gives it, and back again before this returns, with
 * nothing drawn in between. Obsidian's own print styles give the note's text
 * `color: initial`, which prints black where the screen shows its theme's
 * text colour. Transitions are held off meanwhile, as
 * {@link holdTransitions} says.
 */
export function printColours(
  doc: Document,
  images: readonly HTMLImageElement[],
): Map<HTMLImageElement, string> {
  const view = doc.defaultView;
  const colours = new Map<HTMLImageElement, string>();
  if (view === null) return colours;
  const changed: [MediaList, string][] = [];
  const release = holdTransitions(images);
  try {
    for (const list of mediaLists(doc)) {
      const text = list.mediaText;
      const printed = printMediaText(text);
      if (printed === text) continue;
      list.mediaText = printed;
      changed.push([list, text]);
    }
    for (const image of images) {
      colours.set(image, view.getComputedStyle(image).color);
    }
  } finally {
    for (const [list, text] of changed.reverse()) list.mediaText = text;
    // The page's styles brought up to date while transitions are still held,
    // so that putting the media back starts none either.
    for (const image of images) {
      view.getComputedStyle(image).getPropertyValue("color");
    }
    release();
  }
  return colours;
}

/**
 * Resolves once each stylesheet link in `doc` has loaded or failed. Obsidian
 * copies the main window's stylesheets into its export window, where links
 * load while it renders the note, and it has been seen printing before its
 * own had loaded. The colours read before then would not be the ones the page
 * prints with.
 */
function stylesheetsLoaded(doc: Document): Promise<void> {
  const loading = Array.from(doc.getElementsByTagName("link")).filter(
    (link) => link.relList.contains("stylesheet") && link.sheet === null,
  );
  return Promise.all(
    loading.map(
      (link) =>
        new Promise<void>((resolve) => {
          const done = (): void => {
            resolve();
          };
          link.addEventListener("load", done, { once: true });
          link.addEventListener("error", done, { once: true });
        }),
    ),
  ).then(() => undefined);
}

/** Resolves once `image` has loaded, with whether it has a picture. */
function loaded(image: HTMLImageElement): Promise<boolean> {
  if (image.complete) return Promise.resolve(image.naturalWidth > 0);
  return new Promise((resolve) => {
    const done = (event: Event): void => {
      image.removeEventListener("load", done);
      image.removeEventListener("error", done);
      resolve(event.type === "load" && image.naturalWidth > 0);
    };
    image.addEventListener("load", done);
    image.addEventListener("error", done);
  });
}

/** Resolves after `ms` milliseconds, by the plugin's own window's timer. */
function after(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * The print copies of one export window's symbols: made once for each
 * symbol and colour, shown in place of each image's own file while the
 * window prints, and taken away again when it closes.
 */
export class PrintCopies {
  readonly #doc: Document;
  readonly #read: SymbolReader;
  /** Each symbol's pixels, by its address, or undefined if unreadable. */
  readonly #pixels = new Map<string, Promise<RgbaPixels | undefined>>();
  /** Each copy's address, by its colour and its symbol's address. */
  readonly #copies = new Map<string, Promise<string | undefined>>();
  /** The images given a copy, or being given one. */
  readonly #images = new Set<HTMLImageElement>();
  readonly #addresses = new Set<string>();
  /**
   * The images whose colours are to be read next, all at once: Obsidian
   * gives the post-processors of a note it embeds each section in turn, and
   * each reading restyles the whole page twice.
   */
  #waiting: {
    readonly image: HTMLImageElement;
    readonly read: (colour: string | undefined) => void;
  }[] = [];
  /** When a copy last got further, by the plugin's own window's clock. */
  #progress = performance.now();
  #ended = false;

  constructor(doc: Document, read: SymbolReader) {
    this.#doc = doc;
    this.#read = read;
  }

  /**
   * Gives each of `images` that has none yet its copy, and resolves once
   * each shows it or keeps its mask, or once no copy has got any further for
   * {@link printWait}. Never rejects: a symbol whose copy fails keeps its
   * mask.
   */
  async copy(images: readonly HTMLImageElement[]): Promise<void> {
    const fresh = images.filter((image) => !this.#images.has(image));
    if (fresh.length === 0) return;
    for (const image of fresh) this.#images.add(image);
    this.#advanced();
    let finished = false;
    const shown = (async () => {
      await stylesheetsLoaded(this.#doc);
      this.#advanced();
      await Promise.all(
        fresh.map(async (image) => {
          const colour = await this.#colourOf(image);
          if (colour !== undefined) await this.#show(image, colour);
        }),
      );
    })()
      .catch(() => undefined)
      .finally(() => {
        finished = true;
      });
    await Promise.race([shown, this.#stalled(() => finished)]);
  }

  /** Records that a copy got further: its pixels read, made, or shown. */
  #advanced(): void {
    this.#progress = performance.now();
  }

  /**
   * Resolves once no copy has got any further for {@link printWait}, or once
   * `finished` says the copies it waits for are done.
   */
  async #stalled(finished: () => boolean): Promise<void> {
    for (;;) {
      if (finished() || this.#ended) return;
      const quiet = performance.now() - this.#progress;
      if (quiet >= printWait) return;
      await after(printWait - quiet);
    }
  }

  /** Shows every image's own file again, and lets the copies go. */
  end(): void {
    this.#ended = true;
    for (const image of this.#images) uncopy(image);
    this.#images.clear();
    for (const address of this.#addresses) URL.revokeObjectURL(address);
    this.#addresses.clear();
  }

  /** The colour `image`'s text prints in, read with every other waiting. */
  #colourOf(image: HTMLImageElement): Promise<string | undefined> {
    return new Promise((read) => {
      if (this.#waiting.push({ image, read }) > 1) return;
      void nextTask()
        .then(() => {
          const waiting = this.#waiting;
          this.#waiting = [];
          let colours = new Map<HTMLImageElement, string>();
          try {
            if (!this.#ended) {
              colours = printColours(
                this.#doc,
                waiting.map((one) => one.image),
              );
            }
          } finally {
            this.#advanced();
            for (const one of waiting) one.read(colours.get(one.image));
          }
        })
        // The waiting have their answers, so a failure has nothing to stop.
        .catch(() => undefined);
    });
  }

  async #show(image: HTMLImageElement, colour: string): Promise<void> {
    const source = image.src;
    const key = `${colour} ${source}`;
    let made = this.#copies.get(key);
    if (made === undefined) {
      made = this.#make(source, colour);
      this.#copies.set(key, made);
    }
    const copy = await made;
    this.#advanced();
    if (copy === undefined || this.#ended || image.src !== source) return;
    copied.set(image, { source, copy });
    // Its mask still paints it until the copy has loaded.
    image.src = copy;
    const ready = await loaded(image);
    this.#advanced();
    // Ended meanwhile, which shows its own file again, or given another.
    if (image.src !== copy) return;
    if (ready) image.addClass(printCopyClass);
    else uncopy(image);
  }

  /** A copy of the symbol at `source` in `colour`, or undefined if none. */
  async #make(source: string, colour: string): Promise<string | undefined> {
    try {
      const rgba = colourBytes(colour);
      if (rgba === undefined) return undefined;
      const pixels = await this.#pixelsOf(source);
      if (pixels === undefined) return undefined;
      if (this.#ended) return undefined;
      const png = storedPng(tinted(pixels, rgba));
      const address = URL.createObjectURL(
        new Blob([png], { type: "image/png" }),
      );
      this.#addresses.add(address);
      return address;
    } catch {
      return undefined;
    }
  }

  /** The pixels of the symbol at `source`, read once for every colour. */
  #pixelsOf(source: string): Promise<RgbaPixels | undefined> {
    let pixels = this.#pixels.get(source);
    if (pixels === undefined) {
      pixels = (async () => {
        const bytes = await this.#read(source);
        this.#advanced();
        if (bytes === undefined || oriented(bytes)) return undefined;
        const bitmap = await decodePng(bytes);
        this.#advanced();
        try {
          return readPixels(bitmap);
        } finally {
          bitmap.close();
        }
      })().catch(() => undefined);
      this.#pixels.set(source, pixels);
    }
    return pixels;
  }
}
