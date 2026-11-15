// Which `<code>` and `<pre>` tags the raw HTML of a note leaves open, as the
// browser reads it. A plain module, used by inline.ts and code.ts, so that
// unit tests can check it.
//
// Obsidian passes a note's HTML blocks and inline HTML to the browser as they
// are, among the HTML it makes of the rest, and the browser reads it all as
// one text. Found by rendering notes in Obsidian 1.13 and 1.15:
//
// - A `<code>` tag, in any form, `<code/>` included, makes what follows code,
//   over blank lines and blocks, until a closing tag closes it. `<pre>` makes
//   no code, but is counted the same way, for caution.
// - Only tags count, read as the HTML standard's tokenizer reads them. A
//   comment ends at `-->`, `--!>`, `<!-->`, or `<!--->`; a `<?`, a `<!` that
//   starts no comment, `<![CDATA[` among them, and a `</` without a letter
//   after it end at the next `>`; an attribute's value is quoted only after
//   `=`. Nothing in them is a tag. Nor is anything in a `<textarea>`,
//   `<title>`, `<style>`, `<xmp>`, `<iframe>`, `<noembed>`, or `<noframes>`
//   but its own closing tag.
// - A closing tag closes nothing while a `<table>`, a cell, a `<caption>`,
//   `<select>`, `<template>`, `<object>`, `<applet>`, or `<marquee>` that
//   raw HTML opened is open. A `</code>` closes nothing when eight or more
//   blocks lie between it and its `<code>`: there the browser's repair of
//   misnested tags gives up, and leaves a copy of the `<code>` open.
//
// Where it cannot be sure, everything after counts as code, to the note's
// end: after a comment, a tag, or a quote that raw HTML leaves open where
// Obsidian's own HTML follows, which can end it or not; after a `<script>`,
// whose text has rules of its own, a `<plaintext>`, which no tag ends, and an
// `<svg>` or `<math>`, in which `<![CDATA[` and those elements read
// otherwise; and after more than `maxOpen` `<code>` tags open at once.

/** Where the browser's reading of raw HTML stands. */
type Mode =
  | "text"
  // A tag, from its name to its `>`, as the HTML standard names the states.
  | "tagName"
  | "beforeAttribute"
  | "attribute"
  | "afterAttribute"
  | "beforeValue"
  | "doubleQuoted"
  | "singleQuoted"
  | "unquoted"
  | "afterValue"
  | "selfClosing"
  // A comment, from its `<!--` to its end.
  | "commentStart"
  | "commentStartDash"
  | "comment"
  | "commentLess"
  | "commentLessBang"
  | "commentLessBangDash"
  | "commentLessBangDashDash"
  | "commentEndDash"
  | "commentEnd"
  | "commentEndBang"
  // What ends at the next `>`: a `<?`, a declaration, CDATA, or `</` and no
  // letter.
  | "bogus"
  // The text of an element that no tag but its own closing tag ends.
  | "raw";

/** A `<code>` tag open: where it opened. */
interface Opening {
  /** The special elements opened before it, of `OpenTags.specials`. */
  readonly specials: number;
  /** The block it opened in, of `OpenTags.block`. */
  readonly block: number;
}

/** What raw HTML leaves open where a text ends, as the browser reads it. */
export interface OpenTags {
  /** The `<code>` tags open, the last opened last. */
  readonly code: readonly Opening[];
  /** The `<pre>` tags open. */
  readonly pre: number;
  /** Where the reading stands, in a tag, a comment, or an element's text. */
  readonly mode: Mode;
  /** The tag's name in a tag, or the element's in its text. */
  readonly name: string;
  /** Whether the tag in is a closing tag. */
  readonly closing: boolean;
  /**
   * The elements open inside which a closing tag closes nothing, by name,
   * opened since no tag was open.
   */
  readonly guards: Readonly<Record<string, number>>;
  /** How many special elements have opened since no tag was open. */
  readonly specials: number;
  /** The block being read, which a caller numbers. */
  readonly block: number;
  /** How many elements the block's containers may add. */
  readonly depth: number;
  /**
   * How many of `code` and `pre`, the first, closing tags cannot close:
   * those open before a text read on its own, such as strong text's.
   */
  readonly floor: { readonly code: number; readonly pre: number };
  /** Whether nothing after can be read with certainty. */
  readonly unsure: boolean;
}

/** Nothing open. */
export const noTags: OpenTags = {
  code: [],
  pre: 0,
  mode: "text",
  name: "",
  closing: false,
  guards: {},
  specials: 0,
  block: 0,
  depth: 0,
  floor: { code: 0, pre: 0 },
  unsure: false,
};

