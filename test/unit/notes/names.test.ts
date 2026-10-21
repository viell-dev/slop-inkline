import { describe, expect, it } from "vitest";
import { embedPath } from "../../../src/notes/links.ts";
import {
  chooseName,
  embedFromLink,
  encodePath,
  nextNumberName,
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
      expect(embedPath(`![](${encoded})`)).toBe(path);
      expect(encoded).not.toMatch(/[ ()<>]/);
    }
    expect(encodePath("Glyphs/x%41.ink.png")).toBe("Glyphs/x%2541.ink.png");
    expect(encodePath("Glyphs/jix%41&y.ink.png")).toBe(
      "Glyphs/jix%2541&y.ink.png",
    );
  });
});

describe("chooseName", () => {
  it("keeps a name in any script, without what a file name cannot hold", () => {
    expect(chooseName("tower")).toEqual({ kind: "name", name: "tower" });
    expect(chooseName("ᚠᚢ 塔")).toEqual({ kind: "name", name: "ᚠᚢ 塔" });
    expect(chooseName("gate?")).toEqual({ kind: "name", name: "gate" });
    expect(chooseName('a*b"c\\d/e<f>g:h|i#j^k[l]m')).toEqual({
      kind: "name",
      name: "abcdefghijklm",
    });
    expect(chooseName("tab\there")).toEqual({ kind: "name", name: "tabhere" });
  });

  it("drops space around a name, dots before it, and dots after it", () => {
    expect(chooseName("  the gate  ")).toEqual({
      kind: "name",
      name: "the gate",
    });
    expect(chooseName(".hidden")).toEqual({ kind: "name", name: "hidden" });
    expect(chooseName("door. . ")).toEqual({ kind: "name", name: "door" });
  });

  it("takes a number for an empty name, or one with nothing left", () => {
    expect(chooseName("")).toEqual({ kind: "number" });
    expect(chooseName("   ")).toEqual({ kind: "number" });
    expect(chooseName("???")).toEqual({ kind: "number" });
  });

  it("keeps a name as Obsidian stores it, without invisible characters", () => {
    const char = (code: number) => String.fromCharCode(code);
    // A decomposed letter is composed, as Obsidian composes file names.
    expect(chooseName(`cafe${char(0x301)}`)).toEqual({
      kind: "name",
      name: `caf${char(0xe9)}`,
    });
    // A no-break space is a plain one.
    expect(chooseName(`the${char(0xa0)}gate`)).toEqual({
      kind: "name",
      name: "the gate",
    });
    expect(chooseName(`door.${char(0x202f)}.`)).toEqual({
      kind: "name",
      name: "door",
    });
    // A format character, as a zero-width space, would hide or fake a name.
    expect(chooseName(char(0x200b))).toEqual({ kind: "number" });
    expect(chooseName(`ga${char(0x200d)}te`)).toEqual({
      kind: "name",
      name: "gate",
    });
  });

  it("refuses device names and names too long for a file", () => {
    for (const name of ["CON", "nul", "Com1", "LPT9"]) {
      expect(chooseName(name).kind).toBe("refused");
    }
    expect(chooseName("CONSOLE")).toEqual({ kind: "name", name: "CONSOLE" });
    // Windows reads a name before a dot as the device too.
    expect(chooseName("CON.txt").kind).toBe("refused");
    expect(chooseName("CONSOLE.txt").kind).toBe("name");
    // 247 bytes and .ink.png fit; one more byte does not.
    expect(chooseName("a".repeat(247)).kind).toBe("name");
    expect(chooseName("a".repeat(248)).kind).toBe("refused");
    // Three bytes each in UTF-8.
    expect(chooseName("塔".repeat(83)).kind).toBe("refused");
  });
});
