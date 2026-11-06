// Runs the steps of scripts/publish.ts as the Release workflow does, down to
// the arguments of each `gh` command, against a fake of the GitHub CLI. A
// published release is immutable, and no dry run sends these requests, so a
// wrong flag would first show on a release that can never be changed.

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  publishCommand,
  publishUsage,
  type CommandResult,
  type PublishContext,
} from "../../scripts/lib/github.ts";

const repository = "viell-dev/slop-inkline";
const commit = "c0ffee".padEnd(40, "0");
const otherCommit = "bad".padEnd(40, "0");
const api = `repos/${repository}`;

interface Asset {
  readonly name: string;
  readonly digest: string;
}

interface FakeRelease {
  readonly id: number;
  readonly tag_name: string;
  readonly target_commitish: string;
  readonly assets: readonly Asset[];
  readonly draft: boolean;
  readonly prerelease: boolean;
  /** What the request that published it asked for. */
  readonly make_latest?: unknown;
}

/** One failure to come, for the command that `when` picks. */
interface Failure {
  readonly when: (args: readonly string[]) => boolean;
  readonly stderr: string;
  /** Whether GitHub carried the command out, though the run hears otherwise. */
  readonly applied?: boolean;
  /** How many files an upload that broke off left behind. */
  readonly uploaded?: number;
}

/** The fields `gh api` sends: `-F` as JSON types, `-f` as strings. */
function fieldsOf(args: readonly string[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  args.forEach((flag, index) => {
    const [key = "", value = ""] = (args[index + 1] ?? "").split("=");
    if (flag === "-f") fields[key] = value;
    if (flag === "-F") {
      fields[key] =
        value === "true" || value === "false" ? value === "true" : value;
    }
  });
  return fields;
}

const passed: CommandResult = { status: 0, stdout: "", stderr: "" };
const answer = (value: unknown): CommandResult => ({
  ...passed,
  stdout: JSON.stringify(value),
});
const refused = (stderr: string): CommandResult => ({
  status: 1,
  stdout: "",
  stderr,
});
const notFound = refused("gh: Not Found (HTTP 404)");

/** The GitHub CLI, answering as GitHub would, with a release's own rules. */
class FakeGh {
  readonly calls: string[][] = [];
  releases: FakeRelease[] = [];
  /** The commit each tag names. */
  readonly tags = new Map<string, string>();
  readonly failures: Failure[] = [];
  /** How many listings a new draft stays out of. */
  listedLate = 0;
  #nextId = 4100;

  /** The commands that change something at GitHub. */
  get writes(): string[][] {
    return this.calls.filter(
      (args) => args[0] === "release" || args.includes("-X"),
    );
  }

  run = (args: readonly string[]): CommandResult => {
    this.calls.push([...args]);
    const index = this.failures.findIndex(({ when }) => when(args));
    const failure = this.failures[index];
    if (failure !== undefined) {
      this.failures.splice(index, 1);
      if (failure.uploaded !== undefined) this.#create(args, failure.uploaded);
      if (failure.applied === true) this.#answer(args);
      return refused(failure.stderr);
    }
    return this.#answer(args);
  };

  #answer(args: readonly string[]): CommandResult {
    const [command, ...rest] = args;
    if (command === "release") {
      this.#create(args);
      return passed;
    }
    const path = rest.find((arg) => arg.startsWith("repos/")) ?? "";
    const method = rest.includes("-X") ? rest[rest.indexOf("-X") + 1] : "GET";
    if (method === "DELETE") {
      this.releases = this.releases.filter(
        (release) => !path.endsWith(`/${String(release.id)}`),
      );
      return passed;
    }
    if (method === "PATCH") return this.#publish(path, fieldsOf(args));
    if (path.startsWith(`${api}/git/ref/tags/`)) {
      const tag = path.slice(`${api}/git/ref/tags/`.length);
      const sha = this.tags.get(tag);
      return sha === undefined
        ? notFound
        : answer({ object: { type: "commit", sha } });
    }
    if (path.startsWith(`${api}/releases/tags/`)) {
      const tag = path.slice(`${api}/releases/tags/`.length);
      const release = this.releases.find(
        (candidate) => candidate.tag_name === tag && !candidate.draft,
      );
      return release === undefined ? notFound : answer(release);
    }
    if (path === `${api}/releases?per_page=100`) {
      const hidden = this.listedLate > 0 ? this.releases.at(-1)?.id : undefined;
      if (this.listedLate > 0) this.listedLate--;
      return answer([this.releases.filter((release) => release.id !== hidden)]);
    }
    throw new Error(`the fake has no answer for gh ${args.join(" ")}`);
  }

  /** `gh release create`: a draft holding the files it names. */
  #create(args: readonly string[], uploaded?: number): void {
    const version = args[2] ?? "";
    const end = args.indexOf("--repo");
    const files = args.slice(3, end).map((path) => ({
      name: basename(path),
      digest: `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`,
    }));
    this.releases.push({
      id: this.#nextId++,
      tag_name: version,
      target_commitish: args[args.indexOf("--target") + 1] ?? "",
      assets: files.slice(0, uploaded),
      draft: args.includes("--draft"),
      prerelease: false,
    });
  }

  /** PATCH of a release: publishing makes the tag, on its target. */
  #publish(path: string, fields: Record<string, unknown>): CommandResult {
    const release = this.releases.find((candidate) =>
      path.endsWith(`/${String(candidate.id)}`),
    );
    if (release === undefined) return notFound;
    const published: FakeRelease = {
      ...release,
      draft: fields.draft !== false,
      prerelease: fields.prerelease === true,
      make_latest: fields.make_latest,
    };
    this.releases = this.releases.map((candidate) =>
      candidate === release ? published : candidate,
    );
    if (!published.draft) {
      this.tags.set(release.tag_name, release.target_commitish);
    }
    return passed;
  }
}

