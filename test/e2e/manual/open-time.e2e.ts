// Measures what opening a large symbol costs in real Obsidian: each step of
// reading one alone, and the whole of opening the editor on it, with what the
// main thread goes through meanwhile and a CPU profile of where it went. It sits
// outside the ordinary suite's specs/ glob: its result is numbers for a person to
// read, written to open-time-<version>.json in the end-to-end output, and it
// takes minutes. Every symbol is synthetic: the largest is a picture of noise,
// which PNG cannot compress, of nearly the 8 MiB a base layer can hold.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import type { TFile } from "obsidian";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  draw,
  editFile,
  startOver,
  timedEditorOpen,
  timedEditorSave,
  writeNoise,
} from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);

/** The symbols to open, and the picture each one starts from. */
const symbols = [
  { file: "Ordinary.ink.png", side: 0, spacing: 1 },
  { file: "Picture 1024.ink.png", side: 1024, spacing: 1 },
  { file: "Picture 2300.ink.png", side: 2300, spacing: 1 },
  { file: "Bytes.ink.png", side: 2470, spacing: 1 },
  { file: "Pixels.ink.png", side: 4096, spacing: 4099 },
] as const;

/** How many times to open each. */
const runs = 5;

/** Other symbols in the vault, for the index to go through. */
const others = 2000;

/** A file's size, in bytes. */
async function sizeOf(file: string): Promise<number> {
  return browser.executeObsidian(({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    return found.stat.size;
  }, file);
}

/** Each step of reading `file`, alone and in a task of its own, in ms. */
async function steps(file: string) {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const { canvas, drafts, inkFile, png, record, text } = window.inklineTest;
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const times: Record<string, number> = {};
    const timed = async <T>(
      name: string,
      work: () => T | Promise<T>,
    ): Promise<T> => {
      await canvas.nextTask();
      const start = performance.now();
      const result = await work();
      times[name] = performance.now() - start;
      return result;
    };
    const bytes = new Uint8Array(
      await timed("readBinary", () => app.vault.readBinary(found)),
    );
    await timed("fingerprintOf", () => drafts.fingerprintOf(bytes));
    const chunks = await timed("readChunks", () => png.readChunks(bytes));
    await timed("readChunks without CRCs", () =>
      png.readChunks(bytes, () => false),
    );
    await timed("readText", () => text.readText(chunks));
    const chunk = chunks.find(({ type }) => type === inkFile.recordChunkType);
    if (chunk === undefined) return times;
    const inflated = await timed("inflate the record", () =>
      png.inflate(chunk.data.subarray(4), { limit: record.limits.text }),
    );
    const decoded = await timed("TextDecoder", () =>
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        inflated,
      ),
    );
    const parsed = await timed("parseRecord", () =>
      record.parseRecord(decoded),
    );
    if (!parsed.ok) throw new Error(parsed.detail);
    const json = await timed(
      "JSON.parse",
      () => JSON.parse(decoded) as unknown,
    );
    const base = parsed.record.base;
    if (base === undefined) return times;
    const encoded = (json as { base: { png: string } }).base.png;
    await timed("base64 pattern", () => /^[A-Za-z0-9+/]*={0,2}$/.test(encoded));
    await timed("surrogate pattern", () => /[\uD800-\uDFFF]/u.test(encoded));
    const binary = await timed("atob", () => atob(encoded));
    await timed("Uint8Array.from", () =>
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
    await timed("basePngProblem", () => record.basePngProblem(base.png));
    await timed("baseImageProblem", () => record.baseImageProblem(base.png));
    const bitmap = await timed("decodePng", () =>
      canvas.decodePng(base.png, record.limits.baseSize),
    );
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("no context");
    await timed("drawImage", () => {
      context.drawImage(bitmap, 0, 0);
    });
    await timed("tint", () => {
      context.globalCompositeOperation = "source-in";
      context.fillStyle = "#000";
      context.fillRect(0, 0, surface.width, surface.height);
    });
    bitmap.close();
    return times;
  }, file);
}

