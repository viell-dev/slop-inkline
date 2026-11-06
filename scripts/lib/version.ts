// Release versions are plain x.y.z, and an odd minor version is a pre-release,
// as RELEASING.md explains: Obsidian compares versions number by number, so it
// would order a SemVer prerelease suffix wrongly. Releases before 0.9.0 carried
// such a suffix, which still marks them as pre-releases. Obsidian's community
// directory and app compatibility versions use only the numeric core.
const number = "(?:0|[1-9]\\d*)";
const core = `${number}\\.${number}\\.${number}`;
const identifier = `(?:${number}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;

export const stableVersionPattern = new RegExp(`^${core}$`);
export const releaseVersionPattern = new RegExp(
  `^${core}(?:-${identifier}(?:\\.${identifier})*)?$`,
);

/**
 * Whether `version` is a pre-release: one with an odd minor version, as
 * `0.9.0` or `1.1.2`, or one with a SemVer prerelease suffix, as the releases
 * before 0.9.0 had.
 */
export function isPrerelease(version: string): boolean {
  if (!releaseVersionPattern.test(version)) return false;
  if (version.includes("-")) return true;
  return Number(version.split(".")[1]) % 2 === 1;
}

export function installArchiveName(version: string): string {
  if (!releaseVersionPattern.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  return `inkline-${version}.zip`;
}

/** One dot-separated part of a SemVer prerelease suffix against another. */
function compareIdentifiers(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Number(a) - Number(b);
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Orders two valid versions as SemVer does, and so as BRAT does: below zero
 * when `a` comes first. A version with a suffix comes before the same version
 * without one.
 */
export function compareSemver(a: string, b: string): number {
  const [coreA = "", ...suffixA] = a.split("-");
  const [coreB = "", ...suffixB] = b.split("-");
  const numbersA = coreA.split(".").map(Number);
  const numbersB = coreB.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (numbersA[index] ?? 0) - (numbersB[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (suffixA.length === 0 || suffixB.length === 0) {
    return suffixB.length - suffixA.length;
  }
  const identifiersA = suffixA.join("-").split(".");
  const identifiersB = suffixB.join("-").split(".");
  const shared = Math.min(identifiersA.length, identifiersB.length);
  for (let index = 0; index < shared; index++) {
    const order = compareIdentifiers(
      identifiersA[index] ?? "",
      identifiersB[index] ?? "",
    );
    if (order !== 0) return order;
  }
  return identifiersA.length - identifiersB.length;
}

/** The numbers Obsidian reads from a version; undefined if it reads none. */
function obsidianNumbers(version: string): number[] | undefined {
  const numbers = version.split(".").map((part) => Number.parseInt(part, 10));
  return numbers.some(Number.isNaN) ? undefined : numbers;
}

/**
 * Whether Obsidian takes `offered` for newer than `installed`, and so offers
 * the update. It splits a version at each dot and reads the number each part
 * starts with, so `0.3.0-alpha.8` reads as 0, 3, 0, 8. It compares the numbers
 * both have, and then the longer list is the newer, which ranks that version
 * above `0.3.0`. Read from Obsidian 1.15.0 and recorded in #141.
 */
export function obsidianOffers(installed: string, offered: string): boolean {
  const from = obsidianNumbers(installed);
  const to = obsidianNumbers(offered);
  if (to === undefined) return false;
  if (from === undefined) return true;
  const shared = Math.min(from.length, to.length);
  for (let index = 0; index < shared; index++) {
    const start = from[index] ?? 0;
    const end = to[index] ?? 0;
    if (start !== end) return start < end;
  }
  return from.length < to.length;
}

/**
 * Every reason `version` cannot follow the `published` versions: it must be
 * higher than each in SemVer's order, which BRAT uses, and in Obsidian's, or
 * someone on that version is never offered it. A version that is already
 * published is left to the publish step, which resumes the same build and
 * refuses any other.
 */
export function versionOrderProblems(
  version: string,
  published: readonly string[],
): string[] {
  return published
    .filter((other) => other !== version)
    .flatMap((other) => [
      ...(compareSemver(version, other) > 0
        ? []
        : [`${version} is not higher than ${other} in SemVer's order`]),
      ...(obsidianOffers(other, version)
        ? []
        : [`Obsidian would not offer ${version} to someone on ${other}`]),
    ]);
}