/**
 * Whether what follows `tags` counts as code: a tag open, the text of an
 * element that shows it as text, or anything not certain.
 */
export function isOpen(tags: OpenTags): boolean {
  return (
    tags.code.length > 0 || tags.pre > 0 || tags.mode !== "text" || tags.unsure
  );
}

/** Whether no tag at all is open, nor anything but text being read. */
function isClear(tags: OpenTags): boolean {
  return tags.code.length === 0 && tags.pre === 0 && tags.mode === "text";
}

/** At most this many `<code>` tags are counted open at once. */
const maxOpen = 64;
/**
 * How many blocks between a `<code>` and its closing tag make the browser
 * keep a copy of it open: its adoption agency stops after eight rounds.
 */
const adoptionLimit = 8;

/** Elements whose text no tag but their own closing tag ends. */
const rawText = new Set([
  "iframe",
  "noembed",
  "noframes",
  "style",
  "textarea",
  "title",
  "xmp",
]);
/** Elements after which nothing can be read with certainty. */
const uncertain = new Set(["math", "plaintext", "script", "svg"]);
/** Elements inside which the browser closes no `<code>` or `<pre>`. */
const guarding = new Set([
  "applet",
  "caption",
  "marquee",
  "object",
  "select",
  "table",
  "td",
  "template",
  "th",
]);
/**
 * The HTML standard's special elements that stay open, between which and a
 * `<code>` the browser's adoption agency counts its rounds.
 */
const special = new Set([
  "address",
  "applet",
  "article",
  "aside",
  "blockquote",
  "body",
  "button",
  "caption",
  "center",
  "colgroup",
  "dd",
  "details",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "html",
  "iframe",
  "li",
  "listing",
  "main",
  "marquee",
  "menu",
  "nav",
  "noembed",
  "noframes",
  "noscript",
  "object",
  "ol",
  "p",
  "plaintext",
  "pre",
  "script",
  "search",
  "section",
  "select",
  "style",
  "summary",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "ul",
  "xmp",
]);

/** White space between a tag's parts, as the browser counts it. */
const isSpace = (char: string) =>
  char === " " || char === "\t" || char === "\n" || char === "\f";
