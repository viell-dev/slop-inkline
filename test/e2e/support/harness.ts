// The end-to-end harness's settings and output, kept free of WebdriverIO so
// that unit tests can check them.

import { rm } from "node:fs/promises";
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

/** The only entries the harness creates, and so the only ones it removes. */
export const outputEntries = ["logs", "screenshots"] as const;

/**
 * Removes the previous run's output. The directory itself stays, since Docker
 * mounts it, and so does anything in it that the harness did not create.
 */
export async function cleanOutput(directory: string): Promise<void> {
  await Promise.all(
    outputEntries.map((entry) =>
      rm(path.join(directory, entry), { recursive: true, force: true }),
    ),
  );
}
