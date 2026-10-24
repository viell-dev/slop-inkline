// The current-release guide lives on protected main. Preparing a version that
// cannot yet be installed leaves the published site alone until publication.
export interface DocsRequest {
  readonly event: "push" | "dispatch";
  readonly ref: string;
  readonly refType: "branch" | "tag";
  readonly releases: readonly string[];
  readonly version: string;
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
  const latest = request.releases[0];
  if (latest === undefined && request.version === "0.0.0") {
    return { deploy: true, ref: "main", version: "unreleased" };
  }
  if (request.version !== latest) {
    return {
      deploy: false,
      reason: `The guide for ${request.version} waits until that release is published.`,
      error: false,
    };
  }
  return { deploy: true, ref: "main", version: request.version };
}
