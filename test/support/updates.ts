// What an update from one published release to another must keep, for the
// explicit update checks in test/e2e/manual/, and the rules for the versions
// they are given. Those checks take their versions from whoever runs them, so
// they hold them to these rules before any request; test/unit/docs.test.ts
// holds the versions CONTRIBUTING.md gives them to the same rules.

import {
  compareSemver,
  releaseVersionPattern,
  versionOrderProblems,
} from "../../scripts/lib/version.ts";

/**
 * The first release of the file format, which every later release must read.
 * The owner decided in #144 that nothing an earlier release saved need keep
 * its strokes, nor its drafts.
 */
export const finalFormat = "0.9.2";

/** Part of what the editor's status line says of a file with no strokes. */
export const noStrokes = "as this file holds no strokes";

/**
 * Whether an update from `version` must keep the strokes of its symbols and
 * its drafts. It goes by the version alone, and never by what a file turns
 * out to hold, so that a release that stopped reading them fails the check.
 */
export function keepsStrokesFrom(version: string): boolean {
  return compareSemver(version, finalFormat) >= 0;
}

/**
 * Every reason that the BRAT check cannot take `latest` as the highest
 * published release and `start` as the one to update from, found from the
 * versions alone.
 */
export function bratVersionProblems(
  latest: string | undefined,
  start: string | undefined,
): string[] {
  const problems: string[] = [];
  for (const [name, version, role] of [
    ["E2E_BRAT_LATEST", latest, "the highest published release"],
    ["E2E_BRAT_START", start, "an earlier published release to update from"],
  ] as const) {
    if (version === undefined || version === "") {
      problems.push(`${name} must name ${role}`);
    } else if (!releaseVersionPattern.test(version)) {
      problems.push(`${name} is ${JSON.stringify(version)}, not a version`);
    }
  }
  if (problems.length > 0 || latest === undefined || start === undefined) {
    return problems;
  }
  if (compareSemver(latest, finalFormat) < 0) {
    problems.push(
      `E2E_BRAT_LATEST is ${latest}, but the highest published release is ${finalFormat} or later`,
    );
  }
  if (latest === start) {
    problems.push(
      `E2E_BRAT_START must be earlier than E2E_BRAT_LATEST, not ${start} too`,
    );
  }
  for (const problem of versionOrderProblems(latest, [start])) {
    problems.push(`BRAT cannot update from ${start}: ${problem}`);
  }
  return problems;
}

/**
 * Every reason that `latest` and `start` are not the highest of the
 * `published` releases and one of the others.
 */
export function bratPublishedProblems(
  latest: string,
  start: string,
  published: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const [name, version] of [
    ["E2E_BRAT_LATEST", latest],
    ["E2E_BRAT_START", start],
  ] as const) {
    if (!published.includes(version)) {
      problems.push(`${name} is ${version}, which is not published`);
    }
  }
  const [highest] = [...published].sort((a, b) => compareSemver(b, a));
  if (highest !== undefined && highest !== latest) {
    problems.push(
      `E2E_BRAT_LATEST is ${latest}, but the highest published release is ${highest}`,
    );
  }
  return problems;
}
