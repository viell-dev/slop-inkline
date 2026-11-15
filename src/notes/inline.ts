// Where a paragraph's text is inline code, as Obsidian reads it. A plain
// module, used by code.ts, so that unit tests can check it.
//
// Obsidian reads a paragraph's text from its start, one construct at a time,
// and the first construct that starts takes the text it covers: a backtick in
// it opens no code span. Found by rendering notes in Obsidian 1.13 and 1.15,
// these take backticks so, at the places where Obsidian looks for them:
//
// - an escape, `\` and a punctuation mark;
// - an autolink, `<scheme://…>` or `<name@host>`, and a bare `www.` or
//   `http://` address, which runs to white space, or an email address;
// - inline HTML: a tag, a comment, or a declaration;
// - a wiki link or embed, `[[…]]` on one line;
// - a link or image, `[text](address "title")`, a footnote, `^[…]` or
//   `[^label]`, and text in square brackets, `[text]`, `[text][label]`, or
//   `[text][]`, with or without a definition for it;
// - strong text, emphasis, strikethrough, and highlights;
// - inline math, `$…$` and `$$…$$`, and a comment, `%%…%%` on one line;
// - a tag, `#name`.
//
// Strong text, emphasis, strikethrough, highlights, a link's text, text in
// brackets, and a footnote are read again on their own, so a code span in one
// ends with it. Each finds its end without regard to code spans: in
// `` **`a** b` ``, the strong text is `` `a ``.
//
// A code span is a run of backticks and the next run as long. A run that none
// closes leaves its first backtick as text, and the rest of the run can still
// open a span. A `<code>` tag makes what follows it code, to its `</code>`,
// and one that strong text or a link leaves open stays open after it, as the
// browser keeps it.
//
// Some constructs look for their end to the text's end, as Obsidian does, so
// that a text of thousands of brackets that nothing closes takes a time that
// grows with its length squared. Reading counts its steps; a text that would
// take more than a number for its length cannot be read with certainty in
// time, and every place in it counts as code.

/** Where `at` lies: in code, outside it, or not known until more text comes. */
type Found = boolean | undefined;

/**
 * What starts at a place: where it ends, and where code is in it, or the text
 * that is read again on its own.
 */
interface Construct {
  readonly end: number;
  /** A code span: the place of its first backtick and of its closing run. */
  readonly code?: readonly [number, number];
  /** Text read again on its own, from, to, and whether it is a link's. */
  readonly inner?: readonly [number, number, boolean];
}

/** A construct that may end in text not read yet. */
const open = Symbol("open");

/** No construct starts here. */
type Missing = undefined;

type Attempt = Construct | typeof open | Missing;

/** Whether `char` is white space as Obsidian counts it: Unicode's, mostly. */
function isSpace(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 9 && code <= 13) ||
    code === 32 ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288 ||
    code === 65279
  );
}

const isDigit = (char: string) => char >= "0" && char <= "9";
const isLetter = (char: string) =>
  (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
/** A character of a word, for `_`: a letter, a digit, or `_`. */
const isWord = (char: string) =>
  isLetter(char) || isDigit(char) || char === "_";
/** A character of the part of an email address before its `@`. */
const isLocal = (char: string) =>
  isLetter(char) || isDigit(char) || "+-._".includes(char);

/** What `\` escapes. */
const escapable = "\\`*{}[]()#+-.!_>~|\n\"$%&',/:;<=?@^";

// HTML tags, as CommonMark defines them.
const attribute =
  "(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^\"'=<>`\\u0000-\\u0020]+|'[^']*'|\"[^\"]*\"))?)";
/** An opening tag, as a pattern's source. */
export const openTag = `<[A-Za-z][A-Za-z0-9-]*${attribute}*\\s*\\/?>`;
/** A closing tag, as a pattern's source. */
export const closeTag = "<\\/[A-Za-z][A-Za-z0-9-]*\\s*>";
/** A tag's name, which a backtick ends. */
const tagName =
  /#[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+/y;
/**
 * Whether `char` ends an attribute's value without quotes: a space or a
 * character before it, a quote, `=`, `<`, `>`, or a backtick.
 */
const endsUnquoted = (char: string) =>
  char === "" || char <= " " || "\"'=<>`".includes(char);
/** A comment on one line. */
const comment = /%%.*?%%/y;
// What the text is searched for ahead of where it is read.
const lineBreaks = /\n/g;
const lineEnds = /[\n\r\u2028\u2029]/g;
const ats = /@/g;
const closers = /\]\]/g;
const codeTagStarts = /<code/gi;

