// The licence notices of the code bundled into main.js, which the licences of
// those packages require in copies of it.

import { readFile } from "node:fs/promises";
import path from "node:path";

/** The names a package's licence file may have. */
const licenceFiles = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"];

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
 * text of each of `dependencies`, the packages bundled into it. A comment can
 * hold no end of comment, which no licence text has any reason to.
 */
export async function bundleBanner(
  root: string,
  dependencies: readonly string[],
): Promise<string> {
  const notices = await Promise.all(
    [...dependencies].sort().map(async (name) => {
      const text = await licenceText(root, name);
      if (text.includes("*/"))
        throw new Error(`${name}'s licence ends a comment`);
      return `\n\nIncludes ${name}:\n\n${text}`;
    }),
  );
  return `/* Inkline, built from https://github.com/viell-dev/slop-inkline.${notices.join("")}\n*/`;
}
