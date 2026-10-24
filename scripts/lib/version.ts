// Release versions may include a SemVer prerelease suffix. Obsidian's community
// directory and app compatibility versions use only the numeric core.
const number = "(?:0|[1-9]\\d*)";
const core = `${number}\\.${number}\\.${number}`;
const identifier = `(?:${number}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;

export const stableVersionPattern = new RegExp(`^${core}$`);
export const releaseVersionPattern = new RegExp(
  `^${core}(?:-${identifier}(?:\\.${identifier})*)?$`,
);

export function isPrerelease(version: string): boolean {
  return releaseVersionPattern.test(version) && version.includes("-");
}

export function installArchiveName(version: string): string {
  if (!releaseVersionPattern.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  return `inkline-${version}.zip`;
}