/**
 * Where text that Obsidian reads stops, by character: 1 where a construct may
 * start, 2 where one may depending on the characters around, as `~~` does.
 */
const stops = new Uint8Array(128);
for (const char of "\\<[*_`$") stops[char.charCodeAt(0)] = 1;
for (const char of "wh!^~=#%") stops[char.charCodeAt(0)] = 2;

/** Steps of reading a paragraph's text allowed for each of its characters. */
const stepsPerChar = 64;
/** Steps allowed for any paragraph, however short. */
const minimumSteps = 100_000;

/** Reading took more steps than a paragraph's length allows. */
class TooLong extends Error {}

/**
 * Reads a paragraph's text as Obsidian does, to find whether one place of it
 * is in code.
 */
class Inline {
  readonly #text: string;
  readonly #at: number;
  /** Whether the text may go on, as a paragraph read only so far does. */
  readonly #partial: boolean;
  #steps: number;
  /** Where each run of backticks starts, by its length, once needed. */
  #runs: Map<number, number[]> | undefined;
  /** Where the run of backticks last counted starts and ends. */
  #runStart = -1;
  #runEnd = -1;
  /**
   * For each pattern searched for, where the last search started and what it
   * found, so that searches from later places read no text again.
   */
  readonly #searches = new Map<RegExp, { from: number; found: number }>();

  constructor(text: string, at: number, partial: boolean) {
    // Text that may go on goes on after a line break.
    this.#text = partial ? `${text}\n` : text;
    this.#at = at;
    this.#partial = partial;
    this.#steps = minimumSteps + stepsPerChar * this.#text.length;
  }

  /** Whether `at` is in code. */
  find(): Found {
    return this.#read(0, this.#text.length, false);
  }

  #step(count = 1): void {
    this.#steps -= count;
    if (this.#steps < 0) throw new TooLong();
  }

  /** The character at `index`, or "" past `to`, where the text read ends. */
  #char(index: number, to: number): string {
    return index < to && index >= 0 ? (this.#text[index] ?? "") : "";
  }

