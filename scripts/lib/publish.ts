// The checks and steps that publish a release, kept free of network access
// so that unit tests can run them against a fake GitHub, failures included;
// scripts/publish.ts runs them against the real one, and the Release
// workflow runs that. It imports nothing, so that the workflow's jobs run it
// without installing the dependencies.

/** A file the release carries, with its SHA-256 as hexadecimal. */
export interface BuiltFile {
  readonly name: string;
  readonly sha256: string;
}

/** A check that the ruleset requires, and the app whose run counts. */
export interface RequiredCheck {
  readonly context: string;
  readonly integrationId: number | undefined;
}

/** A check run on a commit, as GitHub's checks API gives it. */
export interface CheckRun {
  readonly name: string;
  /** The app that made it. */
  readonly appId: number | undefined;
  readonly status: string;
  readonly conclusion: string | null;
  /** When it completed, as an ISO date, or null while it runs. */
  readonly completedAt: string | null;
}

/** How long a passing run of the required checks stays good for a release. */
export const ciLifetimeDays = 7;

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  const items: readonly unknown[] = value;
  return items;
}

/**
 * The checks that a ruleset file requires, as .github/rulesets/main.json
 * records them, each with the app whose run of it counts.
 */
export function requiredChecks(ruleset: unknown): RequiredCheck[] {
  return list(field(ruleset, "rules")).flatMap((rule) => {
    if (field(rule, "type") !== "required_status_checks") return [];
    const checks = list(
      field(field(rule, "parameters"), "required_status_checks"),
    );
    return checks.flatMap((check) => {
      const context = field(check, "context");
      const integration = field(check, "integration_id");
      return typeof context === "string"
        ? [
            {
              context,
              integrationId:
                typeof integration === "number" ? integration : undefined,
            },
          ]
        : [];
    });
  });
}

/**
 * Every reason a commit whose check runs are `runs` cannot be released at
 * `now`: a required check that has no run by its app, whose latest run did
 * not pass, or whose latest run is older than {@link ciLifetimeDays} days,
 * as the end-to-end check's latest Obsidian release may have moved on since.
 */
export function ciProblems(
  required: readonly RequiredCheck[],
  runs: readonly CheckRun[],
  now: Date,
): string[] {
  if (required.length === 0) return ["the ruleset requires no checks"];
  const problems: string[] = [];
  for (const { context, integrationId } of required) {
    const latest = runs
      .filter(
        (run) =>
          run.name === context &&
          (integrationId === undefined || run.appId === integrationId),
      )
      .sort((a, b) =>
        (b.completedAt ?? "9999").localeCompare(a.completedAt ?? "9999"),
      )[0];
    if (latest === undefined) {
      problems.push(`${context} has not run on this commit`);
    } else if (latest.status !== "completed" || latest.completedAt === null) {
      problems.push(`${context} is still running`);
    } else if (latest.conclusion !== "success") {
      problems.push(`${context} ended ${String(latest.conclusion)}`);
    } else {
      const age = now.getTime() - Date.parse(latest.completedAt);
      if (age > ciLifetimeDays * 24 * 60 * 60 * 1000) {
        problems.push(
          `${context} last passed ${latest.completedAt}, over ${String(ciLifetimeDays)} days ago: run CI on main again`,
        );
      }
    }
  }
  return problems;
}

/** A release that is not published yet: a draft, which has no tag. */
export interface Draft {
  readonly id: number;
  /** The commit it will tag when published. */
  readonly target: string;
  readonly assets: readonly {
    readonly name: string;
    /** As GitHub gives it, `sha256:<hex>`, when it does. */
    readonly digest: string | undefined;
  }[];
}

