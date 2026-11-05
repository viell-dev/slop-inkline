// Runs the rollback that RELEASING.md gives, command by command as it stands
// there, in a synthetic repository, and puts each state through the checks CI
// runs. The guide's commands are the ones that run, so it cannot drift from
// this: a rollback that CI refuses would leave main offering a release that
// does not exist, with nothing able to merge.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  metadataProblems,
  releaseProblems,
  syncMetadata,
  type Metadata,
} from "../../scripts/lib/release.ts";
import { versionOrderProblems } from "../../scripts/lib/version.ts";

const heading = "### If a public release cannot be published";

/** The commands of each `sh` block in the guide's section on the rollback. */
function guideCommands(): string[][] {
  const guide = readFileSync("RELEASING.md", "utf8").replaceAll("\r\n", "\n");
  const start = guide.indexOf(`${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const body = guide.slice(start + heading.length);
  const section = body.slice(0, body.search(/^#{2,3} /m));
  return [...section.matchAll(/^```sh\n([\s\S]*?)^```$/gm)].map((match) =>
    (match[1] ?? "").split("\n").filter((line) => line.trim() !== ""),
  );
}

let directory: string;

function git(...args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Synthetic",
      GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
      GIT_COMMITTER_NAME: "Synthetic",
      GIT_COMMITTER_EMAIL: "synthetic@example.invalid",
      // Nothing of the machine's own Git settings, and no editor for messages.
      GIT_CONFIG_GLOBAL: join(directory, "no-such-config"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_EDITOR: "true",
    },
  }).trim();
}

/** Runs a line of the guide, with its placeholders filled in. */
function runLine(line: string, values: Record<string, string>): void {
  const [command, ...args] = line
    .replace(/<[a-z-]+>/g, (name) => {
      const value = values[name];
      if (value === undefined) throw new Error(`no value for ${name}`);
      return value;
    })
    .split(/\s+/);
  expect(command, line).toBe("git");
  git(...args);
}

function read(name: string): unknown {
  return JSON.parse(readFileSync(join(directory, name), "utf8"));
}

function metadata(): Metadata {
  return {
    packageJson: read("package.json"),
    manifest: read("manifest.json"),
    versions: read("versions.json"),
  };
}

const changelog = (): string =>
  readFileSync(join(directory, "CHANGELOG.md"), "utf8");

function writeJson(name: string, value: unknown): void {
  writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

function setPackageVersion(version: string): void {
  writeJson("package.json", { name: "inkline", version });
  writeJson("package-lock.json", {
    name: "inkline",
    version,
    packages: { "": { name: "inkline", version } },
  });
}

/** Merges `branch` into main as a pull request does, and gives the merge. */
function mergeToMain(branch: string): string {
  git("switch", "main");
  git("merge", "--no-ff", "--no-edit", branch);
  git("update-ref", "refs/remotes/origin/main", "main");
  return git("rev-parse", "HEAD");
}

/** Prepares `version` as the guide's steps do, and merges it. */
function mergePreparation(version: string): string {
  git("switch", "--create", `prepare-${version}`);
  setPackageVersion(version);
  const manifest = read("manifest.json") as Record<string, unknown>;
  const versions = read("versions.json") as Record<string, unknown>;
  const synced = syncMetadata(version, manifest, versions);
  writeJson("manifest.json", synced.manifest);
  writeJson("versions.json", synced.versions);
  writeFileSync(
    join(directory, "CHANGELOG.md"),
    changelog().replace(
      "## Unreleased\n",
      `## Unreleased\n\n## ${version} - 2026-11-06\n\n- Synthetic notes.\n`,
    ),
  );
  git("add", "--all");
  git("commit", "--message", `Prepare ${version}`);
  return mergeToMain(`prepare-${version}`);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "inkline-rollback-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe.each([
  {
    name: "a later public release, from a line of pre-releases",
    built: "1.1.3",
    offered: "1.0.0",
    versions: { "1.0.0": "1.13.4" },
    release: "1.2.0",
  },
  {
    name: "the first public release",
    built: "0.9.4",
    offered: "0.9.0",
    versions: {},
    release: "1.0.0",
  },
  {
    name: "a patch of the last public release",
    built: "1.2.0",
    offered: "1.2.0",
    versions: { "1.0.0": "1.13.4", "1.2.0": "1.13.4" },
    release: "1.2.1",
  },
])("the rollback of $name", ({ built, offered, versions, release }) => {
  beforeEach(() => {
    git("init", "--initial-branch=main");
    setPackageVersion(built);
    writeJson("manifest.json", {
      id: "inkline",
      version: offered,
      minAppVersion: "1.13.4",
    });
    writeJson("versions.json", versions);
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      `# Changelog\n\n## Unreleased\n\n## ${built} - 2026-11-01\n\n- Published.\n`,
    );
    git("add", "--all");
    git("commit", "--message", "The state before the release");
    git("tag", built);
    git("update-ref", "refs/remotes/origin/main", "main");
  });

  it("passes CI's checks at each step, and touches no published version", () => {
    const blocks = guideCommands();
    expect(blocks).toHaveLength(2);
    const [rollback = [], resume = []] = blocks;
    const before = metadata();
    const notes = changelog();
    expect(metadataProblems(before)).toEqual([]);

    // The release merges, and main offers a version with no release.
    const merge = mergePreparation(release);
    expect(releaseProblems(metadata(), changelog(), release)).toEqual([]);
    expect(metadata().manifest).toMatchObject({ version: release });

    // Reverting the manifest and the map alone fails CI, as the guide says.
    git("restore", `--source=${merge}^1`, "manifest.json", "versions.json");
    expect(metadataProblems(metadata())).not.toEqual([]);
    git("restore", "manifest.json", "versions.json");

    // The guide's rollback, merged as a pull request is.
    for (const line of rollback) {
      runLine(line, { "<version>": release, "<merge-commit>": merge });
    }
    const revert = git("rev-parse", "HEAD");
    expect(metadataProblems(metadata())).toEqual([]);
    expect(metadata()).toEqual(before);
    expect(read("package-lock.json")).toMatchObject({ version: built });
    expect(changelog()).toBe(notes);
    expect(releaseProblems(metadata(), changelog(), built)).toEqual([]);
    mergeToMain(`revert-${release}`);
    expect(metadata()).toEqual(before);

    // The guide's way back, which restores the preparation whole.
    for (const line of resume) {
      runLine(line, { "<version>": release, "<revert-commit>": revert });
    }
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe(
      `prepare-${release}-again`,
    );
    expect(releaseProblems(metadata(), changelog(), release)).toEqual([]);
    expect(read("package-lock.json")).toMatchObject({ version: release });
    expect(versionOrderProblems(release, [offered, built])).toEqual([]);

    // Nothing published moved: the only tag still names the same commit.
    expect(git("tag", "--list")).toBe(built);
    expect(git("rev-parse", `${built}^{commit}`)).toBe(
      git("rev-parse", `${merge}^1`),
    );
  }, 30_000);
});
