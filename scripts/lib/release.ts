// Release metadata rules, kept free of file access so that unit tests can run
// them on synthetic input. scripts/release.ts applies them to the repository.

import { fromMarkdown } from "mdast-util-from-markdown";
import {
  isPrerelease,
  releaseVersionPattern,
  stableVersionPattern,
} from "./version.ts";

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

  if (version === undefined || !releaseVersionPattern.test(version)) {
    problems.push(
      `package.json version ${String(version)} is not a release version`,
    );
  }
  if (manifestVersion !== version) {
    problems.push(
      `manifest.json version ${String(manifestVersion)} differs from package.json version ${String(version)}`,
    );
  }
  if (
    minAppVersion === undefined ||
    !stableVersionPattern.test(minAppVersion)
  ) {
    problems.push(
      `manifest.json minAppVersion ${String(minAppVersion)} is not x.y.z`,
    );
  }
  if (!isRecord(metadata.versions)) {
    problems.push("versions.json is not an object");
    return problems;
  }
  for (const [release, appVersion] of Object.entries(metadata.versions)) {
    if (!stableVersionPattern.test(release)) {
      problems.push(`versions.json key ${release} is not x.y.z`);
    }
    if (
      typeof appVersion !== "string" ||
      !stableVersionPattern.test(appVersion)
    ) {
      problems.push(`versions.json entry for ${release} is not x.y.z`);
    }
  }
  if (
    version !== undefined &&
    version !== unreleasedVersion &&
    !isPrerelease(version) &&
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

/**
 * Returns the body of a changelog section, or undefined when the section is
 * missing or empty. A release's heading is `## x.y.z - YYYY-MM-DD`; the
 * section for unreleased changes is `## Unreleased`.
 *
 * The changelog is parsed as CommonMark, and only headings of level 1 or 2 at
 * the top level start or end a section, so that a heading in a code example,
 * a list, or a quote cannot cut the notes short or hide a release.
 */
export function releaseNotes(
  changelog: string,
  section: string,
): string | undefined {
  const heading =
    section === "Unreleased"
      ? /^## Unreleased$/
      : new RegExp(`^## ${escapeRegExp(section)} - \\d{4}-\\d{2}-\\d{2}$`);
  // The parser drops a leading byte order mark before counting offsets, so the
  // sliced text must not have one either.
  const source = changelog.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const bounds = fromMarkdown(source)
    .children.filter((node) => node.type === "heading" && node.depth <= 2)
    .map((node) => ({
      start: node.position?.start.offset ?? 0,
      end: node.position?.end.offset ?? 0,
    }));
  const index = bounds.findIndex(({ start, end }) =>
    heading.test(source.slice(start, end).trim()),
  );
  const current = bounds[index];
  if (current === undefined) return undefined;
  const body = source.slice(current.end, bounds[index + 1]?.start).trim();
  return body === "" ? undefined : body;
}

/** Lists every reason the repository cannot release `version` as it is. */
export function releaseProblems(
  metadata: Metadata,
  changelog: string,
  version: string,
): string[] {
  const problems = metadataProblems(metadata);
  if (!releaseVersionPattern.test(version) || version === unreleasedVersion) {
    problems.push(`${version} is not a releasable version`);
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
    // RCs are installed manually; keep the community directory's map numeric.
    versions: isPrerelease(version)
      ? { ...versions }
      : { ...versions, [version]: minAppVersion },
  };
}
