// PROTOTYPE for #167, section 3, not for release: words of several symbols.
// A word is a run of symbols in a note with nothing between them that a word
// list (a lexicon) knows. Inkline shows the word's translation under the whole
// run, and a reading over it that the lexicon gives in place of the symbols'
// own. Runs the lexicon does not know stay single symbols, as before.

/** What a lexicon says about a word: its reading, its meaning, or both. */
export interface WordEntry {
  readonly reading?: string;
  readonly meaning?: string;
}

/** A word list: entries by {@link wordKey} of their symbols' file paths. */
export interface Lexicon {
  readonly entries: ReadonlyMap<string, WordEntry>;
  /** The most symbols any entry has. */
  readonly longest: number;
}

export const emptyLexicon: Lexicon = { entries: new Map(), longest: 0 };

/** The key of a sequence of symbols, by their files' paths. */
export function wordKey(paths: readonly string[]): string {
  return paths.join("\u0000");
}

/** A piece of a run: symbols `start` to `end`, exclusive, and its entry. */
export interface Piece {
  readonly start: number;
  readonly end: number;
  readonly entry?: WordEntry;
}

/**
 * Splits a run of symbols into the words the lexicon knows, taking the
 * longest known word at each place from the start, as dictionary-based
 * segmenters for scripts without spaces do. A symbol that starts no known
 * word is a piece of its own, without an entry. A greedy match can split
 * wrongly where two splits are both words: see the report.
 */
export function segment(
  paths: readonly string[],
  lexicon: Lexicon,
): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  while (at < paths.length) {
    let found: Piece | undefined;
    for (
      let length = Math.min(lexicon.longest, paths.length - at);
      length >= 1;
      length--
    ) {
      const entry = lexicon.entries.get(
        wordKey(paths.slice(at, at + length)),
      );
      if (entry !== undefined) {
        found = { start: at, end: at + length, entry };
        break;
      }
    }
    found ??= { start: at, end: at + 1 };
    pieces.push(found);
    at = found.end;
  }
  return pieces;
}

/**
 * A word's reading made from its symbols' main readings, for comparison
 * with what a lexicon says: `?` stands for a symbol without one.
 */
export function composedReading(
  readings: readonly (readonly string[])[],
  separator: string,
): string {
  return readings.map((list) => list[0] ?? "?").join(separator);
}

/** The class of the element around a word's symbols. */
export const wordClass = "inkline-word";
/** Where a word's reading and meaning go, for styles.css to show. */
export const overAttribute = "data-inkline-over";
export const underAttribute = "data-inkline-under";

/** The attributes a word's element gets for `entry`. */
export function wordAttributes(entry: WordEntry): Record<string, string> {
  return {
    ...(entry.reading === undefined ? {} : { [overAttribute]: entry.reading }),
    ...(entry.meaning === undefined ? {} : { [underAttribute]: entry.meaning }),
  };
}

/** What the DOM grouping needs from Inkline. */
export interface WordSource {
  /** The vault path of the symbol file an image shows, if one. */
  fileOf(src: string): string | undefined;
  /** The lexicon now. */
  lexicon(): Lexicon;
}

/** The element that stands in a line for a tagged symbol image. */
function unitOf(node: Node): HTMLImageElement | undefined {
  if (!node.instanceOf(HTMLElement)) return undefined;
  if (node.instanceOf(HTMLImageElement)) {
    return node.hasClass("inkline-symbol") ? node : undefined;
  }
  if (node.hasClass("internal-embed") && node.hasClass("image-embed")) {
    const image = node.querySelector("img.inkline-symbol");
    return image?.instanceOf(HTMLImageElement) === true ? image : undefined;
  }
  return undefined;
}

/** Whether `node` lies between two symbols without parting them. */
function invisible(node: Node): boolean {
  if (node.nodeType === Node.COMMENT_NODE) return true;
  return node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? "") === "";
}

/** The element whose children hold `unit`, past any word element. */
function holderOf(unit: Element): Element | null {
  const parent = unit.parentElement;
  if (parent?.hasClass(wordClass) === true) return parent.parentElement;
  return parent;
}

/** The units of `holder`, with words opened, in order. */
function flatten(holder: Element): Node[] {
  const nodes: Node[] = [];
  for (const child of Array.from(holder.childNodes)) {
    if (child.instanceOf(HTMLElement) && child.hasClass(wordClass)) {
      nodes.push(...Array.from(child.childNodes));
    } else {
      nodes.push(child);
    }
  }
  return nodes;
}

