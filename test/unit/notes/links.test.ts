import { describe, expect, it } from "vitest";
import {
  embedAt,
  lineLinks,
  outsideLinks,
  textLinks,
} from "../../../src/notes/links.ts";

describe("lineLinks", () => {
  it("finds wiki links and embeds, with their targets", () => {
    const line =
      "A [[tower]], ![[Glyphs/arch.ink.png]], [[gate#top|the gate]].";
    expect(lineLinks(line)).toEqual([
      { start: 2, end: 11, embed: false, target: "tower" },
      { start: 13, end: 37, embed: true, target: "Glyphs/arch.ink.png" },
      { start: 39, end: 60, embed: false, target: "gate" },
    ]);
  });

  it("finds Markdown links and embeds, with their destinations decoded", () => {
    const line = "![](Glyphs/tower%20one.ink.png) and [a](b.md 'title').";
    expect(lineLinks(line)).toEqual([
      { start: 0, end: 31, embed: true, target: "Glyphs/tower one.ink.png" },
      { start: 36, end: 53, embed: false, target: "b.md" },
    ]);
  });

  it("takes parentheses, a bare %, and angle brackets in destinations", () => {
    // A space is written %20, as Obsidian writes Markdown links.
    expect(lineLinks("![](Old%20(2)/a.ink.png)")).toEqual([
      { start: 0, end: 24, embed: true, target: "Old (2)/a.ink.png" },
    ]);
    expect(lineLinks("![](100%.ink.png)")[0]?.target).toBe("100%.ink.png");
    expect(lineLinks("![](<A B/c.ink.png>)")).toEqual([
      { start: 0, end: 20, embed: true, target: "A B/c.ink.png" },
    ]);
  });

  it("skips escaped syntax and code spans", () => {
    expect(lineLinks("\\[[not]] and \\![[a]]")).toEqual([
      { start: 15, end: 20, embed: false, target: "a" },
    ]);
    expect(lineLinks("`![[code]]` and ``![[`more`]]`` then [[real]]")).toEqual([
      { start: 37, end: 45, embed: false, target: "real" },
    ]);
  });

  it("finds nothing in brackets that are not a link", () => {
    expect(lineLinks("[just text] and [[unclosed and [a](b")).toEqual([]);
    expect(lineLinks("an unclosed `code span [[x]]")).toEqual([
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
  const plain = ["The door", " reads ", "x", " (aside) ", " 50% ", " [note] "];

  /** A line of text and links, and the links it holds. */
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
        link = `${embed ? "!" : ""}[](${written})`;
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
      expect(lineLinks(text)).toEqual(links);
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
