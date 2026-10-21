// The Release workflow's steps that need GitHub, as RELEASING.md describes:
//
//   node scripts/publish.ts ci <commit>       fail unless the checks that
//                                             .github/rulesets/main.json
//                                             requires passed on <commit>,
//                                             within the last week
//   node scripts/publish.ts publish <version> <directory>
//                                             publish <directory>'s files,
//                                             listed in its SHA256SUMS, as
//                                             <version>, resuming a run that
//                                             failed part way
//
// It needs GH_TOKEN and GITHUB_REPOSITORY, as the workflow gives them, and,
// to publish, GITHUB_SHA, the commit to tag, and the GitHub CLI. It imports
// only Node.js and lib/, so that it runs without the dependencies.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "./lib/settings.ts";
import {
  ciProblems,
  publishRelease,
  requiredChecks,
  type BuiltFile,
  type CheckRun,
  type Draft,
  type ReleaseHost,
} from "./lib/publish.ts";

const repository = process.env.GITHUB_REPOSITORY ?? "viell-dev/slop-inkline";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** Runs the GitHub CLI; its output, or undefined if it failed. */
function gh(args: readonly string[]): string | undefined {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    if (result.stderr !== "") console.error(result.stderr.trim());
    return undefined;
  }
  return result.stdout;
}

function ghJson(args: readonly string[]): unknown {
  const output = gh(args);
  if (output === undefined) fail(`gh ${args.join(" ")} failed`);
  return JSON.parse(output);
}

/** GitHub Actions, the app whose checks the ruleset requires. */
const actionsApp = 15368;

async function ci(commit: string): Promise<void> {
  const ruleset: unknown = JSON.parse(
    await readFile(".github/rulesets/main.json", "utf8"),
  );
  const required = requiredChecks(ruleset);
  const pages = ghJson([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repository}/commits/${commit}/check-runs?per_page=100`,
  ]);
  const runs: CheckRun[] = (Array.isArray(pages) ? pages : []).flatMap(
    (page: unknown) => {
      const list = record(page)?.check_runs;
      return (Array.isArray(list) ? list : []).flatMap((run: unknown) => {
        const fields = record(run);
        const app = record(fields?.app);
        if (fields === undefined || app?.id !== actionsApp) return [];
        const { name, status, conclusion, completed_at: completedAt } = fields;
        return typeof name === "string" && typeof status === "string"
          ? [
              {
                name,
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
    fail(`${commit} cannot be released:\n${problems.join("\n")}`);
  }
  console.log(`${commit} passed ${required.join(", ")} within the last week.`);
}

/** The files `directory`'s SHA256SUMS lists, and that file itself. */
async function builtFiles(directory: string): Promise<BuiltFile[]> {
  const sums = await readFile(join(directory, "SHA256SUMS"));
  const listed = sums
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      if (match?.[1] === undefined || match[2] === undefined) {
        fail(`SHA256SUMS has a line it cannot read: ${line}`);
      }
      return { name: match[2], sha256: match[1] };
    });
  for (const file of listed) {
    const bytes = await readFile(join(directory, file.name));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== file.sha256) fail(`${file.name} does not match SHA256SUMS`);
  }
  return [
    ...listed,
    {
      name: "SHA256SUMS",
      sha256: createHash("sha256").update(sums).digest("hex"),
    },
  ];
}

function host(directory: string, files: readonly BuiltFile[]): ReleaseHost {
  const commit = process.env.GITHUB_SHA;
  if (commit === undefined) fail("GITHUB_SHA names no commit to tag");
  return {
    tagExists: (version) =>
      Promise.resolve(
        gh(["api", `repos/${repository}/git/ref/tags/${version}`]) !==
          undefined,
      ),
    draft: (version) => {
      const pages = ghJson([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repository}/releases?per_page=100`,
      ]);
      const releases = (Array.isArray(pages) ? pages : []).flatMap(
        (page: unknown): readonly unknown[] => {
          if (!Array.isArray(page)) return [];
          const listed: readonly unknown[] = page;
          return listed;
        },
      );
      for (const release of releases) {
        const fields = record(release);
        if (fields?.draft !== true || fields.tag_name !== version) continue;
        if (typeof fields.id !== "number") continue;
        const assets = (Array.isArray(fields.assets) ? fields.assets : [])
          .map((asset: unknown) => record(asset))
          .flatMap((asset) =>
            typeof asset?.name === "string"
              ? [
                  {
                    name: asset.name,
                    digest:
                      typeof asset.digest === "string"
                        ? asset.digest
                        : undefined,
                  },
                ]
              : [],
          );
        const draft: Draft = { id: fields.id, assets };
        return Promise.resolve(draft);
      }
      return Promise.resolve(undefined);
    },
    deleteDraft: (id) => {
      if (
        gh([
          "api",
          "-X",
          "DELETE",
          `repos/${repository}/releases/${String(id)}`,
        ]) === undefined
      ) {
        fail(`could not delete draft ${String(id)}`);
      }
      return Promise.resolve();
    },
    createDraft: (version) => {
      const created = gh([
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
      if (created === undefined) fail(`could not create the draft ${version}`);
      return Promise.resolve();
    },
    publish: (version) => {
      // Versions below 1.0.0 are prereleases, which BRAT installs.
      const kind = version.startsWith("0.")
        ? ["--prerelease", "--latest=false"]
        : ["--latest"];
      const published = gh([
        "release",
        "edit",
        version,
        "--repo",
        repository,
        "--draft=false",
        ...kind,
      ]);
      if (published === undefined) fail(`could not publish ${version}`);
      return Promise.resolve();
    },
    log: (message) => {
      console.log(message);
    },
  };
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "ci": {
    const [commit] = rest;
    if (commit === undefined) fail("usage: publish.ts ci <commit>");
    await ci(commit);
    break;
  }
  case "publish": {
    const [version, directory] = rest;
    if (version === undefined || directory === undefined) {
      fail("usage: publish.ts publish <version> <directory>");
    }
    const files = await builtFiles(directory);
    await publishRelease(host(directory, files), version, files).catch(
      (error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      },
    );
    break;
  }
  default:
    fail("usage: publish.ts ci <commit> | publish <version> <directory>");
}
