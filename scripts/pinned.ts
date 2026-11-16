// Fails unless every line test/fixtures/pinned.sha256 had in a release, from
// 1.0.0 on, is still in it: `node scripts/pinned.ts`, or
// `npm run check:pinned`. It compares the file in the working tree with the
// release tags in this clone, so it needs the tags; a clone without them
// fails, and says how to fetch them. CI runs it on every pull request. It
// imports only Node.js and lib/, so that it runs without the dependencies.
// Everything but the running of Git is in lib/pinned.ts, where tests can
// reach it.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pinnedList, pinnedProblems, pinnedReleases } from "./lib/pinned.ts";

const root = join(import.meta.dirname, "..");

/** Git's output, or an error with its message when Git fails. */
function git(args: readonly string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `git ${args.join(" ")} failed (${String(result.status)})`,
    );
  }
  return result.stdout;
}

try {
  const tags = git(["tag", "--list"]).split("\n").filter(Boolean);
  const problems = pinnedProblems(
    readFileSync(join(root, pinnedList), "utf8"),
    tags,
    (tag) => git(["show", `refs/tags/${tag}:${pinnedList}`]),
  );
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(
    `Every line of ${pinnedList} at ${pinnedReleases(tags).join(", ")} is still in it.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
