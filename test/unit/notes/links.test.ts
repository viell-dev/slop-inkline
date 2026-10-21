import { describe, expect, it } from "vitest";
import {
  embedAt,
  embedPath,
  insertionAt,
  paragraphLinks,
  outsideLinks,
  textLinks,
} from "../../../src/notes/links.ts";

describe("paragraphLinks", () => {
  it("finds wiki links and embeds, with their targets", () => {
    const line =
      "A [[tower]], ![[Glyphs/arch.ink.png]], [[gate#top|the gate]].";
    expect(paragraphLinks(line)).toEqual([
      { start: 2, end: 11, embed: false, target: "tower" },
      { start: 13, end: 37, embed: true, target: "Glyphs/arch.ink.png" },
      { start: 39, end: 60, embed: false, target: "gate" },
    ]);
  });

  it("finds Markdown links and embeds, with their destinations decoded", () => {
    const line = "![](Glyphs/tower%20one.ink.png) and [a](b.md 'title').";
    expect(paragraphLinks(line)).toEqual([
      { start: 0, end: 31, embed: true, target: "Glyphs/tower one.ink.png" },
      { start: 36, end: 53, embed: false, target: "b.md" },
    ]);
  });

  it("takes parentheses, a bare %, and angle brackets in destinations", () => {
    // A space is written %20, as Obsidian writes Markdown links.
    expect(paragraphLinks("![](Old%20(2)/a.ink.png)")).toEqual([
      { start: 0, end: 24, embed: true, target: "Old (2)/a.ink.png" },
    ]);
    expect(paragraphLinks("![](100%.ink.png)")[0]?.target).toBe("100%.ink.png");
    expect(paragraphLinks("![](<A B/c.ink.png>)")).toEqual([
      { start: 0, end: 20, embed: true, target: "A B/c.ink.png" },
    ]);
  });

  it("skips escaped syntax and code spans", () => {
    expect(paragraphLinks("\\[[not]] and \\![[a]]")).toEqual([
      { start: 15, end: 20, embed: false, target: "a" },
    ]);
    expect(
      paragraphLinks("`![[code]]` and ``![[`more`]]`` then [[real]]"),
    ).toEqual([{ start: 37, end: 45, embed: false, target: "real" }]);
  });

  it("finds nothing in brackets that are not a link", () => {
    expect(paragraphLinks("[just text] and [[unclosed and [a](b")).toEqual([]);
    expect(paragraphLinks("an unclosed `code span [[x]]")).toEqual([
      { start: 23, end: 28, embed: false, target: "x" },
    ]);
  });
});

describe("textLinks", () => {
  it("gives each line's links at their offsets in the text", () => {
    expect(textLinks("[[a]]\nx ![[b]]")).toEqual([
      { start: 0, end: 5, embed: false, target: "a" },
      { start: 8, end: 14, embed: true, target: "b" },
    ]);
  });
});

describe("outsideLinks and embedAt", () => {
  const text = "Read ![[tower.ink.png]] and [[gate]].";

  it("moves an insertion out of a link, to just past its end", () => {
    expect(outsideLinks(text, 10)).toBe(23);
    expect(outsideLinks(text, 30)).toBe(36);
    // At either end of a link, nothing is split.
    expect(outsideLinks(text, 5)).toBe(5);
    expect(outsideLinks(text, 23)).toBe(23);
    expect(outsideLinks(text, 2)).toBe(2);
  });

  it("finds the embed at an offset on it or at its ends", () => {
    expect(embedAt(text, 5)?.target).toBe("tower.ink.png");
    expect(embedAt(text, 14)?.target).toBe("tower.ink.png");
    expect(embedAt(text, 23)?.target).toBe("tower.ink.png");
    expect(embedAt(text, 30)).toBeUndefined();
    expect(embedAt(text, 2)).toBeUndefined();
  });
});

