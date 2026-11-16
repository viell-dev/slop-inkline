// End-to-end tests in real Obsidian, through WebdriverIO and
// wdio-obsidian-service. Build the plugin first; the suite loads dist/.
//
// OBSIDIAN_VERSIONS lists "appVersion/installerVersion" pairs; the default,
// defaultObsidianVersions in support/harness.ts, tests the manifest's
// minAppVersion on the oldest installer that can run it, which is the oldest
// Electron a user can have, and the latest public release. Beta builds need an
// Obsidian Insider account, which the project does not use.
//
// E2E_SHARD, as "i/n", runs only the i-th of n shards of the spec files, each
// still on every version; CI runs the shards as jobs side by side. The shards
// are balanced by the seconds in weights.json rather than by count, as the
// files' times differ a hundredfold. Unset, every spec file runs. Every run
// writes durations.json to the output directory: each worker's time and exit
// code, by spec file and requested version, and the launcher's exit code.
// test/e2e/shards.ts reads it, in CI to check that each shard, and the shards
// together, ran and passed every spec file on every version, and to refresh
// the weights.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseObsidianVersions } from "wdio-obsidian-service";
import {
  durationsFile,
  outputDirectory,
  pluginDirectory,
  prepareOutput,
  requestedVersions,
  sessionDisplays,
  setting,
  workerDisplay,
  workerVersion,
} from "./support/harness.ts";
import {
  assignShards,
  durationsFormat,
  parseShard,
  readWeights,
  shardSeconds,
  specFiles,
  specName,
  type Durations,
  type WorkerRun,
} from "./support/shards.ts";

const root = path.resolve(import.meta.dirname, "../..");
const specsDir = path.join(import.meta.dirname, "specs");
const cacheDir = path.resolve(
  setting(process.env.OBSIDIAN_CACHE_DIR) ?? path.join(root, ".obsidian-cache"),
);
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);
const launcher = process.env.WDIO_WORKER_ID === undefined;
const printCacheKey =
  setting(process.env.PRINT_OBSIDIAN_CACHE_KEY) !== undefined;

// The shard comes first, so that a wrong E2E_SHARD stops the run before it
// touches the output.
const shard = parseShard(process.env.E2E_SHARD);
// The suite is specFiles(), for a whole run as for a shard, so that the
// shards' checks and the run agree on what it holds. A --spec on the command
// line replaces this list, as the Release workflow's does.
const all = await specFiles(specsDir);
let specs = all.map((spec) => path.join(specsDir, spec));
if (shard !== undefined) {
  const weights = await readWeights(
    path.join(import.meta.dirname, "weights.json"),
  );
  const mine = assignShards(all, weights, shard.total)[shard.index - 1] ?? [];
  if (mine.length === 0) {
    throw new Error(
      `E2E_SHARD ${String(shard.index)}/${String(shard.total)} has no spec files: there are only ${String(all.length)}`,
    );
  }
  if (launcher && !printCacheKey) {
    console.log(
      `Shard ${String(shard.index)} of ${String(shard.total)} runs ${String(mine.length)} of the ${String(all.length)} spec files, about ${String(shardSeconds(mine, weights))} s by weights.json:`,
    );
    for (const spec of mine) console.log(`  ${spec}`);
  }
  specs = mine.map((spec) => path.join(specsDir, spec));
}

