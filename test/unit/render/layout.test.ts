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
  /** An image element, which the record knows only as itself. */
  const image = (): object => ({});

  it("keeps an image's address until its file is refreshed", () => {
    const addresses = new RefreshedAddresses();
    const one = image();
    expect(addresses.shown(one, `${file}?100`)).toBeUndefined();
    expect(addresses.shown(one, `${file}?100`)).toBeUndefined();
    expect(addresses.shown(one, `${file}?200`)).toBeUndefined();
  });

  it("gives an image that missed a refresh the refresh's address", () => {
    const addresses = new RefreshedAddresses();
    const one = image();
    addresses.shown(one, `${file}?100`);
    // Rewritten with the same modification time, as the address shows,
    // while the image was out of every document.
    const next = addresses.refreshed(`${file}?100`);
    expect(fileAddress(next)).toBe(file);
    expect(next).toMatch(
      /^app:\/\/a1b2\/v\/Glyphs\/a\.ink\.png\?100=&inkline=/,
    );
    expect(addresses.shown(one, `${file}?100`)).toBe(next);
    // Once it has it, it keeps it.
    expect(addresses.shown(one, next)).toBeUndefined();
  });

  it("leaves an image that the refresh reached as it is", () => {
    const addresses = new RefreshedAddresses();
    const one = image();
    addresses.shown(one, `${file}?100`);
    const next = addresses.refreshed(`${file}?100`);
    // As the refresh gives it the address, and tags it again.
    expect(addresses.shown(one, next)).toBeUndefined();
    expect(addresses.shown(one, next)).toBeUndefined();
  });

  it("brings an image behind by several refreshes to the latest", () => {
    const addresses = new RefreshedAddresses();
    const out = image();
    const reached = image();
    addresses.shown(out, `${file}?100`);
    addresses.shown(reached, `${file}?100`);
    const first = addresses.refreshed(`${file}?100`);
    addresses.shown(reached, first);
    addresses.refreshed(`${file}?200`);
    const latest = addresses.refreshed(`${file}?300`);
    expect(addresses.shown(out, `${file}?100`)).toBe(latest);
    expect(addresses.shown(reached, first)).toBe(latest);
  });

  it("makes a new address for each refresh", () => {
    const addresses = new RefreshedAddresses();
    const first = addresses.refreshed(`${file}?100`);
    const second = addresses.refreshed(`${file}?100`);
    const elsewhere = new RefreshedAddresses().refreshed(`${file}?100`);
    expect(new Set([first, second, elsewhere]).size).toBe(3);
  });

  it("keeps an address that an image was given while it was out", () => {
    const addresses = new RefreshedAddresses();
    const one = image();
    addresses.shown(one, `${file}?100`);
    addresses.refreshed(`${file}?100`);
    // As Obsidian gives once the file changes again, before Inkline's next
    // refresh.
    expect(addresses.shown(one, `${file}?400`)).toBeUndefined();
    expect(addresses.shown(one, `${file}?400`)).toBeUndefined();
    // Until a later refresh passes it by too.
    const latest = addresses.refreshed(`${file}?400`);
    expect(addresses.shown(one, `${file}?400`)).toBe(latest);
  });

  it("leaves an image made anew as it comes, even with an old address", () => {
    const addresses = new RefreshedAddresses();
    addresses.shown(image(), `${file}?100`);
    addresses.refreshed(`${file}?100`);
    expect(addresses.shown(image(), `${file}?100`)).toBeUndefined();
  });

  it("keeps each file's images apart", () => {
    const addresses = new RefreshedAddresses();
    const a = image();
    const b = image();
    addresses.shown(a, `${file}?100`);
    addresses.shown(b, `${other}?100`);
    const latest = addresses.refreshed(`${file}?100`);
    expect(addresses.shown(b, `${other}?100`)).toBeUndefined();
    expect(addresses.shown(a, `${file}?100`)).toBe(latest);
    // An image that comes to show another file is that file's from then on.
    expect(addresses.shown(a, `${other}?100`)).toBeUndefined();
    addresses.refreshed(`${file}?100`);
    expect(addresses.shown(a, `${other}?100`)).toBeUndefined();
  });

  it("starts afresh for a file forgotten, as one deleted and made again", () => {
    const addresses = new RefreshedAddresses();
    const one = image();
    addresses.shown(one, `${file}?100`);
    // Refreshed while the image was out, then deleted and made again, and
    // the new file refreshed twice, so that its refreshes differ from the
    // old one's, before the image comes back.
    addresses.refreshed(`${file}?100`);
    addresses.forget(`${file}?100`);
    addresses.refreshed(`${file}?100`);
    addresses.refreshed(`${file}?100`);
    expect(addresses.shown(one, `${file}?100`)).toBeUndefined();
    // From then on it is an image of the new file.
    const latest = addresses.refreshed(`${file}?100`);
    expect(addresses.shown(one, `${file}?100`)).toBe(latest);
  });

  it("gives an image of a new file no address of the one before it", () => {
    // A at `file`, shown at ?500 and refreshed, is deleted; B made at its
    // path is shown at ?100, refreshed twice, and given ?500 by Obsidian.
    const addresses = new RefreshedAddresses();
    const ofA = image();
    const ofB = image();
    addresses.shown(ofA, `${file}?500`);
    const old = addresses.refreshed(`${file}?500`);
    addresses.shown(ofA, old);
    addresses.forget(`${file}?500`);
    addresses.shown(ofB, `${file}?100`);
    addresses.refreshed(`${file}?200`);
    const latest = addresses.refreshed(`${file}?200`);
    expect(addresses.shown(image(), `${file}?500`)).toBeUndefined();
    expect(addresses.shown(ofB, `${file}?100`)).toBe(latest);
    // A's image comes back with A's own address, and keeps it.
    expect(addresses.shown(ofA, old)).toBeUndefined();
  });

  it("gives a file renamed onto a used path no address of the file before it", () => {
    // A at `file`, shown at ?500 and refreshed while its image is out, is
    // renamed away to `moved`; B, at `other`, is renamed onto `file` and
    // refreshed twice. A rename forgets both its paths.
    const moved = "app://a1b2/v/Glyphs/c.ink.png";
    const addresses = new RefreshedAddresses();
    const ofA = image();
    addresses.shown(ofA, `${file}?500`);
    addresses.refreshed(`${file}?500`);
    addresses.forget(`${file}?500`);
    addresses.forget(`${moved}?500`);
    const ofB = image();
    addresses.shown(ofB, `${other}?100`);
    addresses.forget(`${other}?100`);
    addresses.forget(`${file}?100`);
    addresses.shown(ofB, `${file}?100`);
    addresses.refreshed(`${file}?100`);
    const latest = addresses.refreshed(`${file}?100`);
    expect(addresses.shown(ofA, `${file}?500`)).toBeUndefined();
    expect(addresses.shown(ofB, `${file}?100`)).toBe(latest);
  });

  it("keeps one record for each file, however often it is refreshed or forgotten", () => {
    // The bound is in the structure: one record for each file, dropped as it
    // is forgotten, and each image's record held only as long as the image.
    // So a short sequence shows it, past the 32 addresses an earlier design
    // of this record kept for each file, without the time a long one takes.
    const addresses = new RefreshedAddresses();
    for (let cycle = 0; cycle < 40; cycle++) {
      addresses.shown(image(), `${file}?${String(cycle)}`);
      addresses.refreshed(`${file}?${String(cycle)}`);
      addresses.forget(`${file}?${String(cycle)}`);
    }
    expect(addresses.size).toBe(0);
    // A file shown all along through 40 versions, each at an address of
    // Obsidian's on an image of its own, with an image that each refresh
    // reaches, and one out of the page with the first version's address.
    const reached = image();
    const out = image();
    addresses.shown(reached, `${file}?0`);
    addresses.shown(out, `${file}?0`);
    let latest = "";
    for (let version = 1; version <= 40; version++) {
      addresses.shown(image(), `${file}?${String(version)}`);
      latest = addresses.refreshed(`${file}?${String(version)}`);
      addresses.shown(reached, latest);
    }
    expect(addresses.size).toBe(1);
    expect(addresses.shown(out, `${file}?0`)).toBe(latest);
    expect(addresses.shown(reached, latest)).toBeUndefined();
  });

  it("reads nothing from an address past its file, as a name holding a mark", () => {
    // Obsidian leaves a name's `&` as it is, so the name's `&inkline=` comes
    // before the refresh's in the address.
    const odd = "app://a1b2/v/Glyphs/A&inkline=x.ink.png";
    const addresses = new RefreshedAddresses();
    const one = image();
    addresses.shown(one, `${odd}?100`);
    const first = addresses.refreshed(`${odd}?100`);
    expect(fileAddress(first)).toBe(odd);
    addresses.shown(one, first);
    let latest = first;
    for (let refresh = 0; refresh < 33; refresh++) {
      latest = addresses.refreshed(`${odd}?100`);
    }
    expect(addresses.shown(one, first)).toBe(latest);
    expect(addresses.size).toBe(1);
  });
});
