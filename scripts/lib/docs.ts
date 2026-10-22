// Which commit the documentation site is deployed from, as
// docs/versions.md describes: `main` until the first release, then the
// newest release, or a `docs-<version>` branch that corrects its
// documentation only. Free of network access, so that unit tests can run it
// on synthetic input; scripts/docs.ts asks GitHub for the facts. It imports
// nothing, so that the Pages workflow runs it without the dependencies.

/** What started the Pages workflow, and what it was asked to deploy. */
export interface DocsRequest {
  /** `push` for a change merged to main, `dispatch` when run on request. */
  readonly event: "push" | "dispatch";
  /** The branch or tag the run is on, which it builds: `main` for a push. */
  readonly ref: string;
  /** Whether `ref` is a branch or a tag. */
  readonly refType: "branch" | "tag";
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
  | {
      readonly deploy: false;
      readonly reason: string;
      readonly error: boolean;
    };

/**
 * The files that deploy the site, which a correction branch may change too,
 * so that a defect in the deployment can be mended for a release; they run
 * only in that branch's own run, which can deploy the site and nothing else.
 * The dependencies, `package.json`, `package-lock.json`, and `.nvmrc`,
 * are left out on purpose: a correction does not change what builds the
 * site, so a pin that stops building waits for the next release.
 */
export const deploymentFiles: readonly string[] = [
  ".github/workflows/pages.yml",
  "scripts/docs.ts",
  "scripts/lib/docs.ts",
];

/** Whether `value` is an object with string keys, as JSON gives one. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  const branch = (name: string): boolean =>
    request.refType === "branch" && request.ref === name;
  if (latest === undefined) {
    if (branch("main")) {
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
  if (request.refType === "tag" && request.ref === latest) {
    return { deploy: true, ref: latest, version: latest };
  }
  if (!branch(docsBranch(latest))) {
    return refuse(
      `Only ${latest} or ${docsBranch(latest)} can be deployed, not ${request.ref}.`,
    );
  }
  const changes = request.branch;
  if (changes?.containsTag !== true) {
    return refuse(
      `${request.ref} must be made from the tag ${latest}, so that it describes that release.`,
    );
  }
  const outside = changes.changed.filter(
    (file) => !file.startsWith("docs/") && !deploymentFiles.includes(file),
  );
  if (outside.length > 0) {
    return refuse(
      `${request.ref} changes more than the documentation: ${outside.join(", ")}.`,
    );
  }
  return { deploy: true, ref: request.ref, version: latest };
}
