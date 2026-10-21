import { describe, expect, it } from "vitest";
import {
  catalog,
  filterCatalog,
  foldersOf,
  type SymbolFile,
} from "../../../src/library/catalog.ts";

/** A symbol file at `path`, named and foldered as its path says. */
function file(path: string): SymbolFile {
  const slash = path.lastIndexOf("/");
  return {
    path,
    name: path.slice(slash + 1, -".ink.png".length),
    folder: slash === -1 ? "" : path.slice(0, slash),
  };
}

describe("catalog", () => {
  it("lists the notes that link to each symbol, in order", () => {
    const entries = catalog([file("001.ink.png"), file("tower.ink.png")], {
      "b.md": { "001.ink.png": 2, "photo.png": 1 },
      "a.md": { "001.ink.png": 1, "tower.ink.png": 0 },
      "c.md": {},
    });
    expect(entries).toEqual([
      { ...file("001.ink.png"), notes: ["a.md", "b.md"] },
      { ...file("tower.ink.png"), notes: [] },
    ]);
  });

  it("orders by folder, the top folder first, then by name, numbers by value", () => {
    const entries = catalog(
      [
        file("Runes/b.ink.png"),
        file("10.ink.png"),
        file("Glyphs/a.ink.png"),
        file("2.ink.png"),
        file("Tower.ink.png"),
        file("arch.ink.png"),
      ],
      {},
    );
    expect(entries.map((entry) => entry.path)).toEqual([
      "2.ink.png",
      "10.ink.png",
      "arch.ink.png",
      "Tower.ink.png",
      "Glyphs/a.ink.png",
      "Runes/b.ink.png",
    ]);
  });

  it("keeps an order for names that differ only in case", () => {
    const entries = catalog([file("a/Ab.ink.png"), file("a/ab.ink.png")], {});
    const again = catalog([file("a/ab.ink.png"), file("a/Ab.ink.png")], {});
    expect(entries.map((entry) => entry.path)).toEqual(
      again.map((entry) => entry.path),
    );
  });
});

describe("foldersOf", () => {
  it("names each folder once, in order", () => {
    const entries = catalog(
      [
        file("Runes/b.ink.png"),
        file("x.ink.png"),
        file("Runes/a.ink.png"),
        file("Glyphs/c.ink.png"),
      ],
      {},
    );
    expect(foldersOf(entries)).toEqual(["", "Glyphs", "Runes"]);
  });
});

describe("filterCatalog", () => {
  const entries = catalog(
    [
      file("Tower.ink.png"),
      file("Runes/tower two.ink.png"),
      file("Runes/gate.ink.png"),
      file(`Glyphs/caf${String.fromCharCode(0xe9)}.ink.png`),
      file("Glyphs/塔.ink.png"),
    ],
    {},
  );
  const paths = (found: readonly { path: string }[]) =>
    found.map((entry) => entry.path);

  it("keeps every symbol for an empty filter, in any folder", () => {
    expect(paths(filterCatalog(entries, "  ", undefined))).toEqual(
      paths(entries),
    );
  });

  it("keeps the names that hold what was typed, in any case and script", () => {
    expect(paths(filterCatalog(entries, "TOW", undefined))).toEqual([
      "Tower.ink.png",
      "Runes/tower two.ink.png",
    ]);
    expect(paths(filterCatalog(entries, "r t", undefined))).toEqual([
      "Runes/tower two.ink.png",
    ]);
    expect(paths(filterCatalog(entries, "塔", undefined))).toEqual([
      "Glyphs/塔.ink.png",
    ]);
    // Decomposed as typed, it matches the composed name.
    expect(
      paths(
        filterCatalog(entries, `cafe${String.fromCharCode(0x301)}`, undefined),
      ),
    ).toEqual([`Glyphs/caf${String.fromCharCode(0xe9)}.ink.png`]);
  });

  it("keeps one folder's symbols, the top folder's too", () => {
    expect(paths(filterCatalog(entries, "", "Runes"))).toEqual([
      "Runes/gate.ink.png",
      "Runes/tower two.ink.png",
    ]);
    expect(paths(filterCatalog(entries, "tow", "Runes"))).toEqual([
      "Runes/tower two.ink.png",
    ]);
    expect(paths(filterCatalog(entries, "", ""))).toEqual(["Tower.ink.png"]);
  });
});
