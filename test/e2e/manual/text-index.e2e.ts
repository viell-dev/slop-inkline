// Measures what reading symbols' readings and translations costs in real
// Obsidian, for 100, 1,000 and 10,000 symbols, cold and warm, as issue 189 asks,
// and what the index built on that costs: how long it takes, how long the main
// thread stalls meanwhile, how long a search takes during and after, and what
// the library's filter takes. It sits outside the ordinary suite's specs/ glob:
// its result is numbers for a person to read, written to text-index.json in the
// end-to-end output, and it takes minutes. test/e2e/specs/scale.e2e.ts holds the
// budget that the suite enforces.
//
// "Cold" has the files out of the system's cache, by `dd`'s `nocache`, as a
// user's first start after booting would find them. "Warm" is the same again
// straight after. Docker on Windows has a disk cache of its own behind this one,
// which no test reaches.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { writeText } from "../../../src/format/text.ts";
import { loadModules } from "../support/browser.ts";
import { outputDirectory } from "../support/harness.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);
const fixture = path.join(root, "test/fixtures/format/v1-strokes.ink.png");
const sizes = [100, 1000, 10_000];

/** Writes `count` symbols into the vault's `Bench` folder, by Node.js. */
async function seed(count: number): Promise<void> {
  const folder = path.join(obsidianPage.getVaultPath(), "Bench");
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const plain = new Uint8Array(readFileSync(fixture));
  for (let index = 0; index < count; index++) {
    const name = String(index).padStart(5, "0");
    const read = await writeText(plain, "reading", [`TA${name}`, `DA${name}`]);
    const bytes = await writeText(read, "translation", [`field ${name}`]);
    await writeFile(path.join(folder, `glyph ${name}.ink.png`), bytes);
  }
}

/** Takes the vault's symbols out of the system's file cache. */
async function dropCache(): Promise<void> {
  const folder = path.join(obsidianPage.getVaultPath(), "Bench");
  for (const file of await readdir(folder)) {
    execFileSync("dd", [
      `of=${path.join(folder, file)}`,
      "oflag=nocache",
      "conv=notrunc,fdatasync",
      "count=0",
      "status=none",
    ]);
  }
}

/** One build of the index, from Inkline being turned on. */
interface Build {
  readonly totalMs: number;
  /** The longest the main thread went without running a timer. */
  readonly longestStallMs: number;
  /** Searches made while it built, and the longest of them. */
  readonly searches: number;
  readonly longestSearchMs: number;
  /** What the page's heap grew by, as Chromium roughly reports it. */
  readonly heapGrowthMb: number;
}

