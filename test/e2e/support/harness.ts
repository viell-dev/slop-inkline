// The end-to-end harness's settings and output, kept free of WebdriverIO so
// that unit tests can check them. It imports only Node.js's own modules, so
// that support/shards.ts, and through it test/e2e/shards.ts, run in CI
// without installing the dependencies.

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Reads an environment variable, treating an empty value as unset. */
export function setting(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/**
 * The displays that test/e2e/session.sh started, one for each Obsidian
 * version, from `INKLINE_E2E_DISPLAYS`, or none when it started none, as on
 * a desktop with a display of its own. Throws when `versions` Obsidian
 * versions are more than the displays, since two versions on one display
 * resize each other's windows.
 */
export function sessionDisplays(
  value: string | undefined,
  versions: number,
): string[] {
  const displays = (setting(value) ?? "")
    .split(" ")
    .filter((display) => display !== "");
  if (displays.length > 0 && versions > displays.length) {
    throw new Error(
      `the end-to-end session has ${String(displays.length)} displays, one for each Obsidian version, but OBSIDIAN_VERSIONS lists ${String(versions)} versions`,
    );
  }
  return displays;
}

/**
 * The Obsidian version a WebdriverIO worker runs, as an index into the
 * capabilities, which the first number of its id counts from 0: `"1-3"` runs
 * the second version.
 */
export function workerVersion(worker: string): number | undefined {
  const match = /^(\d+)-/.exec(worker);
  return match === null ? undefined : Number(match[1]);
}

/** The display for a WebdriverIO worker, by its {@link workerVersion}. */
export function workerDisplay(
  worker: string,
  displays: readonly string[],
): string | undefined {
  const version = workerVersion(worker);
  return version === undefined ? undefined : displays[version];
}

/**
 * The Obsidian versions the suite runs on when `OBSIDIAN_VERSIONS` is unset,
 * as `appVersion/installerVersion` pairs: the manifest's minAppVersion on the
 * oldest installer that can run it, which is the oldest Electron a user can
 * have, and the latest public release. The coverage check expects these too.
 */
export const defaultObsidianVersions = [
  "earliest/earliest",
  "latest/latest",
] as const;

/**
 * The Obsidian versions requested by `OBSIDIAN_VERSIONS`, a space-separated
 * list of `appVersion/installerVersion` pairs, or
 * {@link defaultObsidianVersions} when it is unset or blank. These, not the
 * versions they resolve to, name a run's versions in {@link durationsFile},
 * so that `latest` stays the same version wherever it resolves.
 */
export function requestedVersions(value: string | undefined): string[] {
  const text = setting(value);
  const versions =
    text === undefined
      ? [...defaultObsidianVersions]
      : text.split(/[\s,]+/).filter((version) => version !== "");
  // A record keeps one worker for each request, so a repeated one would
  // overwrite the other's.
  const repeated = versions.find(
    (version, index) => versions.indexOf(version) !== index,
  );
  if (repeated !== undefined) {
    throw new Error(
      `OBSIDIAN_VERSIONS names ${repeated} twice; name each version once`,
    );
  }
  return versions;
}

/**
 * Resolves the output directory from `E2E_OUTPUT_DIR`, or `test-results/e2e`
 * under `root` when it is unset or empty.
 */
export function outputDirectory(
  value: string | undefined,
  root: string,
): string {
  const directory = setting(value);
  return directory === undefined
    ? path.join(root, "test-results", "e2e")
    : path.resolve(directory);
}

/**
 * The directory of the plugin's files to install, from `E2E_PLUGIN_DIR`, or
 * the build's `dist` under `root` when it is unset or empty. The Release
 * workflow names the release's own files.
 */
export function pluginDirectory(
  value: string | undefined,
  root: string,
): string {
  const directory = setting(value);
  return directory === undefined
    ? path.join(root, "dist")
    : path.resolve(root, directory);
}

/** The file that marks a directory as the harness's own output. */
export const ownerMarker = ".inkline-e2e-output";

/**
 * The file in the output directory that records how long each spec file took
 * on each Obsidian version, as {@link Durations}.
 */
export const durationsFile = "durations.json";

/** The entries the harness creates in its output directory. */
export const outputEntries = [
  "logs",
  "screenshots",
  "pdfs",
  durationsFile,
] as const;

/**
 * Prepares the output directory for a run and removes the previous run's
 * output. The harness claims a directory that is new or empty by writing
 * {@link ownerMarker} into it, and refuses one that holds anything else
 * without the marker, so that a wrong `E2E_OUTPUT_DIR` deletes nothing. The
 * directory itself stays, since Docker mounts it.
 */
export async function prepareOutput(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory);
  if (entries.length > 0 && !entries.includes(ownerMarker)) {
    throw new Error(
      `${directory} is not empty and is not Inkline's end-to-end output; ` +
        "set E2E_OUTPUT_DIR to a new or empty directory.",
    );
  }
  await writeFile(
    path.join(directory, ownerMarker),
    `Output of Inkline's end-to-end tests. Each run replaces logs/, screenshots/, pdfs/, and ${durationsFile}.\n`,
  );
  await Promise.all(
    outputEntries.map((entry) =>
      rm(path.join(directory, entry), { recursive: true, force: true }),
    ),
  );
}
