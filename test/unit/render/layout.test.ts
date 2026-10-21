import { describe, expect, it } from "vitest";
import {
  cssUrl,
  dropFor,
  explicitHeight,
  isSymbolUrl,
} from "../../../src/render/layout.ts";

describe("isSymbolUrl", () => {
  const vault = "app://a1b2/";

  it("refuses images from anywhere but the vault", () => {
    expect(isSymbolUrl("https://example.com/a.ink.png", vault)).toBe(false);
    expect(isSymbolUrl("app://other/V/a.ink.png", vault)).toBe(false);
    expect(isSymbolUrl("app://a1b2/V/a.ink.png", "")).toBe(false);
  });

  it("knows a vault symbol's URL, with the query Obsidian adds", () => {
    expect(
      isSymbolUrl("app://a1b2/C:/Vault/Glyphs/001.ink.png?1760000000", vault),
    ).toBe(true);
    expect(isSymbolUrl("app://a1b2/home/me/Vault/tower.INK.PNG", vault)).toBe(
      true,
    );
  });

  it("decodes the path, and survives a stray %", () => {
    expect(isSymbolUrl("app://a1b2/V/glyph%20one.ink%2Epng?2", vault)).toBe(
      true,
    );
    expect(isSymbolUrl("app://a1b2/V/100%.ink.png", vault)).toBe(true);
  });

  it("refuses other images, and a symbol's name in the query only", () => {
    expect(isSymbolUrl("app://a1b2/V/photo.png", vault)).toBe(false);
    expect(isSymbolUrl("app://a1b2/V/ink.png", vault)).toBe(false);
    expect(isSymbolUrl("app://a1b2/V/photo.png?x.ink.png", vault)).toBe(false);
    expect(isSymbolUrl("https://example.com/a.png#b.ink.png", vault)).toBe(
      false,
    );
    expect(isSymbolUrl("", vault)).toBe(false);
  });
});

describe("cssUrl", () => {
  it("quotes the URL, escaping what would end its string", () => {
    expect(cssUrl("app://a/b.ink.png?1")).toBe('url("app://a/b.ink.png?1")');
    expect(cssUrl('a"b\\c\nd')).toBe('url("a\\"b\\\\c\\a d")');
  });
});

describe("dropFor", () => {
  it("puts a quarter of the height below the baseline", () => {
    expect(dropFor(24)).toBe("-6px");
    expect(dropFor(0)).toBe("0px");
  });
});

describe("explicitHeight", () => {
  it("takes the height attribute when there is one", () => {
    expect(explicitHeight("40", "30", 96, 192)).toBe(30);
  });

  it("takes the width at the image's own aspect ratio", () => {
    expect(explicitHeight("24", null, 96, 192)).toBe(48);
  });

  it("waits for the image's size, and ignores sizes that are not ones", () => {
    expect(explicitHeight("24", null, 0, 0)).toBeUndefined();
    expect(explicitHeight("wide", null, 96, 192)).toBeUndefined();
    expect(explicitHeight(null, "0", 96, 192)).toBeUndefined();
    expect(explicitHeight(null, null, 96, 192)).toBeUndefined();
  });
});