/** `openInk` alone, and what the main thread goes through meanwhile. */
async function timedRead(file: string) {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const { canvas, mainThread } = window.inklineTest;
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    const thread = mainThread.watchMainThread();
    const start = performance.now();
    const opened = await canvas.openInk(bytes);
    const totalMs = performance.now() - start;
    if (opened.kind !== "editable") throw new Error(opened.kind);
    // A task still running is not reported as long yet.
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    return { totalMs, thread: thread() };
  }, file);
}

/** Opens the editor as a person does, until it has painted, and closes it. */
async function openAndClose(file: string) {
  const opened = await timedEditorOpen(file);
  await closeEditor();
  return opened;
}

async function closeEditor(): Promise<void> {
  await browser.keys(["Escape"]);
  await browser.waitUntil(async () =>
    browser.execute(() => document.querySelector(".inkline-editor") === null),
  );
}

/**
 * Fills the vault with `count` small symbols, for the index to read, by Node.js,
 * as creating them through the vault takes minutes. Obsidian starts afresh, and
 * finds the files as it starts.
 */
async function addSymbols(count: number): Promise<void> {
  const folder = path.join(obsidianPage.getVaultPath(), "Many");
  await mkdir(folder, { recursive: true });
  const bytes = await readFile(
    path.join(root, "test/fixtures/format/v1-strokes.ink.png"),
  );
  for (let index = 0; index < count; index++) {
    await writeFile(path.join(folder, `${String(index)}.ink.png`), bytes);
  }
  await browser.reloadObsidian();
  await browser.executeObsidian(async ({ app }) => {
    await new Promise<void>((resolve) => {
      app.workspace.onLayoutReady(resolve);
    });
  });
  await loadModules();
  await browser.setTimeout({ script: 300_000 });
}

/**
 * Starts Inkline again, so that its index reads the vault from nothing, and
 * reports how long that took, what the main thread went through meanwhile, and,
 * with a `file` to open at the same moment, how long the editor took to come up.
 */
async function timedSweep(file = "") {
  const swept = await browser.executeObsidian(async ({ app }, wanted) => {
    const { mainThread } = window.inklineTest;
    const manager = Reflect.get(app, "plugins") as {
      plugins: Record<string, { editSymbol(file: TFile): Promise<void> }>;
      disablePlugin(id: string): Promise<void>;
      enablePlugin(id: string): Promise<void>;
    };
    const { vault } = app;
    await manager.disablePlugin("inkline");
    const symbols = vault
      .getFiles()
      .filter(({ path }) => path.endsWith(".ink.png"));
    const opening = wanted === "" ? undefined : vault.getFileByPath(wanted);
    // The editor reads its file too, and again as it opens.
    const expected = symbols.length + (opening === undefined ? 0 : 2);
    let reads = 0;
    const read = vault.readBinary.bind(vault);
    vault.readBinary = async (each) => {
      const bytes = await read(each);
      reads++;
      return bytes;
    };
    const thread = mainThread.watchMainThread();
    const start = performance.now();
    await manager.enablePlugin("inkline");
    const inkline = manager.plugins.inkline;
    if (inkline === undefined) throw new Error("no plugin");
    if (opening !== undefined && opening !== null) {
      void inkline.editSymbol(opening);
    }
    let shownMs: number | undefined;
    while (
      reads < expected ||
      (opening !== undefined && shownMs === undefined)
    ) {
      if (shownMs === undefined && document.querySelector(".inkline-editor")) {
        shownMs = performance.now() - start;
      }
      if (performance.now() - start > 120_000) throw new Error("no end to it");
      await new Promise((resolve) => window.setTimeout(resolve, 2));
    }
    const sweptMs = performance.now() - start;
    Reflect.deleteProperty(vault, "readBinary");
    return { symbols: symbols.length, sweptMs, shownMs, thread: thread() };
  }, file);
  if (file !== "") await closeEditor();
  return swept;
}

interface ProfileNode {
  readonly id: number;
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
  };
}

