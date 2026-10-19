// Release metadata rules, kept free of file access so that unit tests can run
// them on synthetic input. scripts/release.ts applies them to the repository.

/**
 * Release versions are plain dotted numbers without leading zeros, which is
 * SemVer without prerelease or build parts, as Obsidian's directory needs.
 */
export const versionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** The version a repository has before its first release. */
export const unreleasedVersion = "0.0.0";

export interface Metadata {
  /** Parsed `package.json`. */
  readonly packageJson: unknown;
  /** Parsed `manifest.json`. */
  readonly manifest: unknown;
  /** Parsed `versions.json`. */
  readonly versions: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

/** Lists every way the package, manifest, and versions files disagree. */
export function metadataProblems(metadata: Metadata): string[] {
  const problems: string[] = [];
  const version = stringField(metadata.packageJson, "version");
  const manifestVersion = stringField(metadata.manifest, "version");
  const minAppVersion = stringField(metadata.manifest, "minAppVersion");

  if (version === undefined || !versionPattern.test(version)) {
    problems.push(`package.json version ${String(version)} is not x.y.z`);
  }
  if (manifestVersion !== version) {
    problems.push(
      `manifest.json version ${String(manifestVersion)} differs from package.json version ${String(version)}`,
    );
  }
  if (minAppVersion === undefined || !versionPattern.test(minAppVersion)) {
    problems.push(
      `manifest.json minAppVersion ${String(minAppVersion)} is not x.y.z`,
    );
  }
  if (!isRecord(metadata.versions)) {
    problems.push("versions.json is not an object");
    return problems;
  }
  for (const [release, appVersion] of Object.entries(metadata.versions)) {
    if (!versionPattern.test(release)) {
      problems.push(`versions.json key ${release} is not x.y.z`);
    }
    if (typeof appVersion !== "string" || !versionPattern.test(appVersion)) {
      problems.push(`versions.json entry for ${release} is not x.y.z`);
    }
  }
  if (
    version !== undefined &&
    version !== unreleasedVersion &&
    metadata.versions[version] !== minAppVersion
  ) {
    problems.push(
      `versions.json does not map ${version} to the manifest's minAppVersion ${String(minAppVersion)}`,
    );
  }
  return problems;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const fenceLine = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Marks each line that is Markdown text rather than fenced code, so that a
 * heading shown inside a code example is not taken for a section heading.
 * Fences follow CommonMark: three or more backticks or tildes, indented by
 * at most three spaces, closed by at least as many of the same character.
 */
function outsideFences(lines: readonly string[]): boolean[] {
  let open: { char: string; length: number } | undefined;
  return lines.map((line) => {
    const [, marker = "", rest = ""] = fenceLine.exec(line) ?? [];
    const char = marker.charAt(0);
    if (open === undefined) {
      // A backtick fence's info string cannot contain a backtick.
      if (marker === "" || (char === "`" && rest.includes("`"))) return true;
      open = { char, length: marker.length };
      return false;
    }
    if (
      char === open.char &&
      marker.length >= open.length &&
      rest.trim() === ""
    ) {
      open = undefined;
    }
    return false;
  });
}

/**
 * Returns the body of a changelog section, or undefined when the section is
 * missing or empty. A release's heading is `## x.y.z - YYYY-MM-DD`; the
 * section for unreleased changes is `## Unreleased`. The section ends at the
 * next heading of level 1 or 2 outside fenced code.
 */
export function releaseNotes(
  changelog: string,
  section: string,
): string | undefined {
  const heading =
    section === "Unreleased"
      ? /^## Unreleased$/
      : new RegExp(`^## ${escapeRegExp(section)} - \\d{4}-\\d{2}-\\d{2}$`);
  const lines = changelog.split(/\r?\n/);
  const text = outsideFences(lines);
  const isText = (index: number): boolean => text[index] === true;
  const start = lines.findIndex(
    (line, index) => isText(index) && heading.test(line.trimEnd()),
  );
  if (start === -1) return undefined;
  const end = lines.findIndex(
    (line, index) =>
      index > start && isText(index) && /^ {0,3}#{1,2}(?:[ \t]|$)/.test(line),
  );
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
  return body === "" ? undefined : body;
}

/** Lists every reason the repository cannot release `version` as it is. */
export function releaseProblems(
  metadata: Metadata,
  changelog: string,
  version: string,
): string[] {
  const problems = metadataProblems(metadata);
  if (!versionPattern.test(version) || version === unreleasedVersion) {
    problems.push(`${version} is not a releasable x.y.z version`);
  }
  const packageVersion = stringField(metadata.packageJson, "version");
  if (packageVersion !== version) {
    problems.push(
      `package.json version ${String(packageVersion)} is not ${version}`,
    );
  }
  if (releaseNotes(changelog, version) === undefined) {
    problems.push(
      `CHANGELOG.md has no non-empty "## ${version} - YYYY-MM-DD" section`,
    );
  }
  return problems;
}

/**
 * Returns the manifest and versions map updated for `version`, which `npm
 * version` has already written to package.json.
 */
export function syncMetadata(
  version: string,
  manifest: Record<string, unknown>,
  versions: Record<string, unknown>,
): { manifest: Record<string, unknown>; versions: Record<string, unknown> } {
  const minAppVersion = manifest.minAppVersion;
  return {
    manifest: { ...manifest, version },
    versions: { ...versions, [version]: minAppVersion },
  };
}