const isLetter = (char: string) =>
  (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");

/**
 * Whether reading `text`, inline HTML whose tags are whole, with `tags` open
 * could change what is open: only text that holds a `<` can, and with nothing
 * open, only one that opens a `<code>` or `<pre>`, a comment, or what else
 * changes how the rest reads.
 */
export function mayChange(text: string, tags: OpenTags): boolean {
  if (tags.unsure) return false;
  if (tags.mode !== "text" && tags.mode !== "raw") return true;
  if (!text.includes("<")) return false;
  return !isClear(tags) || opensSomething.test(text);
}
const opensSomething =
  /<(?:[!?]|code|pre|textarea|title|style|xmp|iframe|noembed|noframes|script|plaintext|svg|math)/i;

/**
 * What is open after `line`, a line of an HTML block, with `tags` open before
 * it. Unlike inline HTML, a line can leave a tag, a quote, or a comment open.
 */
export function readHtmlLine(line: string, tags: OpenTags): OpenTags {
  if (tags.unsure || (tags.mode === "text" && !line.includes("<"))) {
    return tags;
  }
  return readHtml(`${line}\n`, tags);
}

/** `tags` for block `block`, whose containers may add `depth` elements. */
export function inBlock(
  tags: OpenTags,
  block: number,
  depth: number,
): OpenTags {
  return { ...tags, block, depth };
}

/**
 * `tags` where Obsidian's own HTML follows raw HTML: a tag, a comment, or
 * anything but an element's text that raw HTML leaves open may end in it or
 * not, so nothing after is certain.
 */
export function settled(tags: OpenTags): OpenTags {
  return tags.mode === "text" || tags.mode === "raw" || tags.unsure
    ? tags
    : { ...tags, unsure: true };
}

/** `tags` where nothing after can be read with certainty. */
export function unsure(tags: OpenTags): OpenTags {
  return tags.unsure ? tags : { ...tags, unsure: true };
}

/**
 * What is open after `text`, raw HTML that the browser reads, with `tags`
 * open before it. Where `closes` is false, as where Obsidian may show the
 * text or not, closing tags close nothing.
 */
export function readHtml(
  text: string,
  tags: OpenTags,
  closes = true,
): OpenTags {
  if (tags.unsure) return tags;
  return new Reading(tags, closes).read(text);
}

/** A reading of raw HTML, from what is open before it. */
class Reading {
  #code: Opening[];
  #pre: number;
  #mode: Mode;
  #name: string;
  #closing: boolean;
  #guards: Record<string, number>;
  #specials: number;
  #unsure = false;
  readonly #tags: OpenTags;
  readonly #closes: boolean;

  constructor(tags: OpenTags, closes: boolean) {
    this.#tags = tags;
    this.#closes = closes;
    this.#code = [...tags.code];
    this.#pre = tags.pre;
    this.#mode = tags.mode;
    this.#name = tags.name;
    this.#closing = tags.closing;
    this.#guards = { ...tags.guards };
    this.#specials = tags.specials;
  }

  read(text: string): OpenTags {
    let index = 0;
    while (index < text.length && !this.#unsure) {
      index = this.#step(text, index);
    }
    const tags = this.#tags;
    return {
      ...tags,
      code: this.#code,
      pre: this.#pre,
      mode: this.#mode,
      name: this.#name,
      closing: this.#closing,
      guards: this.#guards,
      specials: this.#specials,
      unsure: this.#unsure,
    };
  }

  /** Reads `text` from `index` in the mode it is in; where it goes on. */
  #step(text: string, index: number): number {
    const char = text[index] ?? "";
    switch (this.#mode) {
      case "text":
        return this.#text(text, index);
      case "raw":
        return this.#raw(text, index);
      case "bogus": {
        const end = text.indexOf(">", index);
        if (end === -1) return text.length;
        this.#mode = "text";
        return end + 1;
      }
      case "tagName":
        if (isSpace(char)) this.#mode = "beforeAttribute";
        else if (char === "/") this.#mode = "selfClosing";
        else if (char === ">") this.#emit();
        else this.#name += char.toLowerCase();
        return index + 1;
      case "beforeAttribute":
        if (isSpace(char)) return index + 1;
        if (char === "/" || char === ">") {
          this.#mode = "afterAttribute";
          return index;
        }
        // `=` here starts an attribute's name.
        this.#mode = "attribute";
        return index + 1;
      case "attribute":
        if (isSpace(char) || char === "/" || char === ">") {
          this.#mode = "afterAttribute";
          return index;
        }
        if (char === "=") this.#mode = "beforeValue";
        return index + 1;
      case "afterAttribute":
        if (isSpace(char)) return index + 1;
        if (char === "/") this.#mode = "selfClosing";
        else if (char === "=") this.#mode = "beforeValue";
        else if (char === ">") this.#emit();
        else {
          this.#mode = "attribute";
          return index;
        }
        return index + 1;
      case "beforeValue":
        if (isSpace(char)) return index + 1;
        if (char === '"') this.#mode = "doubleQuoted";
        else if (char === "'") this.#mode = "singleQuoted";
        else if (char === ">") this.#emit();
        else {
          this.#mode = "unquoted";
          return index;
        }
        return index + 1;
      case "doubleQuoted":
      case "singleQuoted": {
        const quote = this.#mode === "doubleQuoted" ? '"' : "'";
        const end = text.indexOf(quote, index);
        if (end === -1) return text.length;
        this.#mode = "afterValue";
        return end + 1;
      }
      case "unquoted":
        if (isSpace(char)) this.#mode = "beforeAttribute";
        else if (char === ">") this.#emit();
        return index + 1;
      case "afterValue":
        if (isSpace(char)) this.#mode = "beforeAttribute";
        else if (char === "/") this.#mode = "selfClosing";
        else if (char === ">") this.#emit();
        else {
          this.#mode = "beforeAttribute";
          return index;
        }
        return index + 1;
      case "selfClosing":
        // A self-closing slash changes nothing an element opens.
        if (char === ">") {
          this.#emit();
          return index + 1;
        }
        this.#mode = "beforeAttribute";
        return index;
      default:
        return this.#comment(char, index);
    }
  }

  /** Reads text from `index`, to the next `<` and what it starts. */
  #text(text: string, index: number): number {
    const at = text.indexOf("<", index);
    if (at === -1) return text.length;
    const next = text[at + 1] ?? "";
    if (isLetter(next)) {
      this.#tag(next, false);
      return at + 2;
    }
    if (next === "/") {
      const after = text[at + 2] ?? "";
      if (isLetter(after)) {
        this.#tag(after, true);
        return at + 3;
      }
      // `</>` is nothing; `</` and anything else ends at the next `>`.
      if (after === ">") return at + 3;
      this.#mode = "bogus";
      return at + 2;
    }
    if (next === "!") {
      if (text.startsWith("--", at + 2)) {
        this.#mode = "commentStart";
        return at + 4;
      }
      this.#mode = "bogus";
      return at + 2;
    }
    if (next === "?") {
      this.#mode = "bogus";
      return at + 2;
    }
    return at + 1;
  }

  /** Starts a tag whose name starts with `first`. */
  #tag(first: string, closing: boolean): void {
    this.#mode = "tagName";
    this.#name = first.toLowerCase();
    this.#closing = closing;
  }

  /** Reads an element's text from `index`, to its own closing tag. */
  #raw(text: string, index: number): number {
    const name = this.#name;
    let at = index;
    for (;;) {
      at = text.indexOf("</", at);
      if (at === -1) return text.length;
      const end = at + 2 + name.length;
      if (
        text.slice(at + 2, end).toLowerCase() === name &&
        end < text.length &&
        (isSpace(text[end] ?? "") || text[end] === "/" || text[end] === ">")
      ) {
        this.#mode = "tagName";
        this.#closing = true;
        return end;
      }
      at += 2;
    }
  }

  /** Reads `char` of a comment. */
  #comment(char: string, index: number): number {
    switch (this.#mode) {
      case "commentStart":
        if (char === "-") this.#mode = "commentStartDash";
        else if (char === ">") this.#mode = "text";
        else {
          this.#mode = "comment";
          return index;
        }
        return index + 1;
      case "commentStartDash":
        if (char === "-") this.#mode = "commentEnd";
        else if (char === ">") this.#mode = "text";
        else {
          this.#mode = "comment";
          return index;
        }
        return index + 1;
      case "comment":
        if (char === "<") this.#mode = "commentLess";
        else if (char === "-") this.#mode = "commentEndDash";
        return index + 1;
      case "commentLess":
        if (char === "!") this.#mode = "commentLessBang";
        else if (char !== "<") {
          this.#mode = "comment";
          return index;
        }
        return index + 1;
      case "commentLessBang":
        if (char === "-") {
          this.#mode = "commentLessBangDash";
          return index + 1;
        }
        this.#mode = "comment";
        return index;
      case "commentLessBangDash":
        if (char === "-") {
          this.#mode = "commentLessBangDashDash";
          return index + 1;
        }
        this.#mode = "commentEndDash";
        return index;
      case "commentLessBangDashDash":
        // A `<!--` in a comment: what follows is read as after `--`.
        this.#mode = "commentEnd";
        return index;
      case "commentEndDash":
        if (char === "-") {
          this.#mode = "commentEnd";
          return index + 1;
        }
        this.#mode = "comment";
        return index;
      case "commentEnd":
        if (char === ">") this.#mode = "text";
        else if (char === "!") this.#mode = "commentEndBang";
        else if (char !== "-") {
          this.#mode = "comment";
          return index;
        }
        return index + 1;
      default:
        // After `--!`.
        if (char === "-") this.#mode = "commentEndDash";
        else if (char === ">") this.#mode = "text";
        else {
          this.#mode = "comment";
          return index;
        }
        return index + 1;
    }
  }

  /** What the tag that ends here does. */
  #emit(): void {
    const name = this.#name;
    this.#mode = "text";
    if (this.#closing) {
      this.#close(name);
      return;
    }
    if ((name === "code" || name === "pre") && this.#clear) {
      // Elements opened before the first tag open are below it.
      this.#guards = {};
      this.#specials = 0;
    }
    if (name === "code") {
      if (this.#code.length >= maxOpen) this.#unsure = true;
      this.#code.push({ specials: this.#specials, block: this.#tags.block });
    } else if (name === "pre") this.#pre++;
    if (special.has(name)) this.#specials++;
    if (guarding.has(name)) this.#guards[name] = (this.#guards[name] ?? 0) + 1;
    if (rawText.has(name)) this.#mode = "raw";
    else if (uncertain.has(name)) this.#unsure = true;
  }

  /** What closing tag `name` does. */
  #close(name: string): void {
    if (!this.#closes) return;
    const guarded = Object.values(this.#guards).some((count) => count > 0);
    if (guarding.has(name) && (this.#guards[name] ?? 0) > 0) {
      this.#guards[name] = (this.#guards[name] ?? 0) - 1;
    }
    if (guarded) return;
    const { floor } = this.#tags;
    if (name === "pre" && this.#pre > floor.pre) this.#pre--;
    else if (name === "code" && this.#code.length > floor.code) {
      const last = this.#code.at(-1);
      if (last === undefined) return;
      const between =
        this.#specials -
        last.specials +
        (last.block === this.#tags.block ? 0 : this.#tags.depth + 1);
      if (between < adoptionLimit) this.#code.pop();
    }
  }

  /** Whether no tag is open in the reading. */
  get #clear(): boolean {
    return this.#code.length === 0 && this.#pre === 0;
  }
}
