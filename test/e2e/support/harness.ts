// The end-to-end harness's settings and output, kept free of WebdriverIO so
// that unit tests can check them.

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Reads an environment variable, treating an empty value as unset. */
export function setting(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
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

/** The file that marks a directory as the harness's own output. */
export const ownerMarker = ".inkline-e2e-output";

/** The entries the harness creates in its output directory. */
export const outputEntries = ["logs", "screenshots"] as const;

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
    "Output of Inkline's end-to-end tests. Each run replaces logs/ and screenshots/.\n",
  );
  await Promise.all(
    outputEntries.map((entry) =>
      rm(path.join(directory, entry), { recursive: true, force: true }),
    ),
  );
}
