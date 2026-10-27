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
import { setTimeout as sleep } from "node:timers/promises";
import { isRecord } from "./lib/settings.ts";
import { installArchiveName, isPrerelease } from "./lib/version.ts";
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

/** Runs the GitHub CLI: its output, or undefined if it failed. */
function gh(args: readonly string[]): string | undefined {
  const result = ghRun(args);
  if (result.status !== 0) {
    if (result.stderr !== "") console.error(result.stderr.trim());
    return undefined;
  }
  return result.stdout;
}

function ghRun(args: readonly string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return result;
}

function ghJson(args: readonly string[]): unknown {
  const output = gh(args);
  if (output === undefined) fail(`gh ${args.join(" ")} failed`);
  return JSON.parse(output);
}

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
    fail(`${commit} cannot be released:\n${problems.join("\n")}`);
  }
  console.log(
    `${commit} passed ${required.map((check) => check.context).join(", ")} within the last week.`,
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
        fail(`SHA256SUMS has a line it cannot read: ${line}`);
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
    fail(
      "SHA256SUMS must list exactly the plugin files and versioned install ZIP",
    );
  }
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

/**
 * The commit that the tag `version` names, by the tag's own ref, so that a
 * branch of the same name cannot stand in for it; an annotated tag is
 * followed to its commit. Undefined if GitHub cannot say.
 */
function taggedCommit(version: string): string | undefined {
  let target = record(
    ghJson(["api", `repos/${repository}/git/ref/tags/${version}`]),
  )?.object;
  for (let depth = 0; depth < 5; depth++) {
    const object = record(target);
    if (typeof object?.sha !== "string") return undefined;
    if (object.type === "commit") return object.sha;
    if (object.type !== "tag") return undefined;
    target = record(
      ghJson(["api", `repos/${repository}/git/tags/${object.sha}`]),
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
  directory: string,
  files: readonly BuiltFile[],
  commit: string,
): ReleaseHost {
  return {
    tagExists: (version) => {
      const found = ghRun([
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
      const drafts: Draft[] = [];
      for (const release of releases) {
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
    // By the draft's id, so that it is the very draft that was checked.
    publish: (id, version) => {
      const prerelease = isPrerelease(version);
      const published = gh([
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
      if (published === undefined) fail(`could not publish ${version}`);
      return Promise.resolve();
    },
    published: (version) => {
      const found = ghRun([
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
      const commit = taggedCommit(version);
      if (commit === undefined) {
        return Promise.reject(
          new Error(`GitHub could not say which commit ${version} tags`),
        );
      }
      return Promise.resolve({
        id: release.id,
        target: commit,
        assets: assetsOf(release),
      });
    },
    wait: async (ms) => {
      await sleep(ms);
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
    const commit = process.env.GITHUB_SHA;
    if (commit === undefined) fail("GITHUB_SHA names no commit to tag");
    const files = await builtFiles(directory, version);
    await publishRelease(
      host(directory, files, commit),
      version,
      files,
      commit,
    ).catch((error: unknown) => {
      fail(error instanceof Error ? error.message : String(error));
    });
    break;
  }
  default:
    fail("usage: publish.ts ci <commit> | publish <version> <directory>");
}
