import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ciProblems,
  holdsBuild,
  publishRelease,
  requiredChecks,
  type BuiltFile,
  type CheckRun,
  type Draft,
  type ReleaseHost,
} from "../../scripts/lib/publish.ts";

const now = new Date("2026-11-02T12:00:00Z");
const passed = (name: string, completedAt = "2026-11-01T09:00:00Z") =>
  ({
    name,
    status: "completed",
    conclusion: "success",
    completedAt,
  }) satisfies CheckRun;

describe("requiredChecks", () => {
  it("reads the checks the repository's ruleset for main requires", () => {
    const ruleset: unknown = JSON.parse(
      readFileSync(".github/rulesets/main.json", "utf8"),
    );
    expect(requiredChecks(ruleset)).toEqual([
      "verify (ubuntu-latest)",
      "verify (windows-latest)",
      "e2e",
    ]);
  });

  it("reads none from a ruleset without them", () => {
    expect(requiredChecks({ rules: [{ type: "deletion" }] })).toEqual([]);
    expect(requiredChecks(null)).toEqual([]);
  });
});

describe("ciProblems", () => {
  const required = ["verify (ubuntu-latest)", "e2e"];

  it("accepts a commit whose required checks passed this week", () => {
    expect(
      ciProblems(
        required,
        [passed("verify (ubuntu-latest)"), passed("e2e")],
        now,
      ),
    ).toEqual([]);
  });

  it("reads only the latest run of each check", () => {
    const failed = {
      ...passed("e2e", "2026-11-01T08:00:00Z"),
      conclusion: "failure",
    };
    expect(
      ciProblems(
        required,
        [passed("verify (ubuntu-latest)"), failed, passed("e2e")],
        now,
      ),
    ).toEqual([]);
    expect(
      ciProblems(
        required,
        [
          passed("verify (ubuntu-latest)"),
          passed("e2e", "2026-11-01T07:00:00Z"),
          failed,
        ],
        now,
      ),
    ).toEqual(["e2e ended failure"]);
  });

  it("refuses a missing, running, failed, skipped, or stale check", () => {
    const running = {
      name: "e2e",
      status: "in_progress",
      conclusion: null,
      completedAt: null,
    };
    expect(ciProblems(required, [passed("e2e")], now)).toEqual([
      "verify (ubuntu-latest) has not run on this commit",
    ]);
    expect(
      ciProblems(required, [passed("verify (ubuntu-latest)"), running], now),
    ).toEqual(["e2e is still running"]);
    for (const conclusion of ["failure", "skipped", "cancelled", "neutral"]) {
      expect(
        ciProblems(
          required,
          [passed("verify (ubuntu-latest)"), { ...passed("e2e"), conclusion }],
          now,
        ),
      ).toEqual([`e2e ended ${conclusion}`]);
    }
    const [stale] = ciProblems(
      required,
      [passed("verify (ubuntu-latest)"), passed("e2e", "2026-10-25T11:00:00Z")],
      now,
    );
    expect(stale).toMatch(/^e2e last passed .* over 7 days ago/);
  });

  it("refuses when the ruleset requires nothing", () => {
    expect(ciProblems([], [], now)).toEqual(["the ruleset requires no checks"]);
  });
});

const files: BuiltFile[] = [
  { name: "main.js", sha256: "a".repeat(64) },
  { name: "manifest.json", sha256: "b".repeat(64) },
  { name: "styles.css", sha256: "c".repeat(64) },
  { name: "SHA256SUMS", sha256: "d".repeat(64) },
];
const asUploaded = (built: readonly BuiltFile[]): Draft["assets"] =>
  built.map((file) => ({ name: file.name, digest: `sha256:${file.sha256}` }));

/**
 * A GitHub with no release yet, or with what an earlier run left, which can
 * fail at a step once, as a run that stops part way would.
 */
class FakeGitHub implements ReleaseHost {
  tags = new Set<string>();
  drafts = new Map<string, Draft>();
  published: string[] = [];
  deleted: number[] = [];
  messages: string[] = [];
  failOnce: "createDraft" | "publish" | undefined;
  /** What the next draft holds, as uploaded. */
  uploads: Draft["assets"] = asUploaded(files);
  #ids = 1;

