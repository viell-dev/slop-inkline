import { mkdir } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { outputDirectory } from "./harness.ts";

const outputDir = outputDirectory(
  process.env.E2E_OUTPUT_DIR,
  path.resolve(import.meta.dirname, "../../.."),
);

/**
 * Saves a screenshot of the Obsidian window under
 * `screenshots/<app version>-<installer version>/<name>.png` in the output
 * directory. Screenshots are artifacts for review, never assertions.
 */
export async function saveScreenshot(
  name: string,
  element?: ReturnType<typeof browser.$>,
): Promise<void> {
  const run = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
  const directory = path.join(outputDir, "screenshots", run);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${name}.png`);
  if (element === undefined) await browser.saveScreenshot(file);
  else await element.saveScreenshot(file);
}