/** What publishing needs of GitHub; scripts/publish.ts gives the real one. */
export interface ReleaseHost {
  /**
   * Whether a tag of that name exists, as a published release makes one.
   * Throws when GitHub cannot say, so that an error never reads as "no tag".
   */
  tagExists(version: string): Promise<boolean>;
  /** Every draft release for `version`, as earlier runs can leave them. */
  drafts(version: string): Promise<readonly Draft[]>;
  deleteDraft(id: number): Promise<void>;
  /** Creates a draft for `version` with the built files and its notes. */
  createDraft(version: string): Promise<void>;
  /** Publishes the draft `id`, which creates the tag on its commit. */
  publish(id: number, version: string): Promise<void>;
  /**
   * The published release of `version`, with the commit its tag names, or
   * undefined if there is none, only a tag.
   */
  published(version: string): Promise<Draft | undefined>;
  /** Waits `ms` milliseconds. */
  wait(ms: number): Promise<void>;
  log(message: string): void;
}

/**
 * How often to list the drafts after making one: GitHub can leave a release it
 * has just made out of its list for a few seconds.
 */
export const draftListings = 5;

/**
 * How long to wait before each later listing, in milliseconds, times the
 * listings so far: 2, 4, 6 and 8 seconds, 20 in all.
 */
export const draftListingWait = 2000;

/** Whether `draft` holds exactly the built files, byte for byte. */
export function holdsBuild(draft: Draft, files: readonly BuiltFile[]): boolean {
  return (
    draft.assets.length === files.length &&
    files.every((file) =>
      draft.assets.some(
        (asset) =>
          asset.name === file.name && asset.digest === `sha256:${file.sha256}`,
      ),
    )
  );
}

/** What a draft holds, for a message. */
function described(draft: Draft): string {
  const assets = draft.assets
    .map((asset) => `${asset.name} (${asset.digest ?? "no digest"})`)
    .join(", ");
  return `draft ${String(draft.id)} for ${draft.target}, with ${assets === "" ? "no files" : assets}`;
}

/**
 * Publishes `version` with `files`, built from `commit`, so that a run that
 * failed part way can simply run again: a version already published from
 * exactly this build and commit is left as it is, and the run succeeds, so
 * that the release is verified; any other version whose tag exists is
 * refused, as published files are never replaced; a single draft left by an
 * earlier run that holds exactly these files for this commit is published as
 * it is; any other drafts for the version, which nobody can have installed,
 * are deleted and one is made again. The draft is checked to hold the built
 * files for this commit, and to be the only one, before it is published by
 * its id.
 */
export async function publishRelease(
  host: ReleaseHost,
  version: string,
  files: readonly BuiltFile[],
  commit: string,
): Promise<void> {
  if (await host.tagExists(version)) {
    // A run whose publishing reached GitHub, though the run did not see it
    // succeed, is done: running it again goes on to verify the release.
    const release = await host.published(version);
    if (release?.target === commit && holdsBuild(release, files)) {
      host.log(`${version} is published already, from this build.`);
      return;
    }
    throw new Error(
      `The tag ${version} exists already; a correction needs a new version.`,
    );
  }
  const left = await host.drafts(version);
  const [only] = left;
  let id: number;
  if (left.length === 1 && only?.target === commit && holdsBuild(only, files)) {
    host.log(
      `Publishing the draft an earlier run left, which holds this build.`,
    );
    id = only.id;
  } else {
    for (const draft of left) {
      host.log(`Deleting the ${described(draft)}.`);
      await host.deleteDraft(draft.id);
    }
    await host.createDraft(version);
    // Only an empty list is waited out: any draft it does show is checked.
    let made = await host.drafts(version);
    for (
      let listing = 1;
      made.length === 0 && listing < draftListings;
      listing++
    ) {
      host.log(`GitHub lists no draft for ${version} yet; waiting.`);
      await host.wait(draftListingWait * listing);
      made = await host.drafts(version);
    }
    const [draft] = made;
    if (
      made.length !== 1 ||
      draft?.target !== commit ||
      !holdsBuild(draft, files)
    ) {
      const listed =
        made.length === 0
          ? `lists no draft, even after waiting ${String((draftListingWait * draftListings * (draftListings - 1)) / 2000)} seconds; run again to publish it once listed`
          : `has ${made.map(described).join("; ")}`;
      throw new Error(
        `The draft for ${version} is not the build of ${commit}: GitHub ${listed}. It stays unpublished.`,
      );
    }
    id = draft.id;
  }
  await host.publish(id, version);
  host.log(`Published ${version}.`);
}