/** Groups the words in `holder`'s children, if they changed. */
function groupHolder(holder: Element, source: WordSource): void {
  // Live Preview's own lines are CodeMirror's: its marks group them there.
  if (holder.closest(".cm-line, .cm-html-embed") !== null) return;
  for (let at = holder.closest("ruby"); at !== null; ) {
    if (!at.hasClass("inkline-ruby")) return;
    at = at.parentElement?.closest("ruby") ?? null;
  }
  const nodes = flatten(holder);
  const runs: { unit: Element; path: string }[][] = [];
  let run: { unit: Element; path: string }[] = [];
  for (const node of nodes) {
    const image = unitOf(node);
    const path =
      image === undefined
        ? undefined
        : source.fileOf(image.src || image.currentSrc);
    if (image !== undefined && path !== undefined && node.instanceOf(Element)) {
      run.push({ unit: node, path });
      continue;
    }
    if (invisible(node)) continue;
    if (run.length > 0) runs.push(run);
    run = [];
  }
  if (run.length > 0) runs.push(run);
  const lexicon = source.lexicon();
  const wanted: { units: Element[]; attributes: Record<string, string> }[] =
    [];
  for (const each of runs) {
    for (const piece of segment(
      each.map((unit) => unit.path),
      lexicon,
    )) {
      if (piece.entry === undefined) continue;
      wanted.push({
        units: each.slice(piece.start, piece.end).map((unit) => unit.unit),
        attributes: wordAttributes(piece.entry),
      });
    }
  }
  const describe = (units: Element[], attributes: Record<string, string>) =>
    `${String(units.length)}:${nodes.indexOf(units[0] ?? holder)}:${JSON.stringify(attributes)}`;
  const want = wanted
    .map((word) => describe(word.units, word.attributes))
    .join("|");
  const have = Array.from(holder.children)
    .filter((child) => child.hasClass(wordClass))
    .map((word) => {
      const units = Array.from(word.children);
      const attributes: Record<string, string> = {};
      for (const name of [overAttribute, underAttribute]) {
        const value = word.getAttribute(name);
        if (value !== null) attributes[name] = value;
      }
      return describe(units, attributes);
    })
    .join("|");
  if (want === have) return;
  for (const word of Array.from(holder.children)) {
    if (word.hasClass(wordClass)) word.replaceWith(...Array.from(word.childNodes));
  }
  for (const word of wanted) {
    const first = word.units[0];
    if (first === undefined) continue;
    const element = holder.ownerDocument.createElement("span");
    element.addClass(wordClass);
    for (const [name, value] of Object.entries(word.attributes)) {
      element.setAttribute(name, value);
    }
    first.before(element);
    // Whatever invisible lies between them goes along.
    const last = word.units.at(-1) ?? first;
    let node: Node | null = first;
    while (node !== null) {
      const next: Node | null = node === last ? null : node.nextSibling;
      element.append(node);
      node = next;
    }
  }
}

/** Groups the words around the symbol images in or at `root`. */
export function groupWords(root: Node, source: WordSource): void {
  const images: HTMLImageElement[] = [];
  if (root.instanceOf(HTMLImageElement)) images.push(root);
  else if (root.instanceOf(Element)) {
    images.push(
      ...Array.from(root.getElementsByTagName("img")).filter((image) =>
        image.hasClass("inkline-symbol"),
      ),
    );
    // A paragraph whose last word was removed.
    if (root.querySelector(`.${wordClass}`) !== null) {
      for (const word of Array.from(root.querySelectorAll(`.${wordClass}`))) {
        const holder = word.parentElement;
        if (holder !== null) groupHolder(holder, source);
      }
    }
  }
  const holders = new Set<Element>();
  for (const image of images) {
    if (!image.hasClass("inkline-symbol")) continue;
    const embed = image.closest(".internal-embed.image-embed");
    const unit = embed !== null && embed.contains(image) ? embed : image;
    const holder = holderOf(unit);
    if (holder !== null) holders.add(holder);
  }
  for (const holder of holders) groupHolder(holder, source);
}

/** Takes away every word element in or under `root`. */
export function ungroupWords(root: ParentNode): void {
  for (const word of Array.from(root.querySelectorAll(`.${wordClass}`))) {
    if (word.closest(".cm-line") !== null) {
      // CodeMirror's own marks; it removes them itself.
      continue;
    }
    word.replaceWith(...Array.from(word.childNodes));
  }
}
