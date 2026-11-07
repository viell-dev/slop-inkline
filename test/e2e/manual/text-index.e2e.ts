// Measures what reading symbols' readings and translations costs in real
// Obsidian, for 100, 1,000 and 10,000 symbols, cold and warm, as issue 189 asks.
// It sits outside the ordinary suite's specs/ glob: its result is numbers for a
// person to read, written to text-index.json in the end-to-end output, and it
// takes minutes. test/e2e/specs/symbol-text.e2e.ts holds what the suite checks.
//
// "Cold" is Obsidian started afresh with the files out of the system's cache,
// by `dd`'s `nocache`, as a user's first search after booting would find them.
// "Warm" is the same pass straight after, with the files in that cache. Docker
// on Windows has a disk cache of its own behind this one, which no test reaches.

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

interface Pass {
  readonly files: number;
  readonly withText: number;
  readonly totalMs: number;
  readonly readMs: number;
  readonly parseMs: number;
  /** The longest the main thread went without running a timer. */
  readonly longestStallMs: number;
}

/** One pass over the vault's symbols, `concurrency` files at a time. */
async function pass(concurrency: number): Promise<Pass> {
  return browser.executeObsidian(async ({ app }, width) => {
    const files = app.vault
      .getFiles()
      .filter((file) => file.path.endsWith(".ink.png"));
    const { readChunks } = window.inklineTest.png;
    const { readText } = window.inklineTest.text;
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
    let next = 0;
    let readMs = 0;
    let parseMs = 0;
    let withText = 0;
    const started = performance.now();
    const worker = async (): Promise<void> => {
      for (;;) {
        const file = files[next++];
        if (file === undefined) return;
        const reading = performance.now();
        const bytes = new Uint8Array(await app.vault.readBinary(file));
        const parsing = performance.now();
        readMs += parsing - reading;
        const text = await readText(readChunks(bytes));
        parseMs += performance.now() - parsing;
        if (text.reading.length > 0) withText++;
      }
    };
    await Promise.all(Array.from({ length: width }, worker));
    const totalMs = performance.now() - started;
    beating = false;
    return {
      files: files.length,
      withText,
      totalMs,
      readMs,
      parseMs,
      longestStallMs,
    };
  }, concurrency);
}

describe("What reading symbols' text costs", function () {
  this.timeout(3_600_000);

  it("measures reading every symbol, cold and warm", async function () {
    const results: unknown[] = [];
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
      const coldOne = await pass(1);
      const warmOne = await pass(1);
      const warmEight = await pass(8);
      await dropCache();
      const coldEight = await pass(8);
      results.push({ count, coldOne, warmOne, coldEight, warmEight });
      await writeFile(
        path.join(outputDir, "text-index.json"),
        JSON.stringify(results, undefined, 2),
      );
    }
  });
});
