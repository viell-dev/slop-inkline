// Release metadata rules, kept free of file access so that unit tests can run
// them on synthetic input. scripts/release.ts applies them to the repository.

import { fromMarkdown } from "mdast-util-from-markdown";
import {
  compareSemver,
  isPrerelease,
  releaseVersionPattern,
  stableVersionPattern,
} from "./version.ts";

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

/**
 * What is wrong with manifest.json while package.json names `version`, a
 * pre-release. Obsidian offers every user the version that manifest.json names
 * on main, so a pre-release's version stays out of it, and a build gets it
 * from package.json instead.
 */
function prereleaseManifestProblems(
  version: string,
  manifestVersion: string | undefined,
): string[] {
  if (
    manifestVersion === undefined ||
    !stableVersionPattern.test(manifestVersion)
  ) {
    return [`manifest.json version ${String(manifestVersion)} is not x.y.z`];
  }
  if (isPrerelease(manifestVersion)) {
    return [
      `manifest.json version ${manifestVersion} is a pre-release, which Obsidian would offer to every user`,
    ];
  }
  if (compareSemver(manifestVersion, version) > 0) {
    return [
      `manifest.json version ${manifestVersion} is higher than package.json version ${version}`,
    ];
  }
  return [];
}

/**
 * What is wrong with `offered`, the public release that manifest.json names.
 * Obsidian offers it to new installs and updates from main, so it is the newest
 * public release that versions.json lists: one set back to an older release
 * hides the newest. While a pre-release is prepared neither file changes, so
 * the map also lists the manifest's release; for a public release, the check
 * of the map's entry for it does that. A rollback reverts both files together,
 * and passes. Both set back together, or an older entry dropped from the map,
 * pass here; {@link releasedVersionsProblems} compares the map with the
 * changelog for those (#324).
 */
