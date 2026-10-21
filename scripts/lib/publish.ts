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

/** A check run on a commit, as GitHub's checks API gives it. */
export interface CheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  /** When it completed, as an ISO date, or null while it runs. */
  readonly completedAt: string | null;
}

/** How long a passing run of the required checks stays good for a release. */
export const ciLifetimeDays = 7;

/**
 * The names of the checks that a ruleset file requires, as
 * .github/rulesets/main.json records them.
 */
export function requiredChecks(ruleset: unknown): string[] {
  const rules: unknown =
    typeof ruleset === "object" && ruleset !== null
      ? Reflect.get(ruleset, "rules")
      : undefined;
  if (!Array.isArray(rules)) return [];
  const listed: readonly unknown[] = rules;
  return listed.flatMap((rule) => {
    if (typeof rule !== "object" || rule === null) return [];
    if (Reflect.get(rule, "type") !== "required_status_checks") return [];
    const parameters: unknown = Reflect.get(rule, "parameters");
    const checks: unknown =
      typeof parameters === "object" && parameters !== null
        ? Reflect.get(parameters, "required_status_checks")
        : undefined;
    if (!Array.isArray(checks)) return [];
    const each: readonly unknown[] = checks;
    return each.flatMap((check) => {
      const context: unknown =
        typeof check === "object" && check !== null
          ? Reflect.get(check, "context")
          : undefined;
      return typeof context === "string" ? [context] : [];
    });
  });
}

/**
 * Every reason a commit whose check runs are `runs` cannot be released at
 * `now`: a required check that has no run, whose latest run did not pass,
 * or whose latest run is older than {@link ciLifetimeDays} days, as the
 * end-to-end check's latest Obsidian release may have moved on since.
 */
export function ciProblems(
  required: readonly string[],
  runs: readonly CheckRun[],
  now: Date,
): string[] {
  if (required.length === 0) return ["the ruleset requires no checks"];
  const problems: string[] = [];
  for (const name of required) {
    const latest = runs
      .filter((run) => run.name === name)
      .sort((a, b) =>
        (b.completedAt ?? "9999").localeCompare(a.completedAt ?? "9999"),
      )[0];
    if (latest === undefined) {
      problems.push(`${name} has not run on this commit`);
    } else if (latest.status !== "completed" || latest.completedAt === null) {
      problems.push(`${name} is still running`);
    } else if (latest.conclusion !== "success") {
      problems.push(`${name} ended ${String(latest.conclusion)}`);
    } else {
      const age = now.getTime() - Date.parse(latest.completedAt);
      if (age > ciLifetimeDays * 24 * 60 * 60 * 1000) {
        problems.push(
          `${name} last passed ${latest.completedAt}, over ${String(ciLifetimeDays)} days ago: run CI on main again`,
        );
      }
    }
  }
  return problems;
}

/** A release that is not published yet: a draft, which has no tag. */
export interface Draft {
  readonly id: number;
  readonly assets: readonly {
    readonly name: string;
    /** As GitHub gives it, `sha256:<hex>`, when it does. */
    readonly digest: string | undefined;
  }[];
}

/** What publishing needs of GitHub; scripts/publish.ts gives the real one. */
export interface ReleaseHost {
  /** Whether a tag of that name exists, as a published release makes one. */
  tagExists(version: string): Promise<boolean>;
  /** The draft release for `version`, if one is left from an earlier run. */
  draft(version: string): Promise<Draft | undefined>;
  deleteDraft(id: number): Promise<void>;
  /** Creates the draft for `version` with the built files and its notes. */
  createDraft(version: string): Promise<void>;
  /** Publishes the draft, which creates the tag on the built commit. */
  publish(version: string): Promise<void>;
  log(message: string): void;
}

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

/**
 * Publishes `version` with `files`, so that a run that failed part way can
 * simply run again: a version whose tag exists is refused, as published
 * files are never replaced; a draft left by an earlier run that holds
 * exactly these files is published as it is; any other draft, which nobody
 * can have installed, is deleted and made again. The draft is checked to
 * hold the built files before it is published.
 */
export async function publishRelease(
  host: ReleaseHost,
  version: string,
  files: readonly BuiltFile[],
): Promise<void> {
  if (await host.tagExists(version)) {
    throw new Error(
      `The tag ${version} exists already; a correction needs a new version.`,
    );
  }
  const left = await host.draft(version);
  if (left !== undefined && holdsBuild(left, files)) {
    host.log(
      `Publishing the draft an earlier run left, which holds this build.`,
    );
  } else {
    if (left !== undefined) {
      host.log(
        `Deleting a draft an earlier run left, which holds other files.`,
      );
      await host.deleteDraft(left.id);
    }
    await host.createDraft(version);
    const made = await host.draft(version);
    if (made === undefined || !holdsBuild(made, files)) {
      throw new Error(
        `The draft for ${version} does not hold the built files; it stays a draft.`,
      );
    }
  }
  await host.publish(version);
  host.log(`Published ${version}.`);
}
