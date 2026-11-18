// The guide lives on protected main and describes the newest public release,
// the one manifest.json names there. Preparing a public release changes the
// manifest, so that guide waits until the release is published; a
// pre-release leaves the manifest alone, so its guide deploys at once.
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
  const version = request.manifestVersion;
  if (version !== latestPublic?.tag) {
    return {
      deploy: false,
      reason: `The guide for ${version} waits until that version is the newest published public release.`,
      error: false,
    };
  }
  return { deploy: true, ref: "main", version };
}
