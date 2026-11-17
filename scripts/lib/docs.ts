import { isPrerelease, stableVersionPattern } from "./version.ts";

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
  readonly packageVersion: string;
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

export function docsSource(request: DocsRequest): DocsSource {
  if (request.refType !== "branch" || request.ref !== "main") {
    return {
      deploy: false,
      reason: "Documentation deploys from main only.",
      error: true,
    };
  }
  const latestPublic = request.releases.find(
    ({ tag, prerelease }) =>
      !prerelease && stableVersionPattern.test(tag) && !isPrerelease(tag),
  );
  // Before the first public release, the manifest still named a pre-release.
  const beforeFirstPublic =
    latestPublic === undefined && isPrerelease(request.manifestVersion);
  const version = beforeFirstPublic
    ? request.packageVersion
    : request.manifestVersion;
  const published = beforeFirstPublic ? request.releases[0] : latestPublic;
  if (version !== published?.tag) {
    return {
      deploy: false,
      reason: `The guide for ${version} waits until that version is the newest published ${beforeFirstPublic ? "release" : "public release"}.`,
      error: false,
    };
  }
  return { deploy: true, ref: "main", version };
}
