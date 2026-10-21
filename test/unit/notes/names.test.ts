import { describe, expect, it } from "vitest";
import {
  decodeDestination,
  embedFromLink,
  encodePath,
  markdownDestination,
  nextNumberName,
  readDestination,
  symbolStem,
} from "../../../src/notes/names.ts";

describe("symbolStem", () => {
  it("removes the ending in any case", () => {
    expect(symbolStem("𐎠.ink.png")).toBe("𐎠");
    expect(symbolStem("Water.INK.PNG")).toBe("Water");
    expect(symbolStem("photo.png")).toBeUndefined();
  });
});

describe("nextNumberName", () => {
  it("starts at 001 and fills gaps", () => {
    expect(nextNumberName([])).toBe("001");
    expect(nextNumberName(["001", "002", "004"])).toBe("003");
    expect(nextNumberName(["001", "water", "2", "0003"])).toBe("004");
  });

  it("grows past three digits", () => {
    const taken = Array.from({ length: 999 }, (_, index) => String(index + 1));
    expect(nextNumberName(taken)).toBe("1000");
  });
});

describe("embedFromLink", () => {
  it("embeds a wiki link and drops its alias", () => {
    expect(embedFromLink("[[001.ink.png]]")).toBe("![[001.ink.png]]");
    expect(embedFromLink("[[a/001.ink.png|001]]")).toBe("![[a/001.ink.png]]");
  });

  it("embeds a Markdown link and drops its text, which Obsidian reads as a width", () => {
    expect(embedFromLink("[001](001.ink.png)")).toBe("![](001.ink.png)");
    expect(embedFromLink("[x](a%20b/001.ink.png)")).toBe(
      "![](a%20b/001.ink.png)",
    );
  });

  it("keeps an embed it is given", () => {
    expect(embedFromLink("![[001.ink.png]]")).toBe("![[001.ink.png]]");
  });

  it("writes a % that starts no escape as one, which Obsidian leaves bare", () => {
    expect(embedFromLink("[](sun%2050%.ink.png)")).toBe(
      "![](sun%2050%25.ink.png)",
    );
    expect(embedFromLink("[](b%%.ink.png)")).toBe("![](b%25%25.ink.png)");
    expect(embedFromLink("[](a%2.ink.png)")).toBe("![](a%252.ink.png)");
    // One that does start an escape is left for the caller to check.
    expect(embedFromLink("[](x%41.ink.png)")).toBe("![](x%41.ink.png)");
    // Wiki links take no escapes.
    expect(embedFromLink("[[sun 50%.ink.png]]")).toBe("![[sun 50%.ink.png]]");
  });
});

describe("markdownDestination", () => {
  it("finds what a Markdown embed holds between its parentheses", () => {
    expect(markdownDestination("![](a%20b/001.ink.png)")).toBe(
      "a%20b/001.ink.png",
    );
    expect(markdownDestination("![](<a b/001.ink.png>)")).toBe(
      "<a b/001.ink.png>",
    );
    expect(markdownDestination("![](a)b.ink.png)")).toBe("a)b.ink.png");
    expect(markdownDestination("![[001.ink.png]]")).toBeUndefined();
  });
});

describe("decodeDestination", () => {
  it("decodes escapes as decodeURI does, and keeps what does not decode", () => {
    expect(decodeDestination("sun%2050%25.ink.png")).toBe("sun 50%.ink.png");
    expect(decodeDestination("x%41.ink.png")).toBe("xA.ink.png");
    expect(decodeDestination("sun%2050%.ink.png")).toBe("sun%2050%.ink.png");
    expect(decodeDestination("%E5%A1%94")).toBe("塔");
    // As Obsidian reads them, escapes of reserved characters stay.
    expect(decodeDestination("x%26y%23z.ink.png")).toBe("x%26y%23z.ink.png");
  });
});

describe("readDestination", () => {
  it("reads a destination in angle brackets, or with balanced parentheses", () => {
    expect(readDestination("<a b/001.ink.png>")).toBe("a b/001.ink.png");
    expect(readDestination("sun%20(big).ink.png")).toBe("sun (big).ink.png");
  });

  it("reads none where Markdown would end it early or read no link", () => {
    expect(readDestination("a)b.ink.png")).toBeUndefined();
    expect(readDestination("a(b.ink.png")).toBeUndefined();
    expect(readDestination("a b.ink.png")).toBeUndefined();
    expect(readDestination("<a.ink.png")).toBeUndefined();
  });
});

describe("encodePath", () => {
  it("reads back as the path, whatever its names hold", () => {
    const paths = [
      "Glyphs/x%41.ink.png",
      "Glyphs/jix%41&y.ink.png",
      "sun (big) 50%.ink.png",
      "a)b/c(d.ink.png",
      "half)moon.ink.png",
      "a+b,c;d=e@f$g.ink.png",
      "Glyphs 塔/ᚠ 1.ink.png",
    ];
    for (const path of paths) {
      const encoded = encodePath(path);
      expect(readDestination(encoded)).toBe(path);
      expect(encoded).not.toMatch(/[ ()<>]/);
    }
    expect(encodePath("Glyphs/x%41.ink.png")).toBe("Glyphs/x%2541.ink.png");
    expect(encodePath("Glyphs/jix%41&y.ink.png")).toBe(
      "Glyphs/jix%2541&y.ink.png",
    );
  });
});
