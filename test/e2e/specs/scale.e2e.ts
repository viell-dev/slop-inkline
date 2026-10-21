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
 * The most a keystroke's search may take, for the slowest query, each the
 * fastest of three rounds. In Docker on Windows 11, with 5,000 symbols, it
 * was 6 ms in Obsidian 1.14.4 and 8 ms in 1.13.4, and 18 ms at worst over
 * every round; a search that scanned the vault once for each symbol took
 * over 2 s each, and the test ran past its 60 s limit.
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
    // In batches, each well within WebDriver's limit for one script, which
    // all of them at once can pass on a loaded machine; a batch makes only
    // what is missing, so that one sent again does no harm.
    const png = symbol();
    for (let first = 0; first < count; first += 500) {
      await browser.executeObsidian(
        async ({ app }, from, to, image) => {
          const data = Uint8Array.from(atob(image), (c) =>
            c.charCodeAt(0),
          ).buffer;
          for (let index = from; index < to; index++) {
            const folder = `Many/${String(Math.floor(index / 100)).padStart(2, "0")}`;
            for (const path of ["Many", folder]) {
              if (app.vault.getFolderByPath(path) === null) {
                await app.vault.createFolder(path);
              }
            }
            const file = `${folder}/glyph ${String(index).padStart(4, "0")}.ink.png`;
            if (app.vault.getFileByPath(file) === null) {
              await app.vault.createBinary(file, data);
            }
          }
        },
        first,
        Math.min(first + 500, count),
        png,
      );
    }
    await browser.executeObsidian(async ({ app }) => {
      // A note that uses one of them twice, which ranks it first.
      await app.vault.create(
        "Large.md",
        "Used: ![[glyph 0007.ink.png]] ![[glyph 0007.ink.png]]\n\nHERE\n",
      );
    });
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
      // Each query's fastest of three rounds: a slow search is slow in every
      // round, while other work beside the test, such as the other Obsidian
      // version's tests, slows only some.
      const best = new Map<string, number>();
      const lists = new Map<string, string[]>();
      for (let round = 0; round < 3; round++) {
        for (const query of queries) {
          const started = performance.now();
          lists.set(query, list(query));
          const ms = performance.now() - started;
          best.set(query, Math.min(best.get(query) ?? ms, ms));
        }
      }
      const times = [...best.values()];
      return {
        symbols: app.vault
          .getFiles()
          .filter(
            (entry) =>
              entry.path.startsWith("Many/") && entry.path.endsWith(".ink.png"),
          ).length,
        times,
        all: lists.get("") ?? [],
        spaced: lists.get("glyph 4242") ?? [],
        number: lists.get("4242") ?? [],
        none: lists.get("zzzz") ?? [],
      };
    });
    console.log(
      `${String(result.symbols)} symbols: slowest query ${Math.max(...result.times).toFixed(1)} ms, median ${[...result.times].sort((a, b) => a - b)[Math.floor(result.times.length / 2)]?.toFixed(1) ?? "?"} ms, each the fastest of three`,
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
