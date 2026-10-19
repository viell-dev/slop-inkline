// End-to-end tests in real Obsidian, through WebdriverIO and
// wdio-obsidian-service. Build the plugin first; the suite loads dist/.
//
// OBSIDIAN_VERSIONS lists "appVersion/installerVersion" pairs. The default
// tests the manifest's minAppVersion on the oldest installer that can run it,
// which is the oldest Electron a user can have, and the latest public release.
// Beta builds need an Obsidian Insider account, which the project does not use.

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseObsidianVersions } from "wdio-obsidian-service";

const root = path.resolve(import.meta.dirname, "../..");
const cacheDir = path.resolve(
  process.env.OBSIDIAN_CACHE_DIR ?? path.join(root, ".obsidian-cache"),
);
const outputDir = path.resolve(
  process.env.E2E_OUTPUT_DIR ?? path.join(root, "test-results/e2e"),
);

const versions = await parseObsidianVersions(
  process.env.OBSIDIAN_VERSIONS ?? "earliest/earliest latest/latest",
  { cacheDir },
);
// CI keys its Obsidian download cache on the resolved versions.
if (process.env.CI !== undefined) {
  console.log(`obsidian-cache-key:${JSON.stringify(versions)}`);
}

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: [path.join(import.meta.dirname, "specs/**/*.e2e.ts")],
  maxInstances: Number(process.env.WDIO_MAX_INSTANCES ?? 2),
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
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  logLevel: "warn",
  // Empties the output directory without removing it, since Docker mounts it.
  async onPrepare() {
    const entries = await readdir(outputDir).catch(() => []);
    await Promise.all(
      entries.map((entry) =>
        rm(path.join(outputDir, entry), { recursive: true, force: true }),
      ),
    );
  },
};
