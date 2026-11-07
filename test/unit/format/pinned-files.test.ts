// Holds every data file in test/fixtures to the hash recorded for it in
// test/fixtures/pinned.sha256, so that changing, removing, or adding one fails
// until the list changes too, on purpose. AGENTS.md says what a change to the
// list means: from the first stable release, the list only grows. The
// TypeScript beside these files is left out, as it is code that a new case adds
// to, and what it makes is what these files pin.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const list = "test/fixtures/pinned.sha256";

/** Each line of the list, as `sha256sum --text` writes it. */
const pinned = readFileSync(path.join(root, list), "utf8")
  .split("\n")
  .slice(0, -1)
  .map((line) => {
    const [, hash, file] = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line) ?? [];
    if (hash === undefined || file === undefined) {
      throw new Error(`${list} holds a line that is not a hash and a path`);
    }
    return { hash, file };
  });

/** The files the list must name, as paths from the repository's root. */
function dataFiles(): string[] {
  return readdirSync(path.join(root, "test/fixtures"), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
    .filter((file) => !file.endsWith(".ts") && file !== list);
}

describe("the pinned files", () => {
  it("are on the list, each once, and nothing else is", () => {
    expect(
      pinned.map(({ file }) => file).sort(),
      `read about ${list} in AGENTS.md before changing it`,
    ).toEqual(dataFiles().sort());
  });

  for (const { hash, file } of pinned) {
    it(`hold ${file} to its hash`, () => {
      const bytes = readFileSync(path.join(root, file));
      expect(
        createHash("sha256").update(bytes).digest("hex"),
        `read about ${list} in AGENTS.md before changing this file`,
      ).toBe(hash);
    });
  }
});