const isPatch = (args: readonly string[]): boolean => args.includes("PATCH");
const isCreate = (args: readonly string[]): boolean =>
  args[0] === "release" && args[1] === "create";
const isTagLookup = (args: readonly string[]): boolean =>
  args.some((arg) => arg.includes("/git/ref/tags/"));

let directory: string;
let gh: FakeGh;
let waits: number[];
let messages: string[];

function context(overrides: Partial<PublishContext> = {}): PublishContext {
  return {
    repository,
    commit,
    gh: gh.run,
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    log: (message) => {
      messages.push(message);
    },
    ...overrides,
  };
}

/** Writes a release's files as the workflow's `prepare` job leaves them. */
function build(version: string): void {
  const files: Record<string, string> = {
    "main.js": `// synthetic build of ${version}\n`,
    "manifest.json": `${JSON.stringify({ id: "inkline", version })}\n`,
    "styles.css": ".synthetic {}\n",
    [`inkline-${version}.zip`]: `synthetic ZIP of ${version}\n`,
  };
  const sums = Object.entries(files).map(([name, content]) => {
    writeFileSync(join(directory, name), content);
    const digest = createHash("sha256").update(content).digest("hex");
    return `${digest}  ${name}\n`;
  });
  writeFileSync(join(directory, "SHA256SUMS"), sums.join(""));
  writeFileSync(join(directory, "release-notes.md"), "Synthetic notes.\n");
}

const publish = (version: string, overrides?: Partial<PublishContext>) =>
  publishCommand(["publish", version, directory], context(overrides));

/** What a release must hold: the four files and their checksums. */
function assetNames(version: string): string[] {
  return [
    "SHA256SUMS",
    `inkline-${version}.zip`,
    "main.js",
    "manifest.json",
    "styles.css",
  ].sort();
}

const only = (version: string): FakeRelease => {
  const found = gh.releases.filter((release) => release.tag_name === version);
  expect(found).toHaveLength(1);
  const [release] = found;
  if (release === undefined) throw new Error(`no release ${version}`);
  return release;
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "inkline-publish-"));
  gh = new FakeGh();
  waits = [];
  messages = [];
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe.each([
  { version: "1.0.0", prerelease: false, latest: "true" },
  { version: "1.2.0", prerelease: false, latest: "true" },
  { version: "0.9.1", prerelease: true, latest: "false" },
  { version: "1.1.0", prerelease: true, latest: "false" },
])("publishing $version", ({ version, prerelease, latest }) => {
  it("creates a draft of exactly the build, on the commit", async () => {
    build(version);
    await publish(version);
    const file = (name: string) => join(directory, name);
    const [create] = gh.writes;
    expect(create?.slice(0, 3)).toEqual(["release", "create", version]);
    expect(create?.slice(3, -9).sort()).toEqual(
      assetNames(version).map(file).sort(),
    );
    expect(create?.slice(-9)).toEqual([
      "--repo",
      repository,
      "--draft",
      "--target",
      commit,
      "--title",
      `Inkline ${version}`,
      "--notes-file",
      file("release-notes.md"),
    ]);
  });

  it("sends exactly the request that publishes it", async () => {
    build(version);
    await publish(version);
    const { id } = only(version);
    expect(gh.writes).toHaveLength(2);
    expect(gh.writes[1]).toEqual([
      "api",
      "-X",
      "PATCH",
      `${api}/releases/${String(id)}`,
      "-F",
      "draft=false",
      "-F",
      `prerelease=${String(prerelease)}`,
      "-f",
      `make_latest=${latest}`,
    ]);
    // In the JSON GitHub's API takes: two booleans, and a string.
    expect(fieldsOf(gh.writes[1] ?? [])).toEqual({
      draft: false,
      prerelease,
      make_latest: latest,
    });
  });

  it("leaves a published release, tagged on the commit, holding the files", async () => {
    build(version);
    await publish(version);
    const release = only(version);
    expect(release.draft).toBe(false);
    expect(release.prerelease).toBe(prerelease);
    expect(release.make_latest).toBe(latest);
    expect(gh.tags.get(version)).toBe(commit);
    expect(release.assets.map((asset) => asset.name).sort()).toEqual(
      assetNames(version),
    );
    const sums = readFileSync(join(directory, "SHA256SUMS"), "utf8");
    for (const { name, digest } of release.assets) {
      if (name !== "SHA256SUMS") {
        expect(sums).toContain(`${digest.slice("sha256:".length)}  ${name}`);
      }
    }
  });
});

