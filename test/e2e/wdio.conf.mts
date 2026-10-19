// End-to-end tests in real Obsidian, through WebdriverIO and
// wdio-obsidian-service. Build the plugin first; the suite loads dist/.
//
// OBSIDIAN_VERSIONS lists "appVersion/installerVersion" pairs. The default
// tests the manifest's minAppVersion on the oldest installer that can run it,
// which is the oldest Electron a user can have, and the latest public release.
// Beta builds need an Obsidian Insider account, which the project does not use.

import path from "node:path";
import { parseObsidianVersions } from "wdio-obsidian-service";
import { cleanOutput, outputDirectory, setting } from "./support/harness.ts";

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
}

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: [path.join(import.meta.dirname, "specs/**/*.e2e.ts")],
  maxInstances: Number(setting(process.env.WDIO_MAX_INSTANCES) ?? 2),
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
  async onPrepare() {
    await cleanOutput(outputDir);
  },
};
