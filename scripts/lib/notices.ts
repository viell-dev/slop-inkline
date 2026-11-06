// The licence notices of the code bundled into main.js, which the licences of
// those packages require in copies of it.

import { readFile } from "node:fs/promises";
import path from "node:path";

/** The names a package's licence file may have. */
const licenceFiles = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"];

/**
 * Code copied into the plugin's source, with its licence file there: the
 * outline's algorithm, which the file format fixes for good.
 */
export const copiedCode: readonly CopiedCode[] = [
  { name: "perfect-freehand", licence: "src/ink/freehand.LICENSE.txt" },
];

/** Code in the source that came from elsewhere, and where its licence is. */
export interface CopiedCode {
  readonly name: string;
  /** The licence file, from the repository's root. */
  readonly licence: string;
}

/** The text of a package's licence file, which a build can't do without. */
async function licenceText(root: string, name: string): Promise<string> {
  for (const file of licenceFiles) {
    try {
      return (
        await readFile(path.join(root, "node_modules", name, file), "utf8")
      ).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`${name} is bundled, but has no licence file`);
}

/**
 * The comment that opens main.js: where it was built from, then the licence
 * text of each of `dependencies`, the packages bundled into it, and of the
 * `copied` code in its source. A comment can hold no end of comment, which no
 * licence text has any reason to.
 */
export async function bundleBanner(
  root: string,
  dependencies: readonly string[],
  copied: readonly CopiedCode[] = [],
): Promise<string> {
  const licences = [
    ...dependencies.map((name) => ({
      name,
      read: () => licenceText(root, name),
    })),
    ...copied.map(({ name, licence }) => ({
      name,
      read: async () =>
        (await readFile(path.join(root, licence), "utf8")).trim(),
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const notices = await Promise.all(
    licences.map(async ({ name, read }) => {
      const text = await read();
      if (text.includes("*/"))
        throw new Error(`${name}'s licence ends a comment`);
      return `\n\nIncludes ${name}:\n\n${text}`;
    }),
  );
  return `/* Inkline, built from https://github.com/viell-dev/slop-inkline.${notices.join("")}\n*/`;
}