  /**
   * What a construct that reached `to` without its end is: one that may end in
   * text not read yet, if `to` is where that text would go on.
   */
  #unended(to: number): typeof open | Missing {
    return this.#partial && to === this.#text.length ? open : undefined;
  }

  /** Reads the text from `from` to `to` for `at`, as Obsidian reads a text. */
  #read(from: number, to: number, link: boolean): Found {
    let place = from;
    let inLink = link;
    // How many `<code>` tags are open, which make what follows them code.
    let codeTags = 0;
    while (place < to && place <= this.#at) {
      this.#step();
      const found = this.#construct(place, to, inLink);
      if (found === open) return undefined;
      if (found === undefined) {
        place = this.#locate(place + 1, from, to);
        continue;
      }
      if (this.#at < found.end) {
        if (codeTags > 0) return true;
        if (found.code !== undefined) {
          const [start, close] = found.code;
          return this.#at > start && this.#at <= close;
        }
        if (found.inner !== undefined) {
          const [innerFrom, innerTo, innerLink] = found.inner;
          if (this.#at >= innerFrom && this.#at < innerTo) {
            return this.#read(innerFrom, innerTo, innerLink);
          }
        }
        return false;
      }
      [inLink, codeTags] = this.#tags(place, found, inLink, codeTags);
      place = found.end;
    }
    return codeTags > 0;
  }

  /**
   * What the construct `found` at `place` does to the tags open: an HTML
   * link's tags make what lies between them a link's text, and a `<code>`
   * tag makes what follows it code, to its `</code>`. One that a construct's
   * text leaves open stays open after it, as the browser keeps it.
   */
  #tags(
    place: number,
    found: Construct,
    inLink: boolean,
    codeTags: number,
  ): [boolean, number] {
    let link = inLink;
    let code = codeTags;
    if (found.inner !== undefined) {
      const [innerFrom, innerTo, innerLink] = found.inner;
      const mention = this.#search(codeTagStarts, innerFrom);
      if (mention !== -1 && mention < innerTo) {
        code += this.#openCodeTags(innerFrom, innerTo, innerLink);
      }
    }
    if (this.#text[place] === "<") {
      const tag = this.#text.slice(place, found.end);
      if (!link && /^<a /i.test(tag)) link = true;
      else if (link && /^<\/a>/i.test(tag)) link = false;
      if (/^<code(?=[\s>])/i.test(tag) && !tag.endsWith("/>")) code++;
      else if (/^<\/code\s*>/i.test(tag) && code > 0) code--;
    }
    return [link, code];
  }

  /** How many `<code>` tags the text from `from` to `to` leaves open. */
  #openCodeTags(from: number, to: number, link: boolean): number {
    let place = from;
    let inLink = link;
    let codeTags = 0;
    while (place < to) {
      this.#step();
      const found = this.#construct(place, to, inLink);
      if (found === undefined || found === open) {
        place = this.#locate(place + 1, from, to);
        continue;
      }
      [inLink, codeTags] = this.#tags(place, found, inLink, codeTags);
      place = found.end;
    }
    return codeTags;
  }

  /**
   * Where text read from `place` stops: the next place where a construct may
   * start, a line break's spaces, or an email address.
   */
  #locate(place: number, from: number, to: number): number {
    const text = this.#text;
    let stop = to;
    // A line break's spaces, which a hard break may start.
    const lineBreak = this.#search(lineBreaks, place);
    if (lineBreak !== -1 && lineBreak < stop) {
      stop = lineBreak;
      while (stop > place && text[stop - 1] === " ") stop--;
    }
    // An email address, which starts before its `@`.
    let mail = this.#search(ats, place);
    let start = place;
    while (mail !== -1 && mail < stop) {
      if (mail !== start && isLocal(text[mail - 1] ?? "")) {
        let first = mail;
        while (first > start && isLocal(text[first - 1] ?? "")) first--;
        stop = first;
        break;
      }
      start = mail + 1;
      mail = this.#search(ats, start);
    }
    for (let index = place; index < stop; index++) {
      const code = text.charCodeAt(index);
      const kind = code < 128 ? stops[code] : 0;
      if (kind === 0) continue;
      if (kind === 1 || this.#stopsAt(index, from)) {
        this.#step(index - place + 1);
        return index;
      }
    }
    this.#step(stop - place + 1);
    return stop;
  }

  /** Whether text stops at `index`, where a character starts a construct only after or before another. */
  #stopsAt(index: number, from: number): boolean {
    const text = this.#text;
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    const before = index > from ? (text[index - 1] ?? "") : "";
    switch (char) {
      case "w":
        return text.startsWith("www.", index);
      case "h":
        return (
          text.startsWith("http://", index) ||
          text.startsWith("https://", index)
        );
      case "!":
        return next === "[";
      case "^":
        return next === "[" || isSpace(before);
      case "#":
        return isSpace(before);
      default:
        return next === char;
    }
  }

  /** Where `pattern`, a global one, next matches at or after `place`, or -1. */
  #search(pattern: RegExp, place: number): number {
    const last = this.#searches.get(pattern);
    if (
      last !== undefined &&
      place >= last.from &&
      (last.found === -1 || place <= last.found)
    ) {
      return last.found;
    }
    pattern.lastIndex = place;
    const found = pattern.exec(this.#text)?.index ?? -1;
    this.#step((found === -1 ? this.#text.length : found) - place + 1);
    if (last === undefined) this.#searches.set(pattern, { from: place, found });
    else {
      last.from = place;
      last.found = found;
    }
    return found;
  }

  /** The construct that starts at `place`, as Obsidian tries them in turn. */
  #construct(place: number, to: number, inLink: boolean): Attempt {
    const char = this.#text[place] ?? "";
    switch (char) {
      case "\\":
        return this.#escape(place, to);
      case "<":
        return (
          (inLink ? undefined : this.#autolink(place, to)) ??
          this.#html(place, to)
        );
      case "!":
        return (
          this.#wikiLink(place, to) ??
          this.#link(place, to, inLink) ??
          this.#reference(place, to, inLink)
        );
      case "[":
        return (
          this.#wikiLink(place, to) ??
          this.#link(place, to, inLink) ??
          this.#footnoteReference(place, to) ??
          this.#reference(place, to, inLink)
        );
      case "^":
        return this.#footnote(place, to);
      case "*":
        return this.#strong(place, to) ?? this.#emphasis(place, to);
      case "_":
        return (
          this.#address(place, to, inLink) ??
          this.#strong(place, to) ??
          this.#emphasis(place, to)
        );
      case "~":
      case "=":
        return this.#pair(place, to);
      case "`":
        return this.#codeSpan(place, to);
      case "#":
        return this.#tag(place, to);
      case "$":
        return this.#math(place, to);
      case "%":
        return this.#comment(place, to);
      default:
        return this.#address(place, to, inLink);
    }
  }

  /** An address, or an email address, which start with a letter or digit. */
  #address(place: number, to: number, inLink: boolean): Attempt {
    if (inLink) return undefined;
    const char = this.#text[place] ?? "";
    if (char === "w" || char === "h" || char === "H") {
      const found = this.#url(place, to);
      if (found !== undefined) return found;
    }
    return isLocal(char) ? this.#email(place, to) : undefined;
  }

  #escape(place: number, to: number): Attempt {
    const next = this.#char(place + 1, to);
    return next !== "" && escapable.includes(next)
      ? { end: place + 2 }
      : undefined;
  }

  /** `<scheme://…>` or `<name@host>`. */
  #autolink(place: number, to: number): Attempt {
    const text = this.#text;
    let index = place + 1;
    while (index < to) {
      this.#step();
      const char = text[index] ?? "";
      if (isSpace(char) || char === ">" || char === "@") break;
      if (char === ":" && text[index + 1] === "/") break;
      index++;
    }
    if (index === place + 1 || index >= to) return this.#unendedOr(index, to);
    // An address's scheme ends in `://`, an email's name in `@`.
    if (text[index] === ":") {
      if (this.#char(index + 2, to) !== "/") return undefined;
      index += 2;
    } else if (text[index] !== "@") return undefined;
    index++;
    while (index < to) {
      this.#step();
      const char = text[index] ?? "";
      if (isSpace(char) || char === ">") break;
      index++;
    }
    if (index >= to) return this.#unended(to);
    return text[index] === ">" ? { end: index + 1 } : undefined;
  }

  #unendedOr(index: number, to: number): typeof open | Missing {
    return index >= to ? this.#unended(to) : undefined;
  }

  /** A bare `www.`, `http://`, or `https://` address. */
  #url(place: number, to: number): Attempt {
    const text = this.#text;
    let index: number;
    if (text.startsWith("www.", place)) index = place + 4;
    else if (text.slice(place, place + 7).toLowerCase() === "http://") {
      index = place + 7;
    } else if (text.slice(place, place + 8).toLowerCase() === "https://") {
      index = place + 8;
    } else return undefined;
    // The host: letters, digits, `-`, `_`, and dots, two of them never side
    // by side.
    const start = index;
    let lastDot = index - 1;
    const dots: number[] = [];
    let char = "";
    while (index < to) {
      this.#step();
      char = text[index] ?? "";
      if (char === ".") {
        if (lastDot === index - 1) break;
        dots.push(index);
        lastDot = index;
        index++;
        continue;
      }
      if (isLetter(char) || isDigit(char) || char === "-" || char === "_") {
        index++;
        continue;
      }
      break;
    }
    if (char === ".") {
      dots.pop();
      index--;
    }
    const lastDots = dots.at(-2);
    if (dots.length === 0) return undefined;
    const domain = text.slice(
      lastDots === undefined ? start : lastDots + 1,
      index,
    );
    if (domain.includes("_")) return undefined;
    // The path, to white space or `<`, without the punctuation that ends it.
    const path = index;
    let end = index;
    while (index < to) {
      this.#step();
      char = text[index] ?? "";
      if (isSpace(char) || char === "<") break;
      index++;
      if (!"!*,.:?_~".includes(char)) end = index;
    }
    if (text[end - 1] === ")") {
      let part = text.slice(path, end);
      const opening = part.split("(").length - 1;
      let closing = part.split(")").length - 1;
      while (closing > opening) {
        end = path + part.lastIndexOf(")");
        part = text.slice(path, end);
        closing--;
      }
    }
    if (text[end - 1] === ";") {
      end--;
      if (isLetter(text[end - 1] ?? "")) {
        let before = end - 2;
        while (isLetter(text[before] ?? "")) before--;
        if (text[before] === "&") end = before;
      }
    }
    return { end };
  }

  /** An email address: no backtick is in one, but `_` may be. */
  #email(place: number, to: number): Attempt {
    const text = this.#text;
    const mail = this.#search(ats, place);
    if (mail === -1 || mail >= to) return undefined;
    let index = place;
    while (isLocal(this.#char(index, to))) {
      this.#step();
      index++;
    }
    if (index === place || text[index] !== "@") return undefined;
    index++;
    let dot = -1;
    let char = "";
    while (index < to) {
      this.#step();
      char = text[index] ?? "";
      if (isLetter(char) || isDigit(char) || "-._".includes(char)) {
        index++;
        if (dot === -1 && char === ".") dot = index;
        continue;
      }
      break;
    }
    if (dot === -1 || dot === index || char === "-" || char === "_") {
      return undefined;
    }
    return { end: char === "." ? index - 1 : index };
  }

  /**
   * Inline HTML, as CommonMark defines it: an opening or closing tag, a
   * comment, a processing instruction, a declaration, or CDATA. Read in one
   * pass, however long, and counted in steps as it goes.
   */
  #html(place: number, to: number): Attempt {
    const text = this.#text;
    const next = this.#char(place + 1, to);
    let end: number | typeof open | undefined;
    if (isLetter(next)) end = this.#openingTag(place + 1, to);
    else if (next === "/") end = this.#closingTag(place + 2, to);
    else if (next === "?") {
      // To the next `?>` on the line.
      const close = text.indexOf("?>", place + 2);
      this.#step((close === -1 ? to : close) - place);
      const lineEnd = this.#search(lineEnds, place);
      end =
        close !== -1 && close + 2 <= to && (lineEnd === -1 || close < lineEnd)
          ? close + 2
          : lineEnd === -1 || lineEnd >= to
            ? this.#unended(to)
            : undefined;
    } else if (next === "!") end = this.#declaration(place, to);
    if (end === undefined || end === open) return end;
    this.#step(end - place);
    return { end };
  }

  /** Where an opening tag whose name starts at `from` ends. */
  #openingTag(from: number, to: number): number | typeof open | undefined {
    const text = this.#text;
    let index = from;
    while (index < to && /[A-Za-z0-9-]/.test(text[index] ?? "")) index++;
    this.#step(index - from);
    for (;;) {
      const spaced = index;
      while (index < to && /\s/.test(text[index] ?? "")) index++;
      this.#step(index - spaced + 1);
      if (index >= to) return this.#unended(to);
      if (text[index] === ">") return index + 1;
      if (text[index] === "/") {
        if (index + 1 >= to) return this.#unended(to);
        return text[index + 1] === ">" ? index + 2 : undefined;
      }
      // An attribute, after white space: its name, and a value.
      if (index === spaced || !/[a-zA-Z_:]/.test(text[index] ?? "")) {
        return undefined;
      }
      const name = index;
      while (index < to && /[a-zA-Z0-9:._-]/.test(text[index] ?? "")) index++;
      this.#step(index - name);
      let value = index;
      while (value < to && /\s/.test(text[value] ?? "")) value++;
      if (value >= to) return this.#unended(to);
      if (text[value] !== "=") continue;
      value++;
      while (value < to && /\s/.test(text[value] ?? "")) value++;
      if (value >= to) return this.#unended(to);
      const quote = text[value] ?? "";
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, value + 1);
        this.#step((close === -1 ? to : close) - value);
        if (close === -1 || close >= to) return this.#unended(to);
        index = close + 1;
      } else {
        index = value;
        while (index < to && !endsUnquoted(text[index] ?? "")) index++;
        this.#step(index - value);
        if (index === value) return undefined;
      }
    }
  }

  /** Where a closing tag whose name starts at `from` ends. */
  #closingTag(from: number, to: number): number | typeof open | undefined {
    const text = this.#text;
    if (!isLetter(this.#char(from, to))) return undefined;
    let index = from;
    while (index < to && /[A-Za-z0-9-]/.test(text[index] ?? "")) index++;
    while (index < to && /\s/.test(text[index] ?? "")) index++;
    this.#step(index - from);
    if (index >= to) return this.#unended(to);
    return text[index] === ">" ? index + 1 : undefined;
  }

  /** Where a comment, a declaration, or CDATA that starts `<!` ends. */
  #declaration(place: number, to: number): number | typeof open | undefined {
    const text = this.#text;
    const unended = (close: number) =>
      close === -1 || close >= to ? this.#unended(to) : close;
    if (text.startsWith("<!--", place)) {
      if (text.startsWith("<!---->", place)) return place + 7;
      // Its text starts with neither `>` nor `->`, and holds no `--`.
      let start = place + 4;
      if (text[start] === "-") start++;
      const first = this.#char(start, to);
      if (first === ">" || first === "-") return undefined;
      const dashes = text.indexOf("--", start + 1);
      this.#step((dashes === -1 ? to : dashes) - place);
      const close = unended(dashes);
      if (typeof close !== "number") return close;
      if (close + 2 >= to) return this.#unended(to);
      return text[close + 2] === ">" ? close + 3 : undefined;
    }
    if (text.startsWith("<![CDATA[", place)) {
      const close = text.indexOf("]]>", place + 9);
      this.#step((close === -1 ? to : close) - place);
      const end = unended(close);
      return typeof end === "number" ? end + 3 : end;
    }
    // A declaration: letters, white space, and anything to `>`.
    let index = place + 2;
    while (index < to && isLetter(text[index] ?? "")) index++;
    if (index === place + 2) return undefined;
    if (index >= to) return this.#unended(to);
    if (!/\s/.test(text[index] ?? "")) return undefined;
    const close = text.indexOf(">", index);
    this.#step((close === -1 ? to : close) - place);
    const end = unended(close);
    return typeof end === "number" ? end + 1 : end;
  }

  /** `[[…]]` or `![[…]]`, on one line, with no `[[` in it. */
  #wikiLink(place: number, to: number): Attempt {
    const text = this.#text;
    const from = place + (text[place] === "!" ? 1 : 0);
    if (text[from] !== "[" || text[from + 1] !== "[") return undefined;
    const start = from + 2;
    const close = this.#search(closers, start + 1);
    if (close === -1 || close + 2 > to) return undefined;
    const lineEnd = this.#search(lineEnds, start);
    if (lineEnd !== -1 && lineEnd < close) return undefined;
    const inside = text.slice(start, close);
    this.#step(inside.length);
    if (inside.trim().includes("[[")) return undefined;
    return { end: close + 2 };
  }

  /** `[text](address "title")`, or an image, `![…](…)`. */
  #link(place: number, to: number, inLink: boolean): Attempt {
    const text = this.#text;
    const image = text[place] === "!";
    const open = place + (image ? 1 : 0);
    if (text[open] !== "[" || (!image && inLink)) return undefined;
    // The text, to the `]` that closes the `[`.
    let index = open + 1;
    let depth = 0;
    let textEnd = -1;
    while (index < to) {
      this.#step();
      const char = text[index];
      if (char === "`") {
        while (text[index + 1] === "`") index++;
      } else if (char === "\\") index++;
      else if (char === "[") depth++;
      else if (char === "]") {
        if (depth > 0) depth--;
        else {
          if (this.#char(index + 1, to) !== "(") {
            return index + 1 >= to ? this.#unended(to) : undefined;
          }
          textEnd = index;
          index += 2;
          break;
        }
      }
      index++;
    }
    if (textEnd === -1) return this.#unended(to);
    while (index < to && isSpace(text[index] ?? "")) index++;
    // The address, in `<…>` or to white space.
    if (text[index] === "<") {
      index++;
      while (index < to && text[index] !== ">") {
        this.#step();
        if (text[index] === "\n") return undefined;
        index++;
      }
      if (index >= to) return this.#unended(to);
      index++;
    } else {
      let parens = 0;
      while (index < to) {
        this.#step();
        const char = text[index] ?? "";
        if (isSpace(char)) break;
        if (char === "(") parens++;
        else if (char === ")") {
          if (parens === 0) break;
          parens--;
        }
        if (char === "\\") index++;
        index++;
      }
    }
    const spaced = index;
    while (index < to && isSpace(text[index] ?? "")) index++;
    const quote = text[index] ?? "";
    if (index > spaced && (quote === '"' || quote === "'" || quote === "(")) {
      const close = quote === "(" ? ")" : quote;
      index++;
      while (index < to && text[index] !== close) {
        this.#step();
        if (text[index] === "\\") index++;
        index++;
      }
      if (index >= to) return this.#unended(to);
      index++;
      while (index < to && isSpace(text[index] ?? "")) index++;
    }
    if (index >= to) return this.#unended(to);
    if (text[index] !== ")") return undefined;
    return image
      ? { end: index + 1 }
      : { end: index + 1, inner: [open + 1, textEnd, true] };
  }

  /** `^[…]`, a footnote written in the text. */
  #footnote(place: number, to: number): Attempt {
    const text = this.#text;
    if (text[place + 1] !== "[") return undefined;
    let index = place + 2;
    let depth = 0;
    // The length of the code span open in it, as a `]` in one closes nothing.
    let code = 0;
    while (index < to) {
      this.#step();
      const char = text[index];
      if (char === "`") {
        let run = 1;
        while (text[index + run] === "`") run++;
        if (code === 0) code = run;
        else if (code === run) code = 0;
        index += run;
        continue;
      }
      if (code === 0) {
        if (char === "\\") {
          index += 2;
          continue;
        }
        if (char === "[") depth++;
        else if (char === "]") {
          if (depth === 0)
            return { end: index + 1, inner: [place + 2, index, false] };
          depth--;
        }
      }
      index++;
    }
    return this.#unended(to);
  }

  /** `[^label]`, with no white space in its label. */
  #footnoteReference(place: number, to: number): Attempt {
    const text = this.#text;
    if (text[place + 1] !== "^") return undefined;
    let index = place + 2;
    while (index < to) {
      this.#step();
      const char = text[index] ?? "";
      if (char === "\n" || char === "\t" || char === " ") return undefined;
      if (char === "]")
        return index === place + 2 ? undefined : { end: index + 1 };
      index++;
    }
    return undefined;
  }

  /** `[text]`, `[text][label]`, or `[text][]`, or an image's, `![…]`. */
  #reference(place: number, to: number, inLink: boolean): Attempt {
    const text = this.#text;
    let index = place;
    const image = text[index] === "!";
    if (image) {
      if (text[index + 1] === "[" && text[index + 2] === "^") return undefined;
      index++;
    } else if (text[index + 1] === "^") return undefined;
    if (text[index] !== "[") return undefined;
    const start = index + 1;
    index = start;
    let depth = 0;
    let nested = false;
    while (index < to) {
      this.#step();
      const char = text[index];
      if (char === "[") {
        nested = true;
        depth++;
      } else if (char === "]") {
        if (depth === 0) break;
        depth--;
      }
      if (char === "\\") index++;
      index++;
    }
    if (index >= to) return this.#unended(to);
    const textEnd = index;
    index++;
    let full = false;
    if (text[index] === "[") {
      index++;
      const label = index;
      while (index < to && text[index] !== "[" && text[index] !== "]") {
        this.#step();
        if (text[index] === "\\") index++;
        index++;
      }
      if (index >= to && this.#unended(to) === open) return open;
      if (index < to && text[index] === "]") {
        full = index > label;
        index++;
      } else {
        // A label that does not close leaves the `[` that opened it taken.
        index = label;
      }
    } else if (textEnd === start) return undefined;
    if (!full && nested) return undefined;
    if (!image && inLink) return undefined;
    return image
      ? { end: index }
      : { end: index, inner: [start, textEnd, true] };
  }

  /** `**…**` or `__…__`. */
  #strong(place: number, to: number): Attempt {
    const text = this.#text;
    const mark = text[place] ?? "";
    if (text[place + 1] !== mark) return undefined;
    let index = place + 2;
    let filled = false;
    while (index < to) {
      this.#step();
      let char = text[index] ?? "";
      if (char === mark && this.#char(index + 1, to) === mark) {
        if (this.#char(index + 2, to) !== mark) {
          if (!filled) return undefined;
          return { end: index + 2, inner: [place + 2, index, false] };
        }
        char = mark;
      }
      if (char === "\\") {
        filled = true;
        index++;
        char = this.#char(index, to);
      }
      if (!filled && char !== "" && !isSpace(char)) filled = true;
      index++;
    }
    return this.#unended(to);
  }

  /** `*…*` or `_…_`. */
  #emphasis(place: number, to: number): Attempt {
    const text = this.#text;
    const mark = text[place] ?? "";
    let index = place + 1;
    let filled = false;
    let char = "";
    while (index < to) {
      this.#step();
      const before = char;
      char = text[index] ?? "";
      if (char === mark) {
        index++;
        char = this.#char(index, to);
        if (char !== mark) {
          if (!filled || before === mark) return undefined;
          if (mark === "_" && char !== "" && isWord(char)) {
            filled = true;
            continue;
          }
          return { end: index, inner: [place + 1, index - 1, false] };
        }
        filled = true;
      }
      if (char === "\\") {
        filled = true;
        index++;
        char = this.#char(index, to);
      }
      if (!filled && char !== "" && !isSpace(char)) filled = true;
      index++;
    }
    return this.#unended(to);
  }

  /** `~~…~~`, strikethrough, or `==…==`, a highlight. */
  #pair(place: number, to: number): Attempt {
    const text = this.#text;
    const mark = text[place] ?? "";
    if (text[place + 1] !== mark || isSpace(this.#char(place + 2, to))) {
      return undefined;
    }
    if (mark === "=" && text.startsWith("====", place)) return undefined;
    let before = "";
    let previous = "";
    for (let index = place + 2; index < to; index++) {
      this.#step();
      const char = text[index] ?? "";
      if (
        char === mark &&
        previous === mark &&
        (before === "" || !isSpace(before))
      ) {
        return { end: index + 1, inner: [place + 2, index - 1, false] };
      }
      before = previous;
      previous = char;
    }
    return this.#unended(to);
  }

  /** A run of backticks and the next run as long. */
  #codeSpan(place: number, to: number): Attempt {
    const text = this.#text;
    // A run that gives up its first backtick is counted once, not again for
    // each backtick it gives up.
    let end = this.#runEnd;
    if (place <= this.#runStart || place >= end || end > to) {
      end = place;
      while (end < to && text[end] === "`") {
        this.#step();
        end++;
      }
      this.#runStart = place;
      this.#runEnd = end;
    }
    const run = end - place;
    if (place + run >= to) return this.#unended(to);
    this.#runs ??= backtickRuns(this.#text);
    this.#step(Math.ceil(Math.log2(text.length + 2)));
    const close = runAfter(this.#runs, place + run, run);
    if (close === undefined || close + run > to) return this.#unended(to);
    return { end: close + run, code: [place, close] };
  }

  #tag(place: number, to: number): Attempt {
    tagName.lastIndex = place;
    const found = tagName.exec(this.#text);
    this.#step(found?.[0].length ?? 1);
    if (found === null) return undefined;
    // A tag's name ends where the text read does.
    const end = Math.min(to, place + found[0].length);
    if (end - place < 2 || /^#\d+$/.test(this.#text.slice(place, end))) {
      return undefined;
    }
    return { end };
  }

  /** `$…$`, or `$$…$$`. */
  #math(place: number, to: number): Attempt {
    const text = this.#text;
    let index = place + 1;
    const display = text[index] === "$";
    if (display) index++;
    const first = this.#char(index, to);
    if (!display && (first === " " || first === "\t")) return undefined;
    while (index < to) {
      this.#step();
      const char = text[index];
      const next = this.#char(index + 1, to);
      if (char === "$") {
        const before = text[index - 1] ?? "";
        const closes = display
          ? next === "$"
          : before !== " " && before !== "\t" && !isDigit(next);
        if (closes) {
          let end = index + (display ? 2 : 1);
          if (display) {
            // Display math takes the white space after it, and a line break.
            let after = end;
            while (after < to) {
              const space = text[after] ?? "";
              if (space === "\n") {
                end = after + 1;
                break;
              }
              if (/\s/.test(space)) after++;
              else break;
            }
          }
          return { end };
        }
      } else if (char === "\\") index++;
      index++;
    }
    return this.#unended(to);
  }

  #comment(place: number, to: number): Attempt {
    // A comment ends on its line, which ends what this reads too.
    comment.lastIndex = place;
    const found = comment.exec(this.#text);
    const lineEnd = this.#search(lineEnds, place);
    this.#step(found?.[0].length ?? (lineEnd === -1 ? to : lineEnd) - place);
    if (found === null || place + found[0].length > to) return undefined;
    return { end: place + found[0].length };
  }
}

