import { describe, expect, it } from "vitest";
import {
  embedFromLink,
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
});