// Each requested pair is resolved on its own, so that the capabilities stay
// one for each request, in order, even where two resolve to the same version:
// a worker's version index then names its request.
//
// Known limit: if two requests resolve to the same version, as earliest and
// latest would once the manifest's minAppVersion is the newest release, both
// capabilities run the same spec files at once and share the output paths
// keyed by the resolved version, such as pdfs/<version>/, which pdf.e2e.ts
// reads back, and screenshots/<version>/. That can fail a test, never pass
// one falsely. The library's own resolution ran one capability for them. The
// fix then is to run one capability for requests that resolve alike, and
// record its result under each of those requests.
const requested = requestedVersions(process.env.OBSIDIAN_VERSIONS);
const versions: [string, string][] = [];
for (const request of requested) {
  versions.push(...(await parseObsidianVersions(request, { cacheDir })));
}
if (versions.length !== requested.length) {
  throw new Error(
    `OBSIDIAN_VERSIONS requests ${String(requested.length)} versions, but they resolved to ${String(versions.length)}`,
  );
}
// CI runs this file on its own to key its Obsidian download cache on the
// resolved versions.
if (printCacheKey) {
  console.log(`obsidian-cache-key:${JSON.stringify(versions)}`);
} else if (launcher) {
  // Only the launcher prepares the output, before WebdriverIO writes its log
  // there; its onPrepare hook would run too late, and WebdriverIO only logs a
  // hook's error, while this one stops the run.
  await prepareOutput(outputDir);
}

// test/e2e/session.sh starts a display for each Obsidian version when there
// is none, and refuses more versions than displays; a worker uses the one
// for its version. One worker per version at a time keeps each display to
// one window.
const displays = sessionDisplays(
  process.env.INKLINE_E2E_DISPLAYS,
  versions.length,
);
const worker = process.env.WDIO_WORKER_ID;
const display =
  worker === undefined ? undefined : workerDisplay(worker, displays);
if (display !== undefined) process.env.DISPLAY = display;

// The launcher times each worker, which runs one spec file on one version,
// from start to exit, Obsidian's start included, and keeps its exit code. A
// retried spec file keeps its last attempt, as WebdriverIO's result does;
// the suite sets no retries.
const started = new Map<string, number>();
const durations: Record<string, Record<string, WorkerRun>> = {};

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs,
  maxInstances: Number(setting(process.env.WDIO_MAX_INSTANCES) ?? 2),
  maxInstancesPerCapability: 1,
  capabilities: versions.map(([appVersion, installerVersion]) => ({
    browserName: "obsidian",
    browserVersion: appVersion,
    "wdio:obsidianOptions": {
      installerVersion,
      plugins: [pluginDirectory(process.env.E2E_PLUGIN_DIR, root)],
      vault: path.join(import.meta.dirname, "vaults/basic"),
    },
    "goog:chromeOptions": { args: ["--disable-dev-shm-usage"] },
  })),
  services: ["obsidian"],
  reporters: ["obsidian"],
  cacheDir,
  outputDir: path.join(outputDir, "logs"),
  injectGlobals: false,
  // Generous, so that a slow machine does not fail a test that would pass: a
  // wait ends as soon as its condition holds.
  waitforTimeout: 20_000,
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  onWorkerStart: (cid) => {
    started.set(cid, performance.now());
  },
  onWorkerEnd: (cid, exitCode, workerSpecs) => {
    const start = started.get(cid);
    const index = workerVersion(cid);
    const request = index === undefined ? undefined : requested[index];
    const version = index === undefined ? undefined : versions[index];
    // A worker this cannot place is left out, which the checks report as a
    // spec file that did not run.
    if (start === undefined || request === undefined || version === undefined)
      return;
    const run: WorkerRun = {
      resolved: version.join("/"),
      seconds: Math.round((performance.now() - start) / 100) / 10,
      exitCode,
    };
    for (const spec of workerSpecs) {
      const name = specName(spec, specsDir);
      durations[name] = { ...durations[name], [request]: run };
    }
  },
  onComplete: async (exitCode) => {
    const record: Durations = {
      format: durationsFormat,
      shard:
        shard === undefined
          ? null
          : `${String(shard.index)}/${String(shard.total)}`,
      versions: requested,
      exitCode,
      specs: durations,
    };
    await writeFile(
      path.join(outputDir, durationsFile),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  },
  // A failed test leaves a screenshot of the window as it then was.
  afterTest: async (test, _context, result) => {
    if (result.passed) return;
    const { saveScreenshot } = await import("./support/screenshots.ts");
    const name = test.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 80);
    await saveScreenshot(`failed-${name}`);
  },
  logLevel: "warn",
};
