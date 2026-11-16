// Holds test/fixtures/pinned.sha256 to the rule AGENTS.md states for it: from
// the first stable release, 1.0.0, the list only grows. Every line it had in
// a release must still be in it, byte for byte; lines may be added and the
// order may change. The release tags are the anchor because the ruleset in
// .github/rulesets/release-tags.json makes them immutable, so no pull request
// can move what it is compared with. test/unit/format/pinned-files.test.ts
// holds the files to the list; this holds the list to the releases. Free of
// Git, so that unit tests can run it on synthetic input; scripts/pinned.ts
// reads the tags. It imports only lib/, so that it runs without the
// dependencies.

import { compareSemver, stableVersionPattern } from "./version.ts";

/** The list, from the repository's root, as Git names it. */
export const pinnedList = "test/fixtures/pinned.sha256";

/** The first release whose list is pinned, which must be there to compare. */
export const firstPinnedRelease = "1.0.0";

/** Fetches the release tags into any clone. */
export const fetchTagsCommand = "git fetch --tags origin";

/**
 * Fetches them into a shallow clone, as CI's checkout is, and keeps it
 * shallow.
 */
export const fetchTagsShallowCommand =
  "git fetch --no-tags --depth=1 origin '+refs/tags/*:refs/tags/*'";

/**
 * The tags whose list is pinned, in version order: each plain `x.y.z` with
 * `x` at least 1, so every release from 1.0.0, pre-releases with an odd minor
 * version among them. The format was not final before 1.0.0, so the earlier
 * tags, and any tag with a suffix, are left out.
 */
export function pinnedReleases(tags: readonly string[]): string[] {
  return tags
    .filter((tag) => stableVersionPattern.test(tag) && !tag.startsWith("0."))
    .sort(compareSemver);
}

/** The lines of a list, without the empty ones. */
function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}

/**
 * The file a line names: what follows the hash and the space and mode
 * character `sha256sum` writes, or the whole line when it is not such a line.
 */
function fileOf(line: string): string {
  return /^\s*[0-9A-Fa-f]+\s+\*?(.*?)\s*$/.exec(line)?.[1] ?? line.trim();
}

/**
 * Every way the current list breaks the rule, one problem to a string, each
 * naming the tag and the file; empty when it keeps it. `read` gives a tag's
 * list, and throws when it cannot. It is asked only for the tags that
 * `pinnedReleases` keeps. Without the tag 1.0.0 among `tags`, or with a tag
 * whose list cannot be read, it fails rather than pass for lack of data.
 */
export function pinnedProblems(
  current: string,
  tags: readonly string[],
  read: (tag: string) => string,
): string[] {
  const releases = pinnedReleases(tags);
  if (!releases.includes(firstPinnedRelease)) {
    return [
      `The tag ${firstPinnedRelease} is not in this clone, so ${pinnedList} has nothing to be compared with. Fetch the release tags with \`${fetchTagsCommand}\`, or in a shallow clone with \`${fetchTagsShallowCommand}\`, and run this again.`,
    ];
  }
  const now = lines(current);
  const kept = new Set(now);
  const problems: string[] = [];
  for (const tag of releases) {
    let released: string;
    try {
      released = read(tag);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      problems.push(`${tag}: cannot read ${pinnedList} there: ${reason}`);
      continue;
    }
    const pinned = lines(released);
    if (pinned.length === 0) {
      problems.push(`${tag}: ${pinnedList} there lists no files`);
    }
    for (const line of pinned) {
      if (kept.has(line)) continue;
      const file = fileOf(line);
      const named = now.filter((other) => fileOf(other) === file);
      problems.push(
        named.length === 0
          ? `${tag}: ${file}: its line ${JSON.stringify(line)} is gone, and no line names the file now`
          : `${tag}: ${file}: its line ${JSON.stringify(line)} now reads ${named.map((other) => JSON.stringify(other)).join(" and ")}`,
      );
    }
  }
  if (problems.length > 0) {
    problems.push(
      `From ${firstPinnedRelease}, ${pinnedList} only grows: a new pinned file adds a line, and no line a release had ever changes or goes, as the Code section of AGENTS.md says. The change that altered or removed these lines, or the files they name, is wrong: fix it, and never change the list, the pinned files, or this check to make it pass.`,
    );
  }
  return problems;
}
