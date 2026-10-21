import { describe, expect, it } from "vitest";
import { embedPath } from "../../../src/notes/links.ts";
import {
  chooseName,
  chooseRename,
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
    // An invisible space, or a control that reorders text, would hide or
    // fake a name; so would a control character.
    expect(chooseName(char(0x200b))).toEqual({ kind: "number" });
    for (const code of [0x200b, 0x2060, 0xfeff, 0x202e, 0x2067, 0x85]) {
      expect(chooseName(`ga${char(code)}te`)).toEqual({
        kind: "name",
        name: "gate",
      });
    }
  });

  it("keeps the joiners and marks that spell or show a name", () => {
    const text = (...codes: number[]) => String.fromCodePoint(...codes);
    const names = [
      // Three faces joined into one emoji.
      text(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
      // A Persian word whose two parts a non-joiner keeps apart.
      text(0x645, 0x6cc, 0x200c, 0x62e, 0x648, 0x627, 0x647, 0x645),
      // A Devanagari half-form, which the joiner asks for.
      text(0x915, 0x94d, 0x200d, 0x937),
      // Latin and Arabic, with the marks that set their order.
      text(0x61, 0x200f, 0x627, 0x61c, 0x628),
    ];
    for (const name of names) {
      expect(chooseName(name)).toEqual({ kind: "name", name });
    }
    // Joiners alone still name nothing.
    expect(chooseName(text(0x200d, 0x200c))).toEqual({ kind: "number" });
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

describe("chooseRename", () => {
  it("keeps a file's own name, which chooseName would change or refuse", () => {
    for (const own of ["a#1", "door.", "con", "tower"]) {
      expect(chooseRename(own, own)).toEqual({ kind: "name", name: own });
      expect(chooseRename(` ${own} `, own)).toEqual({
        kind: "name",
        name: own,
      });
    }
    // Decomposed in the file or the field, it is the same name, as the file
    // has it.
    const decomposed = `cafe${String.fromCharCode(0x301)}`;
    expect(chooseRename(`caf${String.fromCharCode(0xe9)}`, decomposed)).toEqual(
      {
        kind: "name",
        name: decomposed,
      },
    );
  });

  it("reads any other name as chooseName does", () => {
    expect(chooseRename("", "a#1")).toEqual({ kind: "number" });
    expect(chooseRename("a#2", "a#1")).toEqual({ kind: "name", name: "a2" });
    expect(chooseRename("con", "")).toEqual(chooseName("con"));
    expect(chooseRename("CON", "con").kind).toBe("refused");
  });
});
