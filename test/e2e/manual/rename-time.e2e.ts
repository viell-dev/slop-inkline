// Measures how a rename goes in real Obsidian, by how many notes link to the
// symbol: how long it takes, and how often the vault reports something while it
// does, which is how `watchRename` in src/notes/file-writes.ts tells a rename that
// stopped from a slow one. It sits outside the ordinary suite's specs/ glob: its
// result is numbers for a person to read, written to rename-time-<version>.json in
// the end-to-end output, and it takes minutes. Every note and symbol is synthetic.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { createSymbol, startOver } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);

/** How many notes link to the symbol, for each measurement. */
const noteCounts = [10, 100, 1000, 3000];

/** How many notes to make in one call to the page. */
const batch = 500;

/** The names to rename it through, so that each is a rename of its own. */
const names = ["gate", "lintel", "arch", "gate"];

/** How long the index can take to read thousands of notes. */
const indexed = 300_000;

/** Waits for the index to say that `count` notes link to `symbol`. */
async function waitForLinks(count: number, symbol: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(
        ({ app }, notes, file) =>
          Object.values(app.metadataCache.resolvedLinks).filter(
            (links) => (links[file] ?? 0) > 0,
          ).length === notes,
        count,
        symbol,
      ),
    {
      timeout: indexed,
      timeoutMsg: `${symbol} has not ${String(count)} notes`,
    },
  );
}

describe("How a rename goes", function () {
  this.timeout(600_000);
  const results: Record<string, unknown[]> = {};

  before(async function () {
    await loadModules();
  });

  after(async function () {
    await startOver();
    await writeFile(
      path.join(outputDir, `rename-time-${browser.getObsidianVersion()}.json`),
      JSON.stringify(results, null, 2),
    );
  });

  for (const notes of noteCounts) {
    it(`renames a symbol that ${String(notes)} notes link to`, async function () {
      await startOver();
      await createSymbol("gate.ink.png");
      await browser.executeObsidian(async ({ app }) => {
        const setConfig: unknown = Reflect.get(app.vault, "setConfig");
        if (typeof setConfig !== "function") throw new Error("no setConfig");
        Reflect.apply(setConfig, app.vault, ["alwaysUpdateLinks", true]);
        await app.vault.createFolder("Many");
      });
      // A batch at a time, as a call that outlasts the driver's limit is sent
      // again, on a busy machine, and fails on the notes it had made.
      for (let first = 0; first < notes; first += batch) {
        await browser.executeObsidian(
          async ({ app }, from, to) => {
            for (let at = from; at < to; at++) {
              await app.vault.create(
                `Many/Note ${String(at)}.md`,
                "Read ![[gate.ink.png]] here.\n",
              );
            }
          },
          first,
          Math.min(first + batch, notes),
        );
      }
      await waitForLinks(notes, "gate.ink.png");
      const runs: unknown[] = [];
      for (let at = 1; at < names.length; at++) {
        const from = `${names[at - 1] ?? ""}.ink.png`;
        const to = `${names[at] ?? ""}.ink.png`;
        runs.push(
          await browser.executeObsidian(
            async ({ app }, source, target) => {
              const file = app.vault.getFileByPath(source);
              if (file === null) throw new Error(`no ${source}`);
              const start = performance.now();
              const modified: number[] = [];
              const renamed: number[] = [];
              const reports = [
                app.vault.on("modify", () =>
                  modified.push(performance.now() - start),
                ),
                app.vault.on("rename", () =>
                  renamed.push(performance.now() - start),
                ),
              ];
              await app.fileManager.renameFile(file, target);
              const total = performance.now() - start;
              for (const report of reports) app.vault.offref(report);
              const times = [...renamed, ...modified].sort((a, b) => a - b);
              const gaps = times.map(
                (time, index) => time - (times[index - 1] ?? 0),
              );
              return {
                totalMs: Math.round(total),
                modified: modified.length,
                renamedAtMs: renamed.map(Math.round),
                largestGapMs: Math.round(Math.max(0, ...gaps)),
              };
            },
            from,
            to,
          ),
        );
        await waitForLinks(notes, to);
      }
      results[String(notes)] = runs;
    });
  }
});
