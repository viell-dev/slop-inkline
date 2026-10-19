// End-to-end tests in real Obsidian, through WebdriverIO and
// wdio-obsidian-service. Build the plugin first; the suite loads dist/.
//
// OBSIDIAN_VERSIONS lists "appVersion/installerVersion" pairs. The default
// tests the manifest's minAppVersion on the oldest installer that can run it,
// which is the oldest Electron a user can have, and the latest public release.
// Beta builds need an Obsidian Insider account, which the project does not use.

import path from "node:path";
import { parseObsidianVersions } from "wdio-obsidian-service";
import {
  outputDirectory,
  prepareOutput,
  sessionDisplays,
  setting,
  workerDisplay,
} from "./support/harness.ts";

const root = path.resolve(import.meta.dirname, "../..");
const cacheDir = path.resolve(
  setting(process.env.OBSIDIAN_CACHE_DIR) ?? path.join(root, ".obsidian-cache"),
);
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);

const versions = await parseObsidianVersions(
  setting(process.env.OBSIDIAN_VERSIONS) ?? "earliest/earliest latest/latest",
  { cacheDir },
);
// CI runs this file on its own to key its Obsidian download cache on the
// resolved versions.
if (setting(process.env.PRINT_OBSIDIAN_CACHE_KEY) !== undefined) {
  console.log(`obsidian-cache-key:${JSON.stringify(versions)}`);
} else if (process.env.WDIO_WORKER_ID === undefined) {
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

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: [path.join(import.meta.dirname, "specs/**/*.e2e.ts")],
  maxInstances: Number(setting(process.env.WDIO_MAX_INSTANCES) ?? 2),
  maxInstancesPerCapability: 1,
  capabilities: versions.map(([appVersion, installerVersion]) => ({
    browserName: "obsidian",
    browserVersion: appVersion,
    "wdio:obsidianOptions": {
      installerVersion,
      plugins: [path.join(root, "dist")],
      vault: path.join(import.meta.dirname, "vaults/basic"),
    },
    "goog:chromeOptions": { args: ["--disable-dev-shm-usage"] },
  })),
  services: ["obsidian"],
  reporters: ["obsidian"],
  cacheDir,
  outputDir: path.join(outputDir, "logs"),
  injectGlobals: false,
  // Chromium 150 can take seconds to encode a PNG when the window has no
  // idle time, which slows saves; see #16.
  waitforTimeout: 20_000,
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  // A failed test leaves a screenshot of the window as it then was.
  afterTest: async (test, _context, result) => {
    if (result.passed) return;
    const { saveScreenshot } = await import("./support/screenshots.ts");
    const name = test.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 80);
    await saveScreenshot(`failed-${name}`);
  },
  logLevel: "warn",
};
