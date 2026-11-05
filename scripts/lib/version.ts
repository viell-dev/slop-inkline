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