interface Profile {
  readonly nodes: readonly ProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

/** A function's name and where it is, as a profile has it. */
function nameOf({ functionName, url, lineNumber }: ProfileNode["callFrame"]) {
  const name = functionName === "" ? "(anonymous)" : functionName;
  return `${name} ${url.split("/").at(-1) ?? ""}:${String(lineNumber)}`;
}

/** The most time in `samples`, by function, as `name=ms`. */
function totals(
  samples: readonly { name: string; ms: number }[],
  most: number,
) {
  const byName = new Map<string, number>();
  for (const { name, ms } of samples) {
    byName.set(name, (byName.get(name) ?? 0) + ms);
  }
  return [...byName]
    .sort(([, a], [, b]) => b - a)
    .slice(0, most)
    .map(([name, ms]) => ({ name, ms: Math.round(ms * 10) / 10 }));
}

/**
 * Where the main thread's time went while `work` ran, by function, and in each
 * long task it reports, which is what says where a task is that is still long.
 */
async function profiled(
  work: () => Promise<{
    thread: { longTaskTimes: readonly { startMs: number; ms: number }[] };
  }>,
) {
  await browser.sendCommandAndGetResult("Profiler.enable", {});
  await browser.sendCommandAndGetResult("Profiler.setSamplingInterval", {
    interval: 500,
  });
  await browser.sendCommandAndGetResult("Profiler.start", {});
  const started = await browser.execute(() => performance.now());
  const { thread } = await work();
  const { profile } = (await browser.sendCommandAndGetResult(
    "Profiler.stop",
    {},
  )) as { profile: Profile };
  const names = new Map(
    profile.nodes.map(({ id, callFrame }) => [id, nameOf(callFrame)]),
  );
  let at = 0;
  const samples = profile.samples.map((sample, index) => {
    const ms = (profile.timeDeltas[index] ?? 0) / 1000;
    at += ms;
    return { name: names.get(sample) ?? String(sample), ms, at };
  });
  return {
    whole: totals(samples, 40),
    longTasks: thread.longTaskTimes
      .filter(({ ms }) => ms >= 60)
      .map(({ startMs, ms }) => ({
        afterMs: Math.round(startMs - started),
        ms: Math.round(ms),
        spent: totals(
          samples.filter(
            (sample) =>
              sample.at >= startMs - started &&
              sample.at <= startMs - started + ms,
          ),
          6,
        ),
      })),
  };
}

describe("What opening a large symbol costs", function () {
  this.timeout(3_600_000);

  before(async function () {
    await loadModules();
    await browser.setTimeout({ script: 300_000 });
    await startOver();
  });

  after(async function () {
    await startOver();
  });

  it("measures reads, and whole opens of the editor", async function () {
    const version = browser.getObsidianVersion();
    const results: Record<string, unknown> = { obsidian: version };
    const save = (): Promise<void> =>
      writeFile(
        path.join(outputDir, `open-time-${version}.json`),
        JSON.stringify(results, undefined, 2),
      );
    for (const { file, side, spacing } of symbols) {
      if (side === 0) await createSymbol(file);
      else await writeNoise(file, side, spacing);
      await editFile(file);
      await draw([
        [0.3, 0.3],
        [0.7, 0.35],
      ]);
      await timedEditorSave();
      const reads = [];
      for (let run = 0; run < runs; run++) reads.push(await timedRead(file));
      const editor = [];
      for (let run = 0; run < runs; run++) {
        editor.push(await openAndClose(file));
      }
      results[file] = {
        bytes: await sizeOf(file),
        steps: await steps(file),
        reads,
        editor,
        profile: await profiled(() => openAndClose(file)),
      };
      await save();
    }
    // Opening while the index goes through the vault, as just after a start.
    await addSymbols(others);
    results.index = {
      alone: await timedSweep(),
      opening: await timedSweep("Bytes.ink.png"),
      again: await timedSweep("Bytes.ink.png"),
      pixels: await timedSweep("Pixels.ink.png"),
    };
    await save();
    // A picture with no record, which opens as a base layer of its pixels.
    for (const { file, side, spacing } of [
      { file: "Noise.ink.png", side: 2470, spacing: 1 },
      { file: "Sparse.ink.png", side: 4096, spacing: 4099 },
    ]) {
      await writeNoise(file, side, spacing);
      const reads = [];
      for (let run = 0; run < 3; run++) reads.push(await timedRead(file));
      const editor = [];
      for (let run = 0; run < 3; run++) {
        editor.push(await openAndClose(file));
      }
      results[file] = {
        bytes: await sizeOf(file),
        reads,
        editor,
        profile: await profiled(() => openAndClose(file)),
      };
      await save();
    }
  });
});