describe("what it refuses before it changes anything", () => {
  it("refuses without a commit to tag", async () => {
    build("1.0.0");
    await expect(publish("1.0.0", { commit: undefined })).rejects.toThrow(
      "GITHUB_SHA names no commit to tag",
    );
    expect(gh.calls).toEqual([]);
  });

  it("refuses a file that does not match its checksum", async () => {
    build("1.0.0");
    writeFileSync(join(directory, "main.js"), "// changed afterwards\n");
    await expect(publish("1.0.0")).rejects.toThrow(
      "main.js does not match SHA256SUMS",
    );
    expect(gh.calls).toEqual([]);
  });

  it("refuses a build whose ZIP names another version", async () => {
    build("1.1.0");
    await expect(publish("1.2.0")).rejects.toThrow(
      "SHA256SUMS must list exactly the plugin files and versioned install ZIP",
    );
    expect(gh.calls).toEqual([]);
  });

  it("refuses a checksum list it cannot read", async () => {
    build("1.0.0");
    writeFileSync(join(directory, "SHA256SUMS"), "not a checksum\n");
    await expect(publish("1.0.0")).rejects.toThrow(
      "SHA256SUMS has a line it cannot read",
    );
    expect(gh.calls).toEqual([]);
  });

  it("names its commands when it has none to run", async () => {
    await expect(publishCommand([], context())).rejects.toThrow(publishUsage);
    await expect(publishCommand(["publish"], context())).rejects.toThrow(
      "usage: publish.ts publish",
    );
  });
});

