import { describe, expect, it } from "vitest";
import {
  inBlock,
  isOpen,
  mayChange,
  noTags,
  type OpenTags,
  readHtml,
  readHtmlLine,
  settled,
} from "../../../src/notes/html.ts";

/** What is open after `lines`, an HTML block's lines, in block 1. */
function after(...lines: string[]): OpenTags {
  let tags = inBlock(noTags, 1, 0);
  for (const line of lines) tags = readHtmlLine(line, tags);
  return tags;
}

/** Whether a `<code>` opened before `html` is still open after it. */
function keepsCode(...lines: string[]): boolean {
  return after("<code>", ...lines).code.length > 0;
}

describe("readHtml", () => {
  it("opens code at a <code> in any form, and closes it at </code>", () => {
    for (const tag of ["<code>", "<CODE>", "<code/>", '<code class="x"/>']) {
      expect(after(tag).code).toHaveLength(1);
      expect(after(`${tag}a</code>`).code).toHaveLength(0);
    }
    expect(after("<pre>").pre).toBe(1);
    expect(after("<pre></pre>").pre).toBe(0);
    // Other names are other elements.
    expect(isOpen(after("<codex>"))).toBe(false);
    expect(keepsCode("</codex>")).toBe(true);
    expect(keepsCode("</pre>")).toBe(true);
  });

  it("reads no tag in a comment, by the HTML standard's ends", () => {
    expect(keepsCode("<!-- </code> -->")).toBe(true);
    expect(keepsCode("<!--", "</code>", "-->")).toBe(true);
    expect(keepsCode("<!-- x --></code>")).toBe(false);
    // Its other ends, and what does not end it.
    for (const ends of ["<!-->", "<!--->", "<!---->", "<!-- a --!>"]) {
      expect(keepsCode(`${ends}</code>`)).toBe(false);
    }
    expect(keepsCode("<!-- a ---></code>")).toBe(false);
    expect(keepsCode("<!-- <!--></code>")).toBe(false);
    expect(keepsCode("<!-- <!- --></code>")).toBe(false);
    for (const goesOn of ["<!-- a -- >", "<!-- a --!", "<!-- a --!->"]) {
      expect(keepsCode(`${goesOn}</code> -->`)).toBe(true);
    }
  });

  it("reads no tag in a quoted value, quoted only after =", () => {
    expect(keepsCode('<span title="</code>">')).toBe(true);
    expect(keepsCode("<span title='</code>'>")).toBe(true);
    expect(keepsCode('<span title="', "</code>", '">')).toBe(true);
    expect(keepsCode('<span a= "></code>">')).toBe(true);
    expect(keepsCode('<span title="x"></code>')).toBe(false);
    // Quotes elsewhere are part of a name or a value.
    expect(keepsCode('<span "a></code>')).toBe(false);
    expect(keepsCode('<span ="a></code>')).toBe(false);
    expect(keepsCode('<span title=a"b></code>')).toBe(false);
    expect(keepsCode("<span a=></code>")).toBe(false);
    expect(keepsCode("<span", 'title="x"></code>')).toBe(false);
  });

  it("ends <?, <!, CDATA, and </ without a letter at the first >", () => {
    expect(keepsCode("<? a </code> ?>")).toBe(true);
    expect(keepsCode("<? a > </code>")).toBe(false);
    expect(keepsCode("<!X a > </code>")).toBe(false);
    expect(keepsCode('<!DOCTYPE a "</code>">')).toBe(true);
    expect(keepsCode("<![CDATA[ </code> ]]>")).toBe(true);
    expect(keepsCode("<![CDATA[ a > </code> ]]>")).toBe(false);
    expect(keepsCode("</ </code> >")).toBe(true);
    expect(keepsCode("</1</code>")).toBe(true);
    // `</>` is nothing.
    expect(keepsCode("</></code>")).toBe(false);
  });

  it("reads an element's text that no tag but its own ends as text", () => {
    for (const name of [
      "iframe",
      "noembed",
      "noframes",
      "style",
      "textarea",
      "title",
      "xmp",
    ]) {
      expect(keepsCode(`<${name}></code></${name}>`)).toBe(true);
      expect(keepsCode(`<${name}>x</${name}></code>`)).toBe(false);
      // What follows it, until it ends, counts as code.
      expect(isOpen(after(`<${name}>`))).toBe(true);
    }
    expect(keepsCode("<textarea/></code></textarea>")).toBe(true);
    expect(keepsCode("<textarea></textareax></code></textarea>")).toBe(true);
    // `<noscript>` is read as HTML, as Obsidian reads it.
    expect(keepsCode("<noscript></code></noscript>")).toBe(false);
  });

  it("closes nothing in a table, a cell, or what else holds a closing tag", () => {
    for (const name of [
      "applet",
      "caption",
      "marquee",
      "object",
      "select",
      "table",
      "td",
      "template",
      "th",
    ]) {
      expect(keepsCode(`<${name}></code>`)).toBe(true);
      expect(keepsCode(`<${name}></${name}></code>`)).toBe(false);
    }
    expect(keepsCode("<table><tr><td></code></td></tr></table>")).toBe(true);
    // One opened before the `<code>` holds none of its closing tags.
    expect(after("<table><code>a</code>").code).toHaveLength(0);
  });

  it("closes no <code> with eight special elements or more between", () => {
    expect(keepsCode(`${"<div>".repeat(7)}</code>`)).toBe(false);
    expect(keepsCode(`${"<div>".repeat(8)}</code>`)).toBe(true);
    expect(keepsCode(`${"<blockquote>".repeat(8)}</code>`)).toBe(true);
    // Elements that are not special count for nothing.
    expect(keepsCode(`${"<span>".repeat(10)}</code>`)).toBe(false);
    // Blocks of the note's own, by its containers, when it opened earlier.
    const open = after("<code>");
    expect(readHtml("</code>", inBlock(open, 2, 6)).code).toHaveLength(0);
    expect(readHtml("</code>", inBlock(open, 2, 7)).code).toHaveLength(1);
    expect(readHtml("</code>", inBlock(open, 1, 14)).code).toHaveLength(0);
  });

  it("is sure of nothing after a <script>, <plaintext>, <svg>, or <math>", () => {
    for (const name of ["script", "plaintext", "svg", "math"]) {
      const tags = after(`<${name}></${name}>`);
      expect(tags.unsure).toBe(true);
      expect(isOpen(tags)).toBe(true);
      // Once unsure, nothing changes it.
      expect(readHtml("</code>", tags)).toBe(tags);
    }
    // Nor after more `<code>` tags open at once than it counts.
    expect(after("<code>".repeat(64)).unsure).toBe(false);
    expect(after("<code>".repeat(65)).unsure).toBe(true);
  });

  it("closes nothing where closing tags may not count, nor below a floor", () => {
    const open = after("<code><pre>");
    expect(readHtml("</code></pre>", open, false)).toMatchObject({
      code: open.code,
      pre: 1,
    });
    const floored = { ...open, floor: { code: 1, pre: 1 } };
    expect(readHtml("</code></pre>", floored)).toMatchObject({
      code: open.code,
      pre: 1,
    });
  });
});

describe("settled", () => {
  it("makes what a tag, quote, or comment leaves open uncertain", () => {
    for (const open of ["<!--", '<span title="', "<span", "<? a"]) {
      expect(settled(after(open)).unsure).toBe(true);
    }
    // An element's text goes on through Obsidian's own HTML.
    expect(settled(after("<textarea>")).unsure).toBe(false);
    expect(settled(after("<code>")).unsure).toBe(false);
  });
});

describe("mayChange", () => {
  it("reads only text that could change what is open", () => {
    expect(mayChange("plain text", noTags)).toBe(false);
    expect(mayChange("a <b>c</b>", noTags)).toBe(false);
    for (const text of [
      "<code>",
      "<pre>",
      "<!--",
      "<?",
      "<textarea>",
      "<svg>",
    ]) {
      expect(mayChange(`a ${text}`, noTags)).toBe(true);
    }
    expect(mayChange("a <b>c</b>", after("<code>"))).toBe(true);
    expect(mayChange("a </textarea>", after("<textarea>"))).toBe(true);
    expect(mayChange("a </code>", after("<script>"))).toBe(false);
  });
});