  tagExists(version: string): Promise<boolean> {
    return Promise.resolve(this.tags.has(version));
  }
  draft(version: string): Promise<Draft | undefined> {
    return Promise.resolve(this.drafts.get(version));
  }
  deleteDraft(id: number): Promise<void> {
    this.deleted.push(id);
    for (const [version, draft] of this.drafts) {
      if (draft.id === id) this.drafts.delete(version);
    }
    return Promise.resolve();
  }
  createDraft(version: string): Promise<void> {
    // A run can stop after the draft exists, part way through its uploads.
    const id = this.#ids++;
    if (this.failOnce === "createDraft") {
      this.failOnce = undefined;
      this.drafts.set(version, { id, assets: this.uploads.slice(0, 2) });
      return Promise.reject(new Error("the upload broke off"));
    }
    this.drafts.set(version, { id, assets: this.uploads });
    return Promise.resolve();
  }
  publish(version: string): Promise<void> {
    if (this.failOnce === "publish") {
      this.failOnce = undefined;
      return Promise.reject(new Error("the network went away"));
    }
    this.drafts.delete(version);
    this.tags.add(version);
    this.published.push(version);
    return Promise.resolve();
  }
  log(message: string): void {
    this.messages.push(message);
  }
}

describe("publishRelease", () => {
  it("publishes a new version with the built files", async () => {
    const github = new FakeGitHub();
    await publishRelease(github, "0.1.0", files);
    expect(github.published).toEqual(["0.1.0"]);
    expect(github.tags.has("0.1.0")).toBe(true);
    expect(github.deleted).toEqual([]);
  });

  it("refuses a version whose tag exists, changing nothing", async () => {
    const github = new FakeGitHub();
    github.tags.add("0.1.0");
    await expect(publishRelease(github, "0.1.0", files)).rejects.toThrow(
      /exists already; a correction needs a new version/,
    );
    expect(github.published).toEqual([]);
    expect(github.drafts.size).toBe(0);
  });

  it("runs again after an upload broke off, replacing the partial draft", async () => {
    const github = new FakeGitHub();
    github.failOnce = "createDraft";
    await expect(publishRelease(github, "0.1.0", files)).rejects.toThrow(
      "the upload broke off",
    );
    expect(github.drafts.get("0.1.0")?.assets).toHaveLength(2);
    expect(github.tags.size).toBe(0);
    await publishRelease(github, "0.1.0", files);
    expect(github.deleted).toEqual([1]);
    expect(github.published).toEqual(["0.1.0"]);
  });

  it("runs again after publishing failed, publishing the same draft", async () => {
    const github = new FakeGitHub();
    github.failOnce = "publish";
    await expect(publishRelease(github, "0.1.0", files)).rejects.toThrow(
      "the network went away",
    );
    expect(github.drafts.has("0.1.0")).toBe(true);
    expect(github.tags.size).toBe(0);
    await publishRelease(github, "0.1.0", files);
    expect(github.deleted).toEqual([]);
    expect(github.published).toEqual(["0.1.0"]);
    expect(github.messages[0]).toMatch(
      /earlier run left, which holds this build/,
    );
  });

  it("replaces a draft left by a build of other bytes", async () => {
    const github = new FakeGitHub();
    github.drafts.set("0.1.0", {
      id: 99,
      assets: asUploaded([
        { name: "main.js", sha256: "e".repeat(64) },
        ...files.slice(1),
      ]),
    });
    await publishRelease(github, "0.1.0", files);
    expect(github.deleted).toEqual([99]);
    expect(github.published).toEqual(["0.1.0"]);
  });

  it("leaves a draft that does not hold the built files unpublished", async () => {
    const github = new FakeGitHub();
    github.uploads = asUploaded(files).map((asset) =>
      asset.name === "styles.css" ? { ...asset, digest: undefined } : asset,
    );
    await expect(publishRelease(github, "0.1.0", files)).rejects.toThrow(
      /does not hold the built files; it stays a draft/,
    );
    expect(github.published).toEqual([]);
    expect(github.tags.size).toBe(0);
  });
});

describe("holdsBuild", () => {
  it("needs every file, by name and digest, and no other", () => {
    const draft = { id: 1, assets: asUploaded(files) };
    expect(holdsBuild(draft, files)).toBe(true);
    expect(holdsBuild({ id: 1, assets: draft.assets.slice(1) }, files)).toBe(
      false,
    );
    expect(
      holdsBuild(
        {
          id: 1,
          assets: [...draft.assets, { name: "extra.txt", digest: undefined }],
        },
        files,
      ),
    ).toBe(false);
  });
});
