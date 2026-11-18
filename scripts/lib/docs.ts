// The guide lives on protected main and describes the newest public release,
// the one manifest.json names there. Preparing a public release changes the
// manifest, so that guide waits until the release is published; a
// pre-release leaves the manifest alone, so its guide deploys at once.
import {
  compareSemver,
  isPrerelease,
  stableVersionPattern,
} from "./version.ts";

export interface DocsRelease {
  readonly tag: string;
  readonly prerelease: boolean;
}

export interface DocsRequest {
  readonly event: "push" | "dispatch";
  readonly ref: string;
  readonly refType: "branch" | "tag";
  /** Published releases, newest first. */
  readonly releases: readonly DocsRelease[];
  /** The version manifest.json names on the commit being built. */
  readonly manifestVersion: string;
}

export type DocsSource =
  | { readonly deploy: true; readonly ref: string; readonly version: string }
  | {
      readonly deploy: false;
      readonly reason: string;
      readonly error: boolean;
    };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The published releases on the pages of GitHub's release list, newest first
 * by when each was published. Drafts are left out. Anything else that is not a
 * published release with a tag, a prerelease flag, and a time of publication
 * throws, so that a change in the API stops the deployment rather than choosing
 * a guide from part of the list.
 */
export function publishedReleases(
  pages: readonly (readonly unknown[])[],
): DocsRelease[] {
  return pages
    .flat()
    .flatMap((release) => {
      if (!isRecord(release)) {
        throw new Error("the releases list contains a non-object");
      }
      if (release.draft === true) return [];
      const at =
        typeof release.published_at === "string"
          ? Date.parse(release.published_at)
          : Number.NaN;
      if (
        release.draft !== false ||
        typeof release.prerelease !== "boolean" ||
        typeof release.tag_name !== "string" ||
        release.tag_name === "" ||
        !Number.isFinite(at)
      ) {
        throw new Error(
          "the releases list contains an invalid published release",
        );
      }
      return [{ tag: release.tag_name, prerelease: release.prerelease, at }];
    })
    .sort((a, b) => b.at - a.at)
    .map(({ tag, prerelease }) => ({ tag, prerelease }));
}

/**
 * Whether `release` is a public release: GitHub does not flag it as a
 * pre-release, and its version says so too, plain `x.y.z` with an even minor
 * version.
 */
function isPublic({ tag, prerelease }: DocsRelease): boolean {
  return !prerelease && stableVersionPattern.test(tag) && !isPrerelease(tag);
}

export function docsSource(request: DocsRequest): DocsSource {
  if (request.refType !== "branch" || request.ref !== "main") {
    return {
      deploy: false,
      reason: "Documentation deploys from main only.",
      error: true,
    };
  }
  const version = request.manifestVersion;
  const latestPublic = request.releases.find(isPublic);
  if (version === latestPublic?.tag) {
    return { deploy: true, ref: "main", version };
  }
  // The manifest names only public releases, so one published under another
  // flag was flagged by hand, and the guide would wait for it for ever.
  const named = request.releases.find(({ tag }) => tag === version);
  if (named !== undefined && !isPublic(named)) {
    return {
      deploy: false,
      reason: `manifest.json names ${version}, which is published as a pre-release; correct the release's flag on GitHub, or the manifest.`,
      error: true,
    };
  }
  if (
    latestPublic !== undefined &&
    stableVersionPattern.test(version) &&
    compareSemver(latestPublic.tag, version) > 0
  ) {
    return {
      deploy: false,
      reason: `This commit's guide describes ${version}, and ${latestPublic.tag} is the newest public release, so a later commit of main deploys its guide.`,
      error: false,
    };
  }
  return {
    deploy: false,
    reason: `The guide for ${version} waits until that version is the newest published public release.`,
    error: false,
  };
}
