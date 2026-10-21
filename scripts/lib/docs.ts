// Which commit the documentation site is deployed from, as
// docs/versions.md describes: `main` until the first release, then the
// newest release, or a `docs-<version>` branch that corrects its
// documentation only. Free of network access, so that unit tests can run it
// on synthetic input; scripts/docs.ts asks GitHub for the facts. It imports
// nothing, so that the Pages workflow runs it without the dependencies.

/** What started the Pages workflow, and what it was asked to deploy. */
export interface DocsRequest {
  /**
   * `push` for a change merged to main, `release` after a Release run that
   * published, and `dispatch` when run by hand for `ref`.
   */
  readonly event: "push" | "release" | "dispatch";
  /** The branch or tag asked for: `main` for a push. */
  readonly ref: string;
  /** The published releases' tags, newest first; drafts are not releases. */
  readonly releases: readonly string[];
  /**
   * For a `docs-<version>` branch: whether it contains the release's tag,
   * and the files it changes since that tag.
   */
  readonly branch?: {
    readonly containsTag: boolean;
    readonly changed: readonly string[];
  };
}

export type DocsSource =
  | {
      readonly deploy: true;
      /** The branch or tag to build. */
      readonly ref: string;
      /** The release the site describes, or `unreleased`. */
      readonly version: string;
    }
  | { readonly deploy: false; readonly reason: string; readonly error: boolean };

/** The branch that corrects the documentation of release `version`. */
export function docsBranch(version: string): string {
  return `docs-${version}`;
}

/** Where the site is built from for `request`, or why it is not deployed. */
export function docsSource(request: DocsRequest): DocsSource {
  const latest = request.releases[0];
  const refuse = (reason: string, error = true): DocsSource => ({
    deploy: false,
    reason,
    error,
  });
  if (latest === undefined) {
    if (request.ref === "main") {
      return { deploy: true, ref: "main", version: "unreleased" };
    }
    return refuse(
      `Inkline has no release yet, so the site is built from main only, not ${request.ref}.`,
    );
  }
  if (request.event === "push") {
    return refuse(
      `The site describes ${latest}; what changed on main since appears with the next release.`,
      false,
    );
  }
  if (request.ref === latest) {
    return { deploy: true, ref: latest, version: latest };
  }
  if (request.event === "release") {
    return refuse(
      `The release run published ${request.ref}, but the newest release is ${latest}.`,
    );
  }
  if (request.ref !== docsBranch(latest)) {
    return refuse(
      `Only ${latest} or ${docsBranch(latest)} can be deployed, not ${request.ref}.`,
    );
  }
  const branch = request.branch;
  if (branch === undefined || !branch.containsTag) {
    return refuse(
      `${request.ref} must be made from the tag ${latest}, so that it describes that release.`,
    );
  }
  const outside = branch.changed.filter((file) => !file.startsWith("docs/"));
  if (outside.length > 0) {
    return refuse(
      `${request.ref} changes more than the documentation: ${outside.join(", ")}.`,
    );
  }
  return { deploy: true, ref: request.ref, version: latest };
}