describe("running again after a failure", () => {
  const version = "1.0.0";
  const publishedOnce = (): FakeRelease[] =>
    gh.releases.filter((release) => !release.draft);

  beforeEach(() => {
    build(version);
  });

  it("publishes the same draft when publishing failed, uploading nothing again", async () => {
    gh.failures.push({ when: isPatch, stderr: "gh: Bad Gateway (HTTP 502)" });
    await expect(publish(version)).rejects.toThrow("Bad Gateway");
    expect(only(version).draft).toBe(true);
    expect(gh.tags.has(version)).toBe(false);
    const { id } = only(version);

    await publish(version);
    expect(gh.calls.filter(isCreate)).toHaveLength(1);
    expect(only(version)).toMatchObject({
      id,
      draft: false,
      prerelease: false,
      make_latest: "true",
    });
  });

  it("goes on when GitHub published it but the run did not hear back", async () => {
    gh.failures.push({
      when: isPatch,
      stderr: "gh: connection reset",
      applied: true,
    });
    await expect(publish(version)).rejects.toThrow("connection reset");
    expect(only(version).draft).toBe(false);
    const before = gh.writes.length;

    await publish(version);
    expect(gh.writes).toHaveLength(before);
    expect(messages).toContain(
      `${version} is published already, from this build.`,
    );
  });

  it("replaces a draft whose upload broke off", async () => {
    gh.failures.push({
      when: isCreate,
      stderr: "gh: upload failed",
      uploaded: 2,
    });
    await expect(publish(version)).rejects.toThrow("upload failed");
    const partial = only(version);
    expect(partial.assets).toHaveLength(2);

    await publish(version);
    expect(gh.writes).toContainEqual([
      "api",
      "-X",
      "DELETE",
      `${api}/releases/${String(partial.id)}`,
    ]);
    expect(only(version).id).not.toBe(partial.id);
    expect(only(version).assets).toHaveLength(5);
    expect(only(version).draft).toBe(false);
  });

  it("replaces a draft of the same files for another commit", async () => {
    gh.failures.push({ when: isPatch, stderr: "gh: Bad Gateway (HTTP 502)" });
    await expect(publish(version, { commit: otherCommit })).rejects.toThrow(
      "Bad Gateway",
    );
    const stale = only(version);
    expect(stale.target_commitish).toBe(otherCommit);

    await publish(version);
    expect(only(version).id).not.toBe(stale.id);
    expect(only(version).target_commitish).toBe(commit);
    expect(gh.tags.get(version)).toBe(commit);
  });

  it("waits for a draft GitHub lists late, then publishes it", async () => {
    gh.listedLate = 3;
    await publish(version);
    expect(waits).toEqual([2000, 4000]);
    expect(only(version).draft).toBe(false);
  });

  it("leaves a draft GitHub never lists unpublished, and a rerun publishes it", async () => {
    gh.listedLate = 7;
    await expect(publish(version)).rejects.toThrow("lists no draft");
    expect(gh.calls.filter(isPatch)).toEqual([]);

    gh.listedLate = 0;
    await publish(version);
    expect(gh.calls.filter(isCreate)).toHaveLength(1);
    expect(only(version).draft).toBe(false);
  });

  it("never replaces a version published from anything else", async () => {
    await publish(version);
    const before = gh.writes.length;
    writeFileSync(join(directory, "main.js"), "// another build\n");
    const sums = readFileSync(join(directory, "SHA256SUMS"), "utf8").replace(
      /^[0-9a-f]{64}(?= {2}main\.js$)/m,
      createHash("sha256").update("// another build\n").digest("hex"),
    );
    writeFileSync(join(directory, "SHA256SUMS"), sums);

    await expect(publish(version)).rejects.toThrow(
      `The tag ${version} exists already`,
    );
    await expect(publish(version, { commit: otherCommit })).rejects.toThrow(
      `The tag ${version} exists already`,
    );
    expect(gh.writes).toHaveLength(before);
    expect(publishedOnce()).toHaveLength(1);
  });

  it("stops, changing nothing, when GitHub cannot say whether the tag exists", async () => {
    gh.failures.push({
      when: isTagLookup,
      stderr: "gh: Server Error (HTTP 500)",
    });
    await expect(publish(version)).rejects.toThrow(
      `GitHub could not say whether the tag ${version} exists`,
    );
    expect(gh.writes).toEqual([]);
  });

  it("stops, changing nothing more, when a draft cannot be deleted", async () => {
    gh.failures.push({
      when: isCreate,
      stderr: "gh: upload failed",
      uploaded: 1,
    });
    await expect(publish(version)).rejects.toThrow("upload failed");
    gh.failures.push({
      when: (args) => args.includes("DELETE"),
      stderr: "gh: Forbidden (HTTP 403)",
    });
    await expect(publish(version)).rejects.toThrow("Forbidden");
    expect(gh.calls.filter(isCreate)).toHaveLength(1);
    expect(gh.calls.filter(isPatch)).toEqual([]);
  });
});

describe("the order step", () => {
  const release = (tag_name: string, draft = false) => ({
    id: 1,
    tag_name,
    target_commitish: commit,
    assets: [],
    draft,
    prerelease: true,
  });

  it("compares with published versions, not drafts or other tags", async () => {
    gh.releases = [
      release("0.9.0"),
      release("0.3.0-alpha.8"),
      release("9.9.9", true),
      release("not-a-version"),
    ];
    await publishCommand(["order", "0.9.1"], context());
    expect(messages).toEqual([
      "0.9.1 is higher than all 2 published versions.",
    ]);
  });

  it("refuses a lower version, naming why", async () => {
    gh.releases = [release("0.9.0")];
    await expect(publishCommand(["order", "0.8.0"], context())).rejects.toThrow(
      "0.8.0 is not higher than 0.9.0 in SemVer's order",
    );
  });

  it("stops when GitHub gives no list", async () => {
    gh.failures.push({
      when: (args) => args.includes("--slurp"),
      stderr: "gh: Server Error (HTTP 500)",
    });
    await expect(publishCommand(["order", "0.9.1"], context())).rejects.toThrow(
      "Server Error",
    );
  });
});

describe("the ci step", () => {
  const checkRuns = (conclusion: string) =>
    answer([
      {
        check_runs: [
          "verify (ubuntu-latest)",
          "verify (windows-latest)",
          "e2e",
        ].map((name) => ({
          name,
          app: { id: 15368 },
          status: "completed",
          conclusion,
          completed_at: new Date().toISOString(),
        })),
      },
    ]);

  it("asks about the commit, and accepts its passing checks", async () => {
    const asked: string[][] = [];
    await publishCommand(
      ["ci", commit],
      context({
        gh: (args) => {
          asked.push([...args]);
          return checkRuns("success");
        },
      }),
    );
    expect(asked).toEqual([
      [
        "api",
        "--paginate",
        "--slurp",
        `${api}/commits/${commit}/check-runs?per_page=100`,
      ],
    ]);
  });

  it("refuses a commit whose required checks failed", async () => {
    await expect(
      publishCommand(
        ["ci", commit],
        context({ gh: () => checkRuns("failure") }),
      ),
    ).rejects.toThrow("e2e ended failure");
  });
});
