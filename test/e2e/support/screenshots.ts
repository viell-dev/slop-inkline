import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { outputDirectory } from "./harness.ts";

const outputDir = outputDirectory(
  process.env.E2E_OUTPUT_DIR,
  path.resolve(import.meta.dirname, "../../.."),
);

/** Where this run's screenshots go, made if it is not there yet. */
async function screenshotFile(name: string): Promise<string> {
  const run = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
  const directory = path.join(outputDir, "screenshots", run);
  await mkdir(directory, { recursive: true });
  return path.join(directory, `${name}.png`);
}

/**
 * Saves a screenshot of the Obsidian window under
 * `screenshots/<app version>-<installer version>/<name>.png` in the output
 * directory. The screenshots this saves are artifacts for review, never
 * assertions.
 */
export async function saveScreenshot(
  name: string,
  element?: ReturnType<typeof browser.$>,
): Promise<void> {
  const file = await screenshotFile(name);
  if (element === undefined) await browser.saveScreenshot(file);
  else await element.saveScreenshot(file);
}

/** A part of the window, in CSS pixels from its top left corner. */
export interface Clip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Saves the part of the window in `clip`, drawn at `scale` times its size so
 * that it stays sharp on a screen of high density, where
 * {@link saveScreenshot} would save it. For a picture of a part smaller than
 * any one element, such as the guide's of the library's rows.
 */
export async function saveClip(
  name: string,
  clip: Clip,
  scale = 2,
): Promise<void> {
  const shot: unknown = await browser.sendCommandAndGetResult(
    "Page.captureScreenshot",
    {
      format: "png",
      clip: { ...clip, scale },
    },
  );
  const data =
    typeof shot === "object" && shot !== null && "data" in shot
      ? shot.data
      : undefined;
  if (typeof data !== "string") throw new Error("no screenshot data");
  await writeFile(await screenshotFile(name), Buffer.from(data, "base64"));
}
