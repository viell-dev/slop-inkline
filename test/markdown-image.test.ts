import { Option } from "effect";
import { describe, expect, it } from "vitest";
import type { Editor } from "obsidian";
import { createImageEmbed } from "../src/markdown/create-image-embed";
import { findImageTokenAtCursor } from "../src/markdown/find-image-token-at-cursor";
import type { ImageToken } from "../src/markdown/image-token";

function editorAt(line: string, ch: number): Editor {
  return {
    getCursor: () => ({ line: 0, ch }),
    getLine: () => line,
  };
}

function tokenAt(line: string, ch: number): ImageToken | null {
  return Option.getOrNull(findImageTokenAtCursor(editorAt(line, ch)));
}

describe("createImageEmbed", () => {
  it("prepends the embed marker and strips markdown alt text", () => {
    expect(createImageEmbed("[001](ink/001.ink.png)")).toBe(
      "![](ink/001.ink.png)",
    );
  });

  it("keeps an existing embed marker", () => {
    expect(createImageEmbed("![](ink/001.ink.png)")).toBe(
      "![](ink/001.ink.png)",
    );
  });

  it("strips wiki aliases", () => {
    expect(createImageEmbed("[[ink/001.ink.png|001]]")).toBe(
      "![[ink/001.ink.png]]",
    );
  });

  it("passes plain wiki embeds through unchanged", () => {
    expect(createImageEmbed("![[ink/001.ink.png]]")).toBe(
      "![[ink/001.ink.png]]",
    );
  });
});

describe("findImageTokenAtCursor", () => {
  it("finds a markdown image when the cursor is inside it", () => {
    const line = "before ![ink](symbols/alpha.ink.png) after";

    expect(tokenAt(line, 12)).toEqual({
      path: "symbols/alpha.ink.png",
      from: 7,
      to: 36,
    });
  });

  it("treats the start and exclusive end offset as inside the token", () => {
    const line = "x ![](alpha.ink.png) y";

    expect(tokenAt(line, 2)).toEqual({
      path: "alpha.ink.png",
      from: 2,
      to: 20,
    });
    expect(tokenAt(line, 20)).toEqual({
      path: "alpha.ink.png",
      from: 2,
      to: 20,
    });
  });

  it("returns none outside markdown image boundaries", () => {
    const line = "x ![](alpha.ink.png) y";

    expect(tokenAt(line, 1)).toBeNull();
    expect(tokenAt(line, 21)).toBeNull();
  });

  it("selects the token under the cursor when multiple embeds share a line", () => {
    const line = "![](one.ink.png) text ![two](two.ink.png)";

    expect(tokenAt(line, 4)).toEqual({
      path: "one.ink.png",
      from: 0,
      to: 16,
    });
    expect(tokenAt(line, 29)).toEqual({
      path: "two.ink.png",
      from: 22,
      to: 41,
    });
  });

  it("selects the second token when identical paths appear on one line", () => {
    const line = "![](same.ink.png) ![again](same.ink.png)";

    expect(tokenAt(line, 28)).toEqual({
      path: "same.ink.png",
      from: 18,
      to: 40,
    });
  });

  it("does not parse markdown images with escaped closing brackets in alt text", () => {
    const line = String.raw`![escaped \] bracket](escaped.ink.png)`;

    expect(tokenAt(line, 10)).toBeNull();
  });

  it("finds wiki image embeds and strips aliases and headings from the path", () => {
    const line = "start ![[Folder/Ink.ink.png#heading|display]] end";

    expect(tokenAt(line, 12)).toEqual({
      path: "Folder/Ink.ink.png",
      from: 6,
      to: 45,
    });
  });
});
