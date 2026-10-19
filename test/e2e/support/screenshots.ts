import { mkdir } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";

const outputDir = path.resolve(
  process.env.E2E_OUTPUT_DIR ?? "test-results/e2e",
);

/**
 * Saves a screenshot of the Obsidian window under
 * `screenshots/<app version>-<installer version>/<name>.png` in the output
 * directory. Screenshots are artifacts for review, never assertions.
 */
export async function saveScreenshot(name: string): Promise<void> {
  const run = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
  const directory = path.join(outputDir, "screenshots", run);
  await mkdir(directory, { recursive: true });
  await browser.saveScreenshot(path.join(directory, `${name}.png`));
}