/** Where each run of backticks in `text` starts, by its length, in order. */
function backtickRuns(text: string): Map<number, number[]> {
  const runs = new Map<number, number[]>();
  let at = text.indexOf("`");
  while (at !== -1) {
    let length = 0;
    while (text[at + length] === "`") length++;
    const starts = runs.get(length);
    if (starts === undefined) runs.set(length, [at]);
    else starts.push(at);
    at = text.indexOf("`", at + length);
  }
  return runs;
}

/**
 * Where the first run of exactly `length` backticks at or after `from` starts,
 * by the `runs` of a text, found by halving.
 */
function runAfter(
  runs: ReadonlyMap<number, readonly number[]>,
  from: number,
  length: number,
): number | undefined {
  const starts = runs.get(length) ?? [];
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((starts[middle] ?? Infinity) < from) low = middle + 1;
    else high = middle;
  }
  return starts[low];
}

/**
 * Whether index `at` of `text`, a paragraph's text without its containers'
 * markers, lies inside a code span or a `<code>` tag, as Obsidian reads the
 * text, or in a text too long to read with certainty in time. When `text`
 * may go on, as a paragraph read only so far does, undefined says that what
 * started before `at` may end in the rest.
 */
export function insideInlineCode(
  text: string,
  at: number,
  complete = true,
): boolean | undefined {
  try {
    return new Inline(text, at, !complete).find();
  } catch (error) {
    if (!(error instanceof TooLong)) throw error;
    // A text that would take too long to read, as one of thousands of
    // brackets that nothing closes would, cannot be read with certainty in
    // time: the place counts as code, so that nothing is inserted there.
    return true;
  }
}
