// The Release workflow's steps that need GitHub, as scripts/publish.ts lists
// them, with the GitHub CLI passed in, so that unit tests can run the very
// requests a release makes against a fake one. It imports only Node.js and
// lib/, so that it runs without the dependencies.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "./settings.ts";
import {
  installArchiveName,
  isPrerelease,
  releaseVersionPattern,
  versionOrderProblems,
} from "./version.ts";
import {
  ciProblems,
  publishRelease,
  requiredChecks,
  type BuiltFile,
  type CheckRun,
  type Draft,
  type ReleaseHost,
} from "./publish.ts";

/** What a run of the GitHub CLI gave. */
export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** What the steps need from where they run. */
export interface PublishContext {
  readonly repository: string;
  /** The commit to tag, which the workflow gives as GITHUB_SHA. */
  readonly commit: string | undefined;
  /** Runs the GitHub CLI with `args`. */
  gh(args: readonly string[]): CommandResult;
  /** Waits `ms` milliseconds. */
  wait(ms: number): Promise<void>;
  log(message: string): void;
}

export const publishUsage =
  "usage: publish.ts ci <commit> | order <version> | publish <version> <directory>";

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** Runs the GitHub CLI, and gives what it printed; a failure throws. */
function gh(context: PublishContext, args: readonly string[]): string {
  const result = context.gh(args);
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function ghJson(context: PublishContext, args: readonly string[]): unknown {
  return JSON.parse(gh(context, args));
}

async function ci(context: PublishContext, commit: string): Promise<void> {
  const ruleset: unknown = JSON.parse(
    await readFile(".github/rulesets/main.json", "utf8"),
  );
  const required = requiredChecks(ruleset);
  const pages = ghJson(context, [
    "api",
    "--paginate",
    "--slurp",
    `repos/${context.repository}/commits/${commit}/check-runs?per_page=100`,
  ]);
  const runs: CheckRun[] = (Array.isArray(pages) ? pages : []).flatMap(
    (page: unknown) => {
      const list = record(page)?.check_runs;
      return (Array.isArray(list) ? list : []).flatMap((run: unknown) => {
        const fields = record(run);
        const app = record(fields?.app);
        if (fields === undefined) return [];
        const { name, status, conclusion, completed_at: completedAt } = fields;
        return typeof name === "string" && typeof status === "string"
          ? [
              {
                name,
                appId: typeof app?.id === "number" ? app.id : undefined,
                status,
                conclusion: typeof conclusion === "string" ? conclusion : null,
                completedAt:
                  typeof completedAt === "string" ? completedAt : null,
              },
            ]
          : [];
      });
    },
  );
  const problems = ciProblems(required, runs, new Date());
  if (problems.length > 0) {
    throw new Error(`${commit} cannot be released:\n${problems.join("\n")}`);
  }
  context.log(
    `${commit} passed ${required.map((check) => check.context).join(", ")} within the last week.`,
  );
}

/** Every release, drafts included when the token may see them. */
function releases(context: PublishContext): readonly unknown[] {
  const pages = ghJson(context, [
    "api",
    "--paginate",
    "--slurp",
    `repos/${context.repository}/releases?per_page=100`,
  ]);
  return (Array.isArray(pages) ? pages : []).flatMap(
    (page: unknown): readonly unknown[] => {
      if (!Array.isArray(page)) return [];
      const listed: readonly unknown[] = page;
      return listed;
    },
  );
}

function order(context: PublishContext, version: string): void {
  const published = releases(context).flatMap((release) => {
    const fields = record(release);
    const tag = fields?.tag_name;
    return fields?.draft === false &&
      typeof tag === "string" &&
      releaseVersionPattern.test(tag)
      ? [tag]
      : [];
  });
  const problems = versionOrderProblems(version, published);
  if (problems.length > 0) {
    throw new Error(`${version} cannot be released:\n${problems.join("\n")}`);
  }
  context.log(
    published.includes(version)
      ? `${version} is published already; publishing resumes that build or refuses this one.`
      : `${version} is higher than all ${String(published.length)} published versions.`,
  );
}

/** The files `directory`'s SHA256SUMS lists, and that file itself. */
async function builtFiles(
  directory: string,
  version: string,
): Promise<BuiltFile[]> {
  const sums = await readFile(join(directory, "SHA256SUMS"));
  const listed = sums
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      if (match?.[1] === undefined || match[2] === undefined) {
        throw new Error(`SHA256SUMS has a line it cannot read: ${line}`);
      }
      return { name: match[2], sha256: match[1] };
    });
  const expected = [
    "main.js",
    "manifest.json",
    "styles.css",
    installArchiveName(version),
  ].sort();
  if (
    listed.length !== expected.length ||
    listed
      .map((file) => file.name)
      .sort()
      .some((name, index) => name !== expected[index])
  ) {
    throw new Error(
      "SHA256SUMS must list exactly the plugin files and versioned install ZIP",
    );
  }
  for (const file of listed) {
    const bytes = await readFile(join(directory, file.name));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== file.sha256) {
      throw new Error(`${file.name} does not match SHA256SUMS`);
    }
  }
  return [
    ...listed,
    {
      name: "SHA256SUMS",
      sha256: createHash("sha256").update(sums).digest("hex"),
    },
  ];
}

/**
 * The commit that the tag `version` names, by the tag's own ref, so that a
 * branch of the same name cannot stand in for it; an annotated tag is
 * followed to its commit. Undefined if GitHub cannot say.
 */