/** Turns Inkline off and on, and times the index reading every symbol. */
async function build(): Promise<Build> {
  return browser.executeObsidian(async ({ app }) => {
    const plugins: unknown = Reflect.get(app, "plugins");
    if (typeof plugins !== "object" || plugins === null) {
      throw new Error("no plugins");
    }
    const disable: unknown = Reflect.get(plugins, "disablePlugin");
    const enable: unknown = Reflect.get(plugins, "enablePlugin");
    if (typeof disable !== "function" || typeof enable !== "function") {
      throw new Error("no plugin controls");
    }
    await (disable.call(plugins, "inkline") as Promise<void>);
    const heap = (): number => {
      const memory: unknown = Reflect.get(performance, "memory");
      const used: unknown =
        typeof memory === "object" && memory !== null
          ? Reflect.get(memory, "usedJSHeapSize")
          : 0;
      return typeof used === "number" ? used : 0;
    };
    const heapBefore = heap();
    let longestStallMs = 0;
    let beat = performance.now();
    let beating = true;
    const heart = (): void => {
      const now = performance.now();
      longestStallMs = Math.max(longestStallMs, now - beat);
      beat = now;
      if (beating) window.setTimeout(heart, 0);
    };
    heart();
    const started = performance.now();
    await (enable.call(plugins, "inkline") as Promise<void>);
    const manager: unknown = Reflect.get(app.workspace, "editorSuggest");
    const suggests: unknown =
      typeof manager === "object" && manager !== null
        ? Reflect.get(manager, "suggests")
        : undefined;
    const registered: readonly unknown[] = Array.isArray(suggests)
      ? suggests
      : [];
    const found = registered.find(
      (suggest) =>
        typeof suggest === "object" &&
        suggest !== null &&
        suggest.constructor.name === "SymbolSuggest",
    );
    const search: unknown =
      typeof found === "object" && found !== null
        ? Reflect.get(found, "getSuggestions")
        : undefined;
    const note = app.vault.getFiles().find((file) => file.extension === "md");
    if (typeof search !== "function" || note === undefined) {
      throw new Error("no list of symbols registered");
    }
    const symbols = app.vault
      .getFiles()
      .filter((file) => file.path.endsWith(".ink.png"));
    const last = symbols.at(-1);
    if (last === undefined) throw new Error("no symbols");
    const wanted = `TA${last.basename.replace(/\D/g, "")}`;
    let searches = 0;
    let longestSearchMs = 0;
    // Searches for the last file the index reads, as a person keeps typing.
    for (;;) {
      const before = performance.now();
      const shown: unknown = search.call(found, {
        query: wanted,
        file: note,
        editor: undefined,
        start: { line: 0, ch: 0 },
        end: { line: 0, ch: wanted.length + 2 },
      });
      longestSearchMs = Math.max(longestSearchMs, performance.now() - before);
      searches++;
      if (Array.isArray(shown) && shown.length > 0) break;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    const totalMs = performance.now() - started;
    beating = false;
    return {
      totalMs,
      longestStallMs,
      searches,
      longestSearchMs,
      heapGrowthMb: (heap() - heapBefore) / 1024 / 1024,
    };
  });
}

/** Each query's fastest of five searches once the index has caught up. */
async function searches(): Promise<Record<string, number>> {
  return browser.executeObsidian(({ app }) => {
    const manager: unknown = Reflect.get(app.workspace, "editorSuggest");
    const suggests: unknown =
      typeof manager === "object" && manager !== null
        ? Reflect.get(manager, "suggests")
        : undefined;
    const registered: readonly unknown[] = Array.isArray(suggests)
      ? suggests
      : [];
    const found = registered.find(
      (suggest) =>
        typeof suggest === "object" &&
        suggest !== null &&
        suggest.constructor.name === "SymbolSuggest",
    );
    const search: unknown =
      typeof found === "object" && found !== null
        ? Reflect.get(found, "getSuggestions")
        : undefined;
    const note = app.vault.getFiles().find((file) => file.extension === "md");
    if (typeof search !== "function" || note === undefined) {
      throw new Error("no list of symbols registered");
    }
    const times: Record<string, number> = {};
    for (const query of [
      "",
      "g",
      "glyph 00042",
      "t",
      "ta",
      "ta00042",
      "zzzz",
    ]) {
      let best = Infinity;
      for (let round = 0; round < 5; round++) {
        const before = performance.now();
        search.call(found, {
          query,
          file: note,
          editor: undefined,
          start: { line: 0, ch: 0 },
          end: { line: 0, ch: query.length + 2 },
        });
        best = Math.min(best, performance.now() - before);
      }
      times[query] = best;
    }
    return times;
  });
}

/** What typing in the library's filter takes, from the key to the list drawn. */
async function library(): Promise<Record<string, number>> {
  await browser.executeObsidianCommand("inkline:show-library");
  await browser.$(".inkline-library-list").waitForExist();
  const times = await browser.execute(async () => {
    const field = document.querySelector<HTMLInputElement>(
      ".inkline-library-search",
    );
    if (field === null) throw new Error("no filter");
    const shown: Record<string, number> = {};
    for (const query of ["glyph 00042", "ta00042", "ta", ""]) {
      const before = performance.now();
      field.value = query;
      field.dispatchEvent(new Event("input"));
      // A frame, so that drawing the rows counts.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      shown[query === "" ? "(all)" : query] = performance.now() - before;
    }
    return shown;
  });
  await browser.executeObsidian(({ app }) => {
    app.workspace.detachLeavesOfType("inkline-library");
  });
  return times;
}

/** What a file made to be costly takes, in the index's reading and without. */
async function costly(): Promise<Record<string, number>> {
  return browser.execute(async () => {
    const { png, text } = window.inklineTest;
    const { bytes } = await window.inklineTest.canvas.saveInk(
      { strokes: [] },
      undefined,
      [],
    );
    const chunks = png.readChunks(bytes);
    const keyword = new TextEncoder().encode("Inkline reading");
    const unusable = new Uint8Array(keyword.length + 2 + 40);
    unusable.set(keyword);
    const crafted = png.writeChunks([
      ...chunks.slice(0, 1),
      ...Array.from({ length: 65_000 }, () => ({
        type: "zTXt",
        data: unusable,
      })),
      ...chunks.slice(1),
    ]);
    // A file as large as a base layer can make one.
    const large = png.writeChunks([
      ...chunks.slice(0, 1),
      { type: "teST", data: new Uint8Array(12 * 1024 * 1024) },
      ...chunks.slice(1),
    ]);
    const timed = async (work: () => unknown): Promise<number> => {
      const before = performance.now();
      await work();
      return performance.now() - before;
    };
    return {
      craftedBytes: crafted.length,
      craftedReadChunksMs: await timed(() => png.readChunks(crafted)),
      craftedIndexMs: await timed(() => text.readFileText(crafted, 16)),
      craftedUncappedMs: await timed(() =>
        text.readText(png.readChunks(crafted)),
      ),
      largeBytes: large.length,
      largeEveryCrcMs: await timed(() => png.readChunks(large)),
      largeIndexMs: await timed(() => text.readFileText(large, 16)),
    };
  });
}

describe("What reading symbols' text costs", function () {
  this.timeout(3_600_000);

  it("measures reading every symbol, cold and warm", async function () {
    const results: Record<string, unknown>[] = [];
    const save = (): Promise<void> =>
      writeFile(
        path.join(outputDir, "text-index.json"),
        JSON.stringify(results, undefined, 2),
      );
    for (const count of sizes) {
      await seed(count);
      // Obsidian starts afresh, and finds the files as it starts.
      await browser.reloadObsidian();
      await browser.executeObsidian(async ({ app }) => {
        await new Promise<void>((resolve) => {
          app.workspace.onLayoutReady(resolve);
        });
      });
      await loadModules();
      await dropCache();
      const cold = await build();
      const warm = await build();
      results.push({
        count,
        cold,
        warm,
        searches: await searches(),
        library: await library(),
      });
      await save();
    }
    results.push({ costly: await costly() });
    await save();
  });
});