function offeredReleaseProblems(
  offered: string,
  preparingPrerelease: boolean,
  versions: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  if (preparingPrerelease && !Object.hasOwn(versions, offered)) {
    problems.push(
      `manifest.json version ${offered} is not in versions.json, which lists every public release`,
    );
  }
  const newest = Object.keys(versions)
    .filter(
      (release) => stableVersionPattern.test(release) && !isPrerelease(release),
    )
    .reduce<string | undefined>(
      (found, release) =>
        found === undefined || compareSemver(release, found) > 0
          ? release
          : found,
      undefined,
    );
  if (newest !== undefined && compareSemver(newest, offered) > 0) {
    problems.push(
      `versions.json lists ${newest}, a later public release than manifest.json version ${offered}`,
    );
  }
  return problems;
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
  const preparingPrerelease = version !== undefined && isPrerelease(version);
  // The public release the manifest names, once the checks below accept it.
  let offered: string | undefined;
  if (preparingPrerelease) {
    const manifestProblems = prereleaseManifestProblems(
      version,
      manifestVersion,
    );
    problems.push(...manifestProblems);
    if (manifestProblems.length === 0) offered = manifestVersion;
  } else if (manifestVersion !== version) {
    problems.push(
      `manifest.json version ${String(manifestVersion)} differs from package.json version ${String(version)}`,
    );
  } else if (version !== undefined && stableVersionPattern.test(version)) {
    offered = version;
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
    } else if (isPrerelease(release)) {
      problems.push(`versions.json key ${release} is a pre-release`);
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
    !isPrerelease(version) &&
    metadata.versions[version] !== minAppVersion
  ) {
    problems.push(
      `versions.json does not map ${version} to the manifest's minAppVersion ${String(minAppVersion)}`,
    );
  }
  if (offered !== undefined) {
    problems.push(
      ...offeredReleaseProblems(
        offered,
        preparingPrerelease,
        metadata.versions,
      ),
    );
  }
  return problems;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A heading of the changelog, with where it starts and ends in `source`. */
interface ChangelogHeading {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The changelog's text with a leading byte order mark dropped and its line
 * endings made `\n`, and its headings of level 1 or 2 at the top level, in
 * order. The parser drops the mark before counting offsets, so the text the
 * offsets point into must not have one either. Only those headings start or
 * end a section, so that a heading in a code example, a list, or a quote
 * cannot cut a section short or hide a release.
 */
function changelogHeadings(changelog: string): {
  readonly source: string;
  readonly headings: readonly ChangelogHeading[];
} {
  const source = changelog.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const headings = fromMarkdown(source).children.flatMap((node) => {
    if (node.type !== "heading" || node.depth > 2) return [];
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? 0;
    return [{ text: source.slice(start, end).trim(), start, end }];
  });
  return { source, headings };
}

/**
 * Returns the body of a changelog section, or undefined when the section is
 * missing or empty. A release's heading is `## x.y.z - YYYY-MM-DD`; the
 * section for unreleased changes is `## Unreleased`.
 *
 * The changelog is parsed as CommonMark, as {@link changelogHeadings} says.
 */
export function releaseNotes(
  changelog: string,
  section: string,
): string | undefined {
  const heading =
    section === "Unreleased"
      ? /^## Unreleased$/
      : new RegExp(`^## ${escapeRegExp(section)} - \\d{4}-\\d{2}-\\d{2}$`);
  const { source, headings } = changelogHeadings(changelog);
  const index = headings.findIndex(({ text }) => heading.test(text));
  const current = headings[index];
  if (current === undefined) return undefined;
  const body = source.slice(current.end, headings[index + 1]?.start).trim();
  return body === "" ? undefined : body;
}

/** The first public release, from which versions.json lists every one. */
export const firstPublicRelease = "1.0.0";

/**
 * What is wrong with versions.json against the changelog. From
 * {@link firstPublicRelease}, the map lists exactly the public releases that
 * have a `## x.y.z - YYYY-MM-DD` section: preparing a public release adds both,
 * and a rollback reverts both. So an entry dropped from the map, or one for a
 * version never released, shows here, even with the manifest set back to
 * match (#324). It compares two files of the repository, so a release's
 * section and entry taken out together still pass, and so do both added for
 * a version never published: only the published releases could show those.
 * It reads headings as {@link changelogHeadings} does.
 */
export function releasedVersionsProblems(
  changelog: string,
  versions: Record<string, unknown>,
): string[] {
  const released = new Set(
    changelogHeadings(changelog).headings.flatMap(({ text }) => {
      const version = /^## (\S+) - \d{4}-\d{2}-\d{2}$/.exec(text)?.[1];
      return version !== undefined &&
        stableVersionPattern.test(version) &&
        !isPrerelease(version) &&
        compareSemver(version, firstPublicRelease) >= 0
        ? [version]
        : [];
    }),
  );
  const problems: string[] = [];
  for (const version of released) {
    if (!Object.hasOwn(versions, version)) {
      problems.push(
        `versions.json has no entry for ${version}, a public release in CHANGELOG.md`,
      );
    }
  }
  for (const version of Object.keys(versions)) {
    if (!released.has(version)) {
      problems.push(
        `versions.json lists ${version}, which CHANGELOG.md does not record as a public release`,
      );
    }
  }
  return problems;
}

/** Lists every reason the repository cannot release `version` as it is. */
export function releaseProblems(
  metadata: Metadata,
  changelog: string,
  version: string,
): string[] {
  const problems = metadataProblems(metadata);
  if (!stableVersionPattern.test(version)) {
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
 * version` has already written to package.json. Only a public release changes
 * them: Obsidian reads both from main, and a pre-release must not reach it.
 */
export function syncMetadata(
  version: string,
  manifest: Record<string, unknown>,
  versions: Record<string, unknown>,
): { manifest: Record<string, unknown>; versions: Record<string, unknown> } {
  if (isPrerelease(version)) {
    return { manifest: { ...manifest }, versions: { ...versions } };
  }
  return {
    manifest: { ...manifest, version },
    versions: { ...versions, [version]: manifest.minAppVersion },
  };
}

/**
 * The manifest.json a build ships, from the text of the repository's file: the
 * same, naming `version`, the one package.json gives. So the version of a
 * build comes from its commit, whether or not it is a public release, and for
 * one that is, the two files are the same bytes.
 */
export function builtManifest(manifest: string, version: string): string {
  const parsed: unknown = JSON.parse(manifest);
  if (!isRecord(parsed)) throw new Error("manifest.json must be an object");
  return `${JSON.stringify({ ...parsed, version }, null, 2)}
`;
}