function taggedCommit(
  context: PublishContext,
  version: string,
): string | undefined {
  const { repository } = context;
  let target = record(
    ghJson(context, ["api", `repos/${repository}/git/ref/tags/${version}`]),
  )?.object;
  for (let depth = 0; depth < 5; depth++) {
    const object = record(target);
    if (typeof object?.sha !== "string") return undefined;
    if (object.type === "commit") return object.sha;
    if (object.type !== "tag") return undefined;
    target = record(
      ghJson(context, ["api", `repos/${repository}/git/tags/${object.sha}`]),
    )?.object;
  }
  return undefined;
}

/** A release's files, by name and the digest GitHub gives each. */
function assetsOf(release: Record<string, unknown>): Draft["assets"] {
  return (Array.isArray(release.assets) ? release.assets : [])
    .map((asset: unknown) => record(asset))
    .flatMap((asset) =>
      typeof asset?.name === "string"
        ? [
            {
              name: asset.name,
              digest:
                typeof asset.digest === "string" ? asset.digest : undefined,
            },
          ]
        : [],
    );
}

function host(
  context: PublishContext,
  directory: string,
  files: readonly BuiltFile[],
  commit: string,
): ReleaseHost {
  const { repository } = context;
  return {
    tagExists: (version) => {
      const found = context.gh([
        "api",
        `repos/${repository}/git/ref/tags/${version}`,
      ]);
      if (found.status === 0) return Promise.resolve(true);
      // Only GitHub's answer that there is no such tag means none: any other
      // failure might hide a published version.
      if (found.stderr.includes("(HTTP 404)")) return Promise.resolve(false);
      return Promise.reject(
        new Error(
          `GitHub could not say whether the tag ${version} exists: ${found.stderr.trim()}`,
        ),
      );
    },
    drafts: (version) => {
      const drafts: Draft[] = [];
      for (const release of releases(context)) {
        const fields = record(release);
        if (fields?.draft !== true || fields.tag_name !== version) continue;
        if (typeof fields.id !== "number") continue;
        const assets = assetsOf(fields);
        drafts.push({
          id: fields.id,
          target:
            typeof fields.target_commitish === "string"
              ? fields.target_commitish
              : "",
          assets,
        });
      }
      return Promise.resolve(drafts);
    },
    deleteDraft: (id) => {
      gh(context, [
        "api",
        "-X",
        "DELETE",
        `repos/${repository}/releases/${String(id)}`,
      ]);
      return Promise.resolve();
    },
    createDraft: (version) => {
      gh(context, [
        "release",
        "create",
        version,
        ...files.map((file) => join(directory, file.name)),
        "--repo",
        repository,
        "--draft",
        "--target",
        commit,
        "--title",
        `Inkline ${version}`,
        "--notes-file",
        join(directory, "release-notes.md"),
      ]);
      return Promise.resolve();
    },
    // By the draft's id, so that it is the very draft that was checked. `-F`
    // sends a JSON boolean, as `draft` and `prerelease` take; `-f` a string,
    // as `make_latest` takes.
    publish: (id, version) => {
      const prerelease = isPrerelease(version);
      gh(context, [
        "api",
        "-X",
        "PATCH",
        `repos/${repository}/releases/${String(id)}`,
        "-F",
        "draft=false",
        "-F",
        `prerelease=${String(prerelease)}`,
        "-f",
        `make_latest=${String(!prerelease)}`,
      ]);
      return Promise.resolve();
    },
    published: (version) => {
      const found = context.gh([
        "api",
        `repos/${repository}/releases/tags/${version}`,
      ]);
      if (found.status !== 0) {
        if (found.stderr.includes("(HTTP 404)")) {
          return Promise.resolve(undefined);
        }
        return Promise.reject(
          new Error(
            `GitHub could not say what ${version} holds: ${found.stderr.trim()}`,
          ),
        );
      }
      const release = record(JSON.parse(found.stdout));
      if (release === undefined || typeof release.id !== "number") {
        return Promise.reject(
          new Error(`GitHub gave no release for ${version}`),
        );
      }
      const tagged = taggedCommit(context, version);
      if (tagged === undefined) {
        return Promise.reject(
          new Error(`GitHub could not say which commit ${version} tags`),
        );
      }
      return Promise.resolve({
        id: release.id,
        target: tagged,
        assets: assetsOf(release),
      });
    },
    wait: (ms) => context.wait(ms),
    log: (message) => {
      context.log(message);
    },
  };
}

/** Runs the step that `argv` names; a failure rejects with what went wrong. */
export async function publishCommand(
  argv: readonly string[],
  context: PublishContext,
): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "ci": {
      const [commit] = rest;
      if (commit === undefined)
        throw new Error("usage: publish.ts ci <commit>");
      await ci(context, commit);
      break;
    }
    case "order": {
      const [version] = rest;
      if (version === undefined) {
        throw new Error("usage: publish.ts order <version>");
      }
      order(context, version);
      break;
    }
    case "publish": {
      const [version, directory] = rest;
      if (version === undefined || directory === undefined) {
        throw new Error("usage: publish.ts publish <version> <directory>");
      }
      const { commit } = context;
      if (commit === undefined) {
        throw new Error("GITHUB_SHA names no commit to tag");
      }
      const files = await builtFiles(directory, version);
      await publishRelease(
        host(context, directory, files, commit),
        version,
        files,
        commit,
      );
      break;
    }
    default:
      throw new Error(publishUsage);
  }
}
