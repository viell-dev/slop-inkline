// Inkline in a vault with many symbols: what each keystroke after the
// trigger costs, as type to insert lists them. Rendering the many symbols of
// one note is measured in render.e2e.ts.

import { browser, expect } from "@wdio/globals";
import { encodePng } from "../../support/png.ts";
import { toBase64 } from "../support/browser.ts";
import { openAtMarker } from "../support/editor.ts";

/** How many symbols the vault holds, in folders of a hundred. */
const count = 5000;

/**
 * The most a keystroke's search may take, at its slowest. In Docker on
 * Windows 11, the slowest of 30 searches of 5,000 symbols took 13 ms in
 * Obsidian 1.14.4 and 17 ms in 1.13.4, and a test beside other work can take
 * five times as long; a search that scanned the vault once for each symbol
 * took over 2 s each, and the test ran past its 60 s limit.
 */
const budget = 100;

/** A synthetic symbol: the line box, with a grey block in it. */
function symbol(): string {
  const width = 64;
  const height = 192;
  const data = new Uint8Array(width * height * 4);
  for (let y = 48; y < 144; y++) {
    for (let x = 8; x < 56; x++) {
      data.set([126, 126, 126, 255], (y * width + x) * 4);
    }
  }
  return toBase64(encodePng({ width, height, data }));
}

describe("A vault with many symbols", function () {
  before(async function () {
    this.timeout(600_000);
    await browser.executeObsidian(
      async ({ app }, total, png) => {
        const data = Uint8Array.from(atob(png), (c) => c.charCodeAt(0)).buffer;
        await app.vault.createFolder("Many");
        for (let index = 0; index < total; index++) {
          const folder = `Many/${String(Math.floor(index / 100)).padStart(2, "0")}`;
          if (index % 100 === 0) await app.vault.createFolder(folder);
          const name = `glyph ${String(index).padStart(4, "0")}`;
          await app.vault.createBinary(`${folder}/${name}.ink.png`, data);
        }
        // A note that uses one of them twice, which ranks it first.
        await app.vault.create(
          "Large.md",
          "Used: ![[glyph 0007.ink.png]] ![[glyph 0007.ink.png]]\n\nHERE\n",
        );
      },
      count,
      symbol(),
    );
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        ({ app }) =>
          (app.metadataCache.resolvedLinks["Large.md"]?.[
            "Many/00/glyph 0007.ink.png"
          ] ?? 0) === 2,
      ),
    );
  });

  it("finds the symbols a keystroke matches within a few frames", async function () {
    await openAtMarker("Large.md", "HERE");
    const result = await browser.executeObsidian(({ app }) => {
      // The list Inkline registered, among the editor's suggestions: an
      // internal of Obsidian's that only this measurement reads.
      const manager: unknown = Reflect.get(app.workspace, "editorSuggest");
      const suggests: unknown =
        typeof manager === "object" && manager !== null
          ? Reflect.get(manager, "suggests")
          : undefined;
      const registered: readonly unknown[] = Array.isArray(suggests)
        ? suggests
        : [];
      const found = registered.find(
        (suggest: unknown) =>
          typeof suggest === "object" &&
          suggest !== null &&
          suggest.constructor.name === "SymbolSuggest",
      );
      const search: unknown =
        typeof found === "object" && found !== null
          ? Reflect.get(found, "getSuggestions")
          : undefined;
      const file = app.vault.getFileByPath("Large.md");
      if (typeof search !== "function" || file === null) {
        throw new Error("no list of symbols registered");
      }
      const list = (query: string): string[] => {
        const files: unknown = search.call(found, {
          query,
          file,
          editor: undefined,
          start: { line: 2, ch: 0 },
          end: { line: 2, ch: query.length + 2 },
        });
        return Array.isArray(files)
          ? files.map((entry: unknown) =>
              typeof entry === "object" && entry !== null
                ? String(Reflect.get(entry, "path"))
                : "",
            )
          : [];
      };
      // As each letter of a name is typed, then a name with a space, a
      // number in full, and nothing that matches.
      const queries = [
        "",
        "g",
        "gl",
        "gly",
        "glyph",
        "glyph 4",
        "glyph 42",
        "glyph 4242",
        "4242",
        "zzzz",
      ];
      const times: number[] = [];
      const lists = new Map<string, string[]>();
      for (let round = 0; round < 3; round++) {
        for (const query of queries) {
          const started = performance.now();
          lists.set(query, list(query));
          times.push(performance.now() - started);
        }
      }
      return {
        symbols: app.vault
          .getFiles()
          .filter((entry) => entry.path.endsWith(".ink.png")).length,
        times,
        all: lists.get("") ?? [],
        spaced: lists.get("glyph 4242") ?? [],
        number: lists.get("4242") ?? [],
        none: lists.get("zzzz") ?? [],
      };
    });
    console.log(
      `${String(result.symbols)} symbols: slowest search ${Math.max(...result.times).toFixed(1)} ms, median ${[...result.times].sort((a, b) => a - b)[Math.floor(result.times.length / 2)]?.toFixed(1) ?? "?"} ms`,
    );
    expect(result.symbols).toBe(count);
    // The list holds the 50 best, the one the note uses most first.
    expect(result.all).toHaveLength(50);
    expect(result.all[0]).toBe("Many/00/glyph 0007.ink.png");
    expect(result.spaced).toEqual(["Many/42/glyph 4242.ink.png"]);
    expect(result.number[0]).toBe("Many/42/glyph 4242.ink.png");
    expect(result.none).toEqual([]);
    expect(Math.max(...result.times)).toBeLessThan(budget);
  });
});
