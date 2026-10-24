import { unzipSync, zipSync, type Zippable } from "fflate";

export const pluginFiles = ["main.js", "manifest.json", "styles.css"] as const;

function sameNames(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const sortedExpected = [...expected].sort();
  return (
    actual.length === expected.length &&
    [...actual].sort().every((name, index) => name === sortedExpected[index])
  );
}

/** The ZIP extracts directly into a vault's plugins directory. */
export function createInstallZip(
  files: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
  if (!sameNames(Object.keys(files), pluginFiles)) {
    throw new Error("The install ZIP needs exactly the three plugin files");
  }
  const entries: Zippable = {};
  for (const name of pluginFiles) {
    const bytes = files[name];
    if (bytes === undefined) throw new Error(`Missing ${name}`);
    // Local midnight gives the same DOS timestamp in every build timezone.
    entries[`inkline/${name}`] = [bytes, { mtime: new Date(1980, 0, 1) }];
  }
  return zipSync(entries, { level: 9 });
}

/** Reject an incorrect layout, extra payload, or any changed plugin byte. */
export function verifyInstallZip(
  bytes: Uint8Array,
  files: Readonly<Record<string, Uint8Array>>,
): void {
  const entries = unzipSync(bytes);
  if (
    !sameNames(
      Object.keys(entries),
      pluginFiles.map((name) => `inkline/${name}`),
    )
  ) {
    throw new Error(
      "The install ZIP must contain only inkline's three plugin files",
    );
  }
  for (const name of pluginFiles) {
    const expected = files[name];
    const actual = entries[`inkline/${name}`];
    if (
      expected === undefined ||
      actual?.length !== expected.length ||
      actual.some((byte, index) => byte !== expected[index])
    ) {
      throw new Error(`The install ZIP changed ${name}`);
    }
  }
}