describe("links as Obsidian reads them", () => {
  const spans = (text: string) =>
    textLinks(text).map(({ start, end, embed, target }) => [
      text.slice(start, end),
      embed,
      target,
    ]);

  it("reads a Markdown link across a line break, but no link across a blank line", () => {
    const text =
      "some [the symbol of the gate\nis here](gate.md) and ![a\nb](c.png)\n- [a\n  b](d)\n> [e\n> f](g)\n[h\n\ni](j) [[k\nl]]";
    expect(spans(text)).toEqual([
      ["[the symbol of the gate\nis here](gate.md)", false, "gate.md"],
      ["![a\nb](c.png)", true, "c.png"],
      ["[a\n  b](d)", false, "d"],
      ["[e\n> f](g)", false, "g"],
    ]);
    // With space and a line break around the destination and its title.
    expect(spans('[a](\nb\n"t"\n)')).toEqual([['[a](\nb\n"t"\n)', false, "b"]]);
  });

  it("reads titles with escaped delimiters", () => {
    for (const title of ['"ti\\"tle"', "'ti\\'tle'", "(ti\\)tle)"]) {
      expect(spans(`See [gate](gate.md ${title}) now`)).toEqual([
        [`[gate](gate.md ${title})`, false, "gate.md"],
      ]);
    }
  });

  it("knows an escaped backslash leaves the ! after it an embed's", () => {
    expect(spans("\\\\![[a]] and \\![[b]]")).toEqual([
      ["![[a]]", true, "a"],
      ["[[b]]", false, "b"],
    ]);
  });

  it("reads a wiki target as Obsidian does, in tables too", () => {
    expect(spans("| ![[a.ink.png\\|24]] | [[b\\|alias]] | [[c\\]] |")).toEqual([
      ["![[a.ink.png\\|24]]", true, "a.ink.png"],
      ["[[b\\|alias]]", false, "b"],
      ["[[c\\]]", false, "c"],
    ]);
    // A link to a heading in the same note leads nowhere else.
    expect(spans("[[#top]]")).toEqual([["[[#top]]", false, ""]]);
  });

  it("finds an embed inside a Markdown link's text", () => {
    const text = "[![[x.ink.png]]](https://example.com) [![](y.png)](z)";
    expect(spans(text)).toEqual([
      ["[![[x.ink.png]]](https://example.com)", false, "https://example.com"],
      ["![[x.ink.png]]", true, "x.ink.png"],
      ["[![](y.png)](z)", false, "z"],
      ["![](y.png)", true, "y.png"],
    ]);
    expect(outsideLinks(text, 5)).toBe(37);
    expect(embedAt(text, 5)?.target).toBe("x.ink.png");
  });

  it("decodes a destination as Obsidian does, without its heading", () => {
    expect(spans("![](a%2Fb.png) [a](b\\)c) [a](\tb) ![](a.png#b)")).toEqual([
      ["![](a%2Fb.png)", true, "a%2Fb.png"],
      ["[a](b\\)c)", false, "b)c"],
      ["[a](\tb)", false, "b"],
      ["![](a.png#b)", true, "a.png"],
    ]);
  });

  it("reads a Markdown embed alone as one, whole, or as none", () => {
    expect(embedPath("![](<a b/001.ink.png>)")).toBe("a b/001.ink.png");
    expect(embedPath("![](sun%20(big).ink.png)")).toBe("sun (big).ink.png");
    expect(embedPath("![](sun%2050%25.ink.png)")).toBe("sun 50%.ink.png");
    // Escapes of reserved characters stay, as Obsidian reads them.
    expect(embedPath("![](x%26y.ink.png)")).toBe("x%26y.ink.png");
    // A ) that opens nothing, a ( that is not closed, and a space.
    for (const embed of [
      "![](a)b.ink.png)",
      "![](a(b.ink.png)",
      "![](a b.ink.png)",
      "![](<a.ink.png)",
      "![[a.ink.png]] ![[b.ink.png]]",
    ]) {
      expect(embedPath(embed)).toBeUndefined();
    }
  });

  it("finds no link where Obsidian reads none", () => {
    expect(spans("[[]] ![[]] []() [a]() [[a [[b]] [[x|[[y]]]]")).toEqual([
      ["[[b]]", false, "b"],
      ["[[y]]", false, "y"],
    ]);
  });

  it("finds web addresses, as Obsidian shows them as links", () => {
    expect(
      spans(
        "See https://example.com/a_(b), <https://example.org/x>, (www.example.net) or xhttps://no.",
      ),
    ).toEqual([
      ["https://example.com/a_(b)", false, "https://example.com/a_(b)"],
      ["<https://example.org/x>", false, "https://example.org/x"],
      ["www.example.net", false, "www.example.net"],
    ]);
  });

  it("finds addresses after any character, in any case, and email ones", () => {
    expect(
      spans(
        '"https://example.com/path" xhttps://no.example Https://Example.com foo.www.example.com',
      ),
    ).toEqual([
      ["https://example.com/path", false, "https://example.com/path"],
      ["https://no.example", false, "https://no.example"],
      ["Https://Example.com", false, "Https://Example.com"],
      ["www.example.com", false, "www.example.com"],
    ]);
    expect(
      spans("mailto:a@example.com, b.c@example.org and <d@example.net>"),
    ).toEqual([
      ["mailto:a@example.com", false, "mailto:a@example.com"],
      ["b.c@example.org", false, "b.c@example.org"],
      ["<d@example.net>", false, "d@example.net"],
    ]);
  });

  it("ends an address where Obsidian does, and needs a dot in its host", () => {
    expect(spans("See https://x.y/a; then")).toEqual([
      ["https://x.y/a", false, "https://x.y/a"],
    ]);
    expect(spans("https://x www.x www.example https://.")).toEqual([]);
  });

  it("reads a tab-only line as text, but a line of spaces as blank", () => {
    expect(spans("[a\n\t\nb](c)")).toEqual([["[a\n\t\nb](c)", false, "c"]]);
    expect(spans("[a\n  \nb](c)")).toEqual([]);
    // No-break and ideographic spaces are blank to Obsidian too.
    for (const space of [0xa0, 0x3000]) {
      expect(spans(`[a\n${String.fromCharCode(space)}\nb](c)`)).toEqual([]);
    }
  });

  it("puts a space before what follows a bare address", () => {
    const text = "See https://example.com/path now, [[gate]].";
    // Inside the address, at its end, and at its start.
    expect(insertionAt(text, 10)).toEqual({ at: 28, before: " " });
    expect(insertionAt(text, 28)).toEqual({ at: 28, before: " " });
    expect(insertionAt(text, 4)).toEqual({ at: 4, before: "" });
    // A link has its own end.
    expect(insertionAt(text, 37)).toEqual({ at: 42, before: "" });
  });

  it("reads a long line of unclosed brackets in time", () => {
    const started = performance.now();
    expect(textLinks("[".repeat(20000))).toEqual([]);
    expect(textLinks("[[".repeat(10000))).toEqual([]);
    expect(textLinks(`${"[".repeat(20000)}]`)).toEqual([]);
    // Links nested in links, around one embed, and an address before many
    // closing parentheses.
    const nested = `${"[".repeat(5000)}![](x.png)${"](b)".repeat(5000)}`;
    expect(textLinks(nested).length).toBeGreaterThan(0);
    expect(textLinks(`https://x.y/a${")".repeat(5000)}`)).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

/** A seeded generator of numbers from 0 up to 1, so that failures repeat. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe("links in generated text", () => {
  // Names with the characters that broke the prototype: %, parentheses,
  // spaces, and scripts other than Latin.
  const names = [
    "tower",
    "100%",
    "Old (2)/arch",
    "glyph one",
    "ᚠᚢ",
    "塔",
    "a%2Fb",
  ];
  // Line breaks too, and blank lines where two meet, which no link spans.
  const plain = [
    "The door",
    " reads ",
    "x",
    " (aside) ",
    " 50% ",
    " [note] ",
    "\n",
  ];
  // A Markdown link's text may wrap onto the next line.
  const texts = ["", "the\ngate", "a b"];

  /** Text of a few lines and links, and the links it holds. */
  function line(next: () => number): {
    text: string;
    links: { start: number; end: number; embed: boolean; target: string }[];
  } {
    let text = "";
    const links: {
      start: number;
      end: number;
      embed: boolean;
      target: string;
    }[] = [];
    const pick = <T>(list: readonly T[]): T =>
      list[Math.floor(next() * list.length)] ?? (list[0] as T);
    const parts = 1 + Math.floor(next() * 6);
    for (let part = 0; part < parts; part++) {
      const kind = Math.floor(next() * 4);
      if (kind === 0) {
        text += pick(plain);
        continue;
      }
      // A space keeps a ! in the text from making the next link an embed.
      if (text.endsWith("!")) text += " ";
      const embed = next() < 0.5;
      const name = pick(names);
      const target = `${name}.ink.png`;
      let link: string;
      if (kind === 1) {
        link = `${embed ? "!" : ""}[[${target}]]`;
      } else if (kind === 2) {
        link = `${embed ? "!" : ""}[[${target}|${pick(["", "24", "alias"])}]]`;
      } else {
        // Percent-escaped, as either form decodes, in angle brackets with
        // its spaces as they are, or without, with them escaped too.
        const written =
          next() < 0.5
            ? `<${encodeURI(target).replace(/%20/g, " ")}>`
            : encodeURI(target);
        link = `${embed ? "!" : ""}[${pick(texts)}](${written})`;
      }
      links.push({
        start: text.length,
        end: text.length + link.length,
        embed,
        target,
      });
      text += link;
    }
    return { text, links };
  }

  it("finds exactly the links each line was made of", () => {
    const next = random(20261021);
    for (let round = 0; round < 500; round++) {
      const { text, links } = line(next);
      expect(textLinks(text)).toEqual(links);
    }
  });

  it("never inserts inside a link, and moves nothing that is outside one", () => {
    const next = random(42);
    for (let round = 0; round < 500; round++) {
      const { text, links } = line(next);
      for (let offset = 0; offset <= text.length; offset++) {
        const moved = outsideLinks(text, offset);
        const inside = links.find(
          (link) => link.start < offset && offset < link.end,
        );
        expect(moved).toBe(inside === undefined ? offset : inside.end);
        expect(
          links.some((link) => link.start < moved && moved < link.end),
        ).toBe(false);
      }
    }
  });
});
