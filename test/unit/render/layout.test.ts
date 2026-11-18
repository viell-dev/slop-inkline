import { describe, expect, it } from "vitest";
import {
  aspectRatio,
  cssUrl,
  dropFor,
  explicitHeight,
  explicitWidth,
  fileAddress,
  isSymbolUrl,
  RefreshedAddresses,
  symbolName,
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
    expect(isSymbolUrl("app://a1b2/V/a.inK.png", vault)).toBe(false);
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

describe("aspectRatio", () => {
  it("is the image's own width over its height", () => {
    expect(aspectRatio(84, 192)).toBe(0.4375);
    expect(aspectRatio(4000, 192)).toBeCloseTo(20.8333, 4);
  });

  it("waits for the image's size", () => {
    expect(aspectRatio(0, 0)).toBeUndefined();
    expect(aspectRatio(84, 0)).toBeUndefined();
  });
});

describe("explicitWidth", () => {
  it("takes a size of only a width", () => {
    expect(explicitWidth("1000", null)).toBe(1000);
    expect(explicitWidth("24.5", null)).toBe(24.5);
  });

  it("ignores a size with a height, which keeps its height", () => {
    expect(explicitWidth("40", "30")).toBeUndefined();
    expect(explicitWidth(null, "30")).toBeUndefined();
  });

  it("ignores no size, and sizes that are not ones", () => {
    expect(explicitWidth(null, null)).toBeUndefined();
    expect(explicitWidth("wide", null)).toBeUndefined();
    expect(explicitWidth("0", null)).toBeUndefined();
    expect(explicitWidth("-5", null)).toBeUndefined();
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

describe("symbolName", () => {
  it("reads a symbol's name from its address", () => {
    expect(symbolName("app://a1b2/v/Glyphs/tower%20one.ink.png?123")).toBe(
      "tower one",
    );
    expect(symbolName("app://a1b2/v/%E5%A1%94.INK.PNG")).toBe("塔");
    expect(symbolName("app://a1b2/v/50%25%20off.ink.png#x")).toBe("50% off");
    // A stray % leaves the name as written.
    expect(symbolName("app://a1b2/v/a%.ink.png")).toBe("a%");
  });
});

describe("fileAddress", () => {
  it("is the address before any query or fragment", () => {
    expect(fileAddress("app://a1b2/v/a.ink.png?123&inkline=x")).toBe(
      "app://a1b2/v/a.ink.png",
    );
    expect(fileAddress("app://a1b2/v/a.ink.png#top")).toBe(
      "app://a1b2/v/a.ink.png",
    );
    expect(fileAddress("app://a1b2/v/a.ink.png")).toBe(
      "app://a1b2/v/a.ink.png",
    );
  });
});

describe("RefreshedAddresses", () => {
  const file = "app://a1b2/v/Glyphs/a.ink.png";
  const other = "app://a1b2/v/Glyphs/b.ink.png";

  it("keeps every address until its file is refreshed", () => {
    const addresses = new RefreshedAddresses();
    expect(addresses.shown(`${file}?100`)).toBeUndefined();
    expect(addresses.shown(`${file}?100`)).toBeUndefined();
    expect(addresses.shown(`${file}?200`)).toBeUndefined();
  });

  it("gives an address seen before a refresh the refresh's", () => {
    const addresses = new RefreshedAddresses();
    addresses.shown(`${file}?100`);
    // Rewritten with the same modification time, as the address shows.
    addresses.refreshed(`${file}?100=&inkline=one`);
    expect(addresses.shown(`${file}?100`)).toBe(`${file}?100=&inkline=one`);
    // The refresh's own address stays.
    expect(addresses.shown(`${file}?100=&inkline=one`)).toBeUndefined();
  });

  it("gives an earlier refresh's address the latest one", () => {
    const addresses = new RefreshedAddresses();
    addresses.shown(`${file}?100`);
    addresses.refreshed(`${file}?200=&inkline=one`);
    addresses.refreshed(`${file}?300=&inkline=two`);
    expect(addresses.shown(`${file}?100`)).toBe(`${file}?300=&inkline=two`);
    expect(addresses.shown(`${file}?200=&inkline=one`)).toBe(
      `${file}?300=&inkline=two`,
    );
  });

  it("keeps an address first seen after the latest refresh", () => {
    const addresses = new RefreshedAddresses();
    addresses.shown(`${file}?100`);
    addresses.refreshed(`${file}?100=&inkline=one`);
    // As Obsidian gives once the file changes again, before Inkline's next
    // refresh; or an address that was never on an image before the refresh.
    expect(addresses.shown(`${file}?400`)).toBeUndefined();
    expect(addresses.shown(`${file}?400`)).toBeUndefined();
    // Until a later refresh supersedes it too.
    addresses.refreshed(`${file}?400=&inkline=two`);
    expect(addresses.shown(`${file}?400`)).toBe(`${file}?400=&inkline=two`);
  });

  it("keeps each file's addresses apart", () => {
    const addresses = new RefreshedAddresses();
    addresses.shown(`${file}?100`);
    addresses.shown(`${other}?100`);
    addresses.refreshed(`${file}?100=&inkline=one`);
    expect(addresses.shown(`${other}?100`)).toBeUndefined();
    expect(addresses.shown(`${file}?100`)).toBe(`${file}?100=&inkline=one`);
  });

  it("starts afresh for a file forgotten, as one deleted and made again", () => {
    const addresses = new RefreshedAddresses();
    addresses.shown(`${file}?100`);
    addresses.refreshed(`${file}?100=&inkline=one`);
    addresses.forget(`${file}?100`);
    // The new file, here with the old one's modification time.
    expect(addresses.shown(`${file}?100`)).toBeUndefined();
    expect(addresses.shown(`${file}?100=&inkline=one`)).toBeUndefined();
    expect(addresses.shown(`${file}?100`)).toBeUndefined();
  });
});
