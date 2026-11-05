import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ciProblems,
  draftListingWait,
  draftListings,
  holdsBuild,
  publishRelease,
  requiredChecks,
  type BuiltFile,
  type CheckRun,
  type Draft,
  type ReleaseHost,
  type RequiredCheck,
} from "../../scripts/lib/publish.ts";

const actions = 15368;
const now = new Date("2026-11-02T12:00:00Z");
const passed = (name: string, completedAt = "2026-11-01T09:00:00Z") =>
  ({
    name,
    appId: actions,
    status: "completed",
    conclusion: "success",
    completedAt,
  }) satisfies CheckRun;

describe("requiredChecks", () => {
  it("reads the checks the repository's ruleset for main requires, by app", () => {
    const ruleset: unknown = JSON.parse(
      readFileSync(".github/rulesets/main.json", "utf8"),
    );
    expect(requiredChecks(ruleset)).toEqual([
      { context: "verify (ubuntu-latest)", integrationId: actions },
      { context: "verify (windows-latest)", integrationId: actions },
      { context: "e2e", integrationId: actions },
    ]);
  });

  it("reads none from a ruleset without them", () => {
    expect(requiredChecks({ rules: [{ type: "deletion" }] })).toEqual([]);
    expect(requiredChecks(null)).toEqual([]);
  });
});

describe("ciProblems", () => {
  const required: RequiredCheck[] = [
    { context: "verify (ubuntu-latest)", integrationId: actions },
    { context: "e2e", integrationId: actions },
  ];

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

  it("counts only runs by the app the ruleset names", () => {
    const other = { ...passed("e2e"), appId: 999 };
    expect(
      ciProblems(required, [passed("verify (ubuntu-latest)"), other], now),
    ).toEqual(["e2e has not run on this commit"]);
  });

  it("refuses a missing, running, failed, skipped, or stale check", () => {
    const running = {
      name: "e2e",
      appId: actions,
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
    // A run started again after a pass counts as running, not passed.
    expect(
      ciProblems(
        required,
        [passed("verify (ubuntu-latest)"), passed("e2e"), running],
        now,
      ),
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

const commit = "c".repeat(40);
const files: BuiltFile[] = [
  { name: "main.js", sha256: "a".repeat(64) },
  { name: "manifest.json", sha256: "b".repeat(64) },
  { name: "styles.css", sha256: "c".repeat(64) },
  { name: "SHA256SUMS", sha256: "d".repeat(64) },
];
const asUploaded = (built: readonly BuiltFile[]): Draft["assets"] =>
  built.map((file) => ({ name: file.name, digest: `sha256:${file.sha256}` }));

/**
 * A GitHub with no release yet, or with what earlier runs left, which can
 * fail at a step once, as a run that stops part way would.
 */
class FakeGitHub implements ReleaseHost {
  tags = new Set<string>();
  drafts_ = new Map<string, Draft[]>();
  publishedIds: number[] = [];
  deleted: number[] = [];
  messages: string[] = [];
  /** Published releases, by version. */
  releases = new Map<string, Draft>();
  failOnce:
    "createDraft" | "publish" | "tagExists" | "publishUnseen" | undefined;
  /** What the next draft holds, as uploaded, and the commit it targets. */
  uploads: Draft["assets"] = asUploaded(files);
  target = commit;
  /**
   * How many listings leave out the draft made last, even one a run before,
   * as GitHub's list can lag behind a release it has just made.
   */
  listedLate = 0;
  /** How many listings after a deletion still show the deleted drafts. */
  deletedListed = 0;
  waits: number[] = [];
  #ids = 1;
  #left = 100;
  #unlisted: number | undefined;
  #deleted = new Map<string, Draft[]>();

  leave(version: string, draft: Omit<Draft, "id">): number {
    const id = this.#left++;
    this.drafts_.set(version, [
      ...(this.drafts_.get(version) ?? []),
      { ...draft, id },
    ]);
    return id;
  }
  tagExists(version: string): Promise<boolean> {
    if (this.failOnce === "tagExists") {
      this.failOnce = undefined;
      return Promise.reject(new Error("GitHub answered 502"));
    }
    return Promise.resolve(this.tags.has(version));
  }
  drafts(version: string): Promise<readonly Draft[]> {
    let all = this.drafts_.get(version) ?? [];
    const deleted = this.#deleted.get(version) ?? [];
    if (this.deletedListed > 0 && deleted.length > 0) {
      this.deletedListed--;
      all = [...deleted, ...all];
    }
    if (this.#unlisted !== undefined && this.listedLate > 0) {
      this.listedLate--;
      const hidden = this.#unlisted;
      return Promise.resolve(all.filter((draft) => draft.id !== hidden));
    }
    return Promise.resolve(all);
  }
  deleteDraft(id: number): Promise<void> {
    this.deleted.push(id);
    for (const [version, drafts] of this.drafts_) {
      this.#deleted.set(version, [
        ...(this.#deleted.get(version) ?? []),
        ...drafts.filter((draft) => draft.id === id),
      ]);
      this.drafts_.set(
        version,
        drafts.filter((draft) => draft.id !== id),
      );
    }
    return Promise.resolve();
  }
  createDraft(version: string): Promise<void> {
    const id = this.#ids++;
    const existing = this.drafts_.get(version) ?? [];
    // A run can stop after the draft exists, part way through its uploads.
    if (this.failOnce === "createDraft") {
      this.failOnce = undefined;
      this.drafts_.set(version, [
        ...existing,
        { id, target: this.target, assets: this.uploads.slice(0, 2) },
      ]);
      return Promise.reject(new Error("the upload broke off"));
    }
    this.drafts_.set(version, [
      ...existing,
      { id, target: this.target, assets: this.uploads },
    ]);
    this.#unlisted = id;
    return Promise.resolve();
  }
  publish(id: number, version: string): Promise<void> {
    if (this.failOnce === "publish") {
      this.failOnce = undefined;
      return Promise.reject(new Error("the network went away"));
    }
    const drafts = this.drafts_.get(version) ?? [];
    const draft = drafts.find((candidate) => candidate.id === id);
    // GitHub answers 404 for a release that is not there, as a deleted one.
    if (draft === undefined) {
      return Promise.reject(new Error(`GitHub has no release ${String(id)}`));
    }
    this.releases.set(version, draft);
    this.drafts_.set(
      version,
      drafts.filter((candidate) => candidate.id !== id),
    );
    this.tags.add(version);
    this.publishedIds.push(id);
    // GitHub published it, but the run did not hear back.
    if (this.failOnce === "publishUnseen") {
      this.failOnce = undefined;
      return Promise.reject(new Error("the answer never came"));
    }
    return Promise.resolve();
  }
  published(version: string): Promise<Draft | undefined> {
    return Promise.resolve(this.releases.get(version));
  }
  wait(ms: number): Promise<void> {
    this.waits.push(ms);
    return Promise.resolve();
  }
  log(message: string): void {
    this.messages.push(message);
  }
}

describe("publishRelease", () => {
  it("publishes a new version with the built files", async () => {
    const github = new FakeGitHub();
    await publishRelease(github, "0.1.0", files, commit);
    expect(github.publishedIds).toEqual([1]);
    expect(github.tags.has("0.1.0")).toBe(true);
    expect(github.deleted).toEqual([]);
    expect(github.waits).toEqual([]);
  });

  it("waits for GitHub to list a draft it has just made", async () => {
    const github = new FakeGitHub();
    github.listedLate = 2;
    await publishRelease(github, "0.1.0", files, commit);
    expect(github.publishedIds).toEqual([1]);
    expect(github.waits).toEqual([draftListingWait, draftListingWait * 2]);
  });

  it("refuses a draft GitHub never lists, publishing nothing", async () => {
    const github = new FakeGitHub();
    github.listedLate = draftListings;
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow(
      /GitHub lists no draft, even after waiting 20 seconds; run again.*It stays unpublished/,
    );
    expect(github.publishedIds).toEqual([]);
    expect(github.waits).toHaveLength(draftListings - 1);
  });

  it("refuses at once when GitHub still lists a deleted draft beside the new one", async () => {
    const github = new FakeGitHub();
    const old = github.leave("0.1.0", {
      target: commit,
      assets: asUploaded(files).slice(0, 2),
    });
    github.deletedListed = 1;
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow(/is not the build of/);
    expect(github.deleted).toEqual([old]);
    expect(github.publishedIds).toEqual([]);
    expect(github.waits).toEqual([]);
  });

  it("refuses more than one listed draft, even ones holding this build", async () => {
    // Two drafts of this build, as two broken runs can leave: both are
    // deleted, and a lagging list still shows them beside the new one.
    const github = new FakeGitHub();
    const first = github.leave("0.1.0", {
      target: commit,
      assets: asUploaded(files),
    });
    const second = github.leave("0.1.0", {
      target: commit,
      assets: asUploaded(files),
    });
    github.deletedListed = 1;
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow(/is not the build of/);
    expect(github.deleted).toEqual([first, second]);
    expect(github.publishedIds).toEqual([]);
  });

  it("refuses at once a draft listed with other files, without waiting", async () => {
    const github = new FakeGitHub();
    github.uploads = asUploaded(files).slice(0, 2);
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow(/is not the build of/);
    expect(github.publishedIds).toEqual([]);
    expect(github.waits).toEqual([]);
  });

  it("refuses a version whose tag exists, changing nothing", async () => {
    const github = new FakeGitHub();
    github.tags.add("0.1.0");
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow(/exists already; a correction needs a new version/);
    expect(github.publishedIds).toEqual([]);
    expect(github.drafts_.size).toBe(0);
  });

  it("goes on to verify a version that publishing reached, though the run did not hear back", async () => {
    const github = new FakeGitHub();
    github.failOnce = "publishUnseen";
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow("the answer never came");
    expect(github.tags.has("0.1.0")).toBe(true);
    await publishRelease(github, "0.1.0", files, commit);
    expect(github.publishedIds).toEqual([1]);
    expect(github.messages.at(-1)).toMatch(
      /published already, from this build/,
    );
  });

  it("refuses a published version of other bytes, or from another commit", async () => {
    for (const release of [
      {
        id: 7,
        target: commit,
        assets: asUploaded([
          { name: "main.js", sha256: "e".repeat(64) },
          ...files.slice(1),
        ]),
      },
      { id: 7, target: "f".repeat(40), assets: asUploaded(files) },
    ]) {
      const github = new FakeGitHub();
      github.tags.add("0.1.0");
      github.releases.set("0.1.0", release);
      await expect(
        publishRelease(github, "0.1.0", files, commit),
      ).rejects.toThrow(/exists already; a correction needs a new version/);
      expect(github.publishedIds).toEqual([]);
    }
  });

  it("stops, changing nothing, when GitHub cannot say whether the tag exists", async () => {
    const github = new FakeGitHub();
    github.failOnce = "tagExists";
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow("GitHub answered 502");
    expect(github.publishedIds).toEqual([]);
    expect(github.drafts_.size).toBe(0);
  });

  it("runs again after an upload broke off, replacing the partial draft", async () => {
    const github = new FakeGitHub();
    github.failOnce = "createDraft";
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow("the upload broke off");
    expect(github.drafts_.get("0.1.0")?.[0]?.assets).toHaveLength(2);
    expect(github.tags.size).toBe(0);
    await publishRelease(github, "0.1.0", files, commit);
    expect(github.deleted).toEqual([1]);
    expect(github.publishedIds).toEqual([2]);
  });

  it("runs again after publishing failed, publishing the same draft", async () => {
    const github = new FakeGitHub();
    github.failOnce = "publish";
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow("the network went away");
    expect(github.drafts_.get("0.1.0")).toHaveLength(1);
    expect(github.tags.size).toBe(0);
    await publishRelease(github, "0.1.0", files, commit);
    expect(github.deleted).toEqual([]);
    expect(github.publishedIds).toEqual([1]);
    expect(github.messages[0]).toMatch(
      /earlier run left, which holds this build/,
    );
  });

  it("replaces a draft of other bytes, or of the same bytes from another commit", async () => {
    for (const left of [
      {
        target: commit,
        assets: asUploaded([
          { name: "main.js", sha256: "e".repeat(64) },
          ...files.slice(1),
        ]),
      },
      { target: "f".repeat(40), assets: asUploaded(files) },
    ]) {
      const github = new FakeGitHub();
      const id = github.leave("0.1.0", left);
      await publishRelease(github, "0.1.0", files, commit);
      expect(github.deleted).toEqual([id]);
      expect(github.publishedIds).toEqual([1]);
      expect(github.messages[0]).toContain(`Deleting the draft ${String(id)}`);
    }
  });

  it("replaces two drafts for the version, even one that holds the build", async () => {
    const github = new FakeGitHub();
    const good = github.leave("0.1.0", {
      target: commit,
      assets: asUploaded(files),
    });
    const partial = github.leave("0.1.0", {
      target: commit,
      assets: asUploaded(files).slice(0, 1),
    });
    await publishRelease(github, "0.1.0", files, commit);
    expect(github.deleted).toEqual([good, partial]);
    expect(github.publishedIds).toEqual([1]);
  });

  it("leaves a draft that is not the build unpublished, and says what it holds", async () => {
    const github = new FakeGitHub();
    github.uploads = asUploaded(files).map((asset) =>
      asset.name === "styles.css" ? { ...asset, digest: undefined } : asset,
    );
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow(
      /is not the build of c+: GitHub has draft 1 for c+, with .*styles\.css \(no digest\).* It stays unpublished\./,
    );
    expect(github.publishedIds).toEqual([]);
    expect(github.tags.size).toBe(0);
  });

  it("leaves a draft for another commit unpublished", async () => {
    const github = new FakeGitHub();
    github.target = "f".repeat(40);
    await expect(
      publishRelease(github, "0.1.0", files, commit),
    ).rejects.toThrow(/is not the build of c+/);
    expect(github.publishedIds).toEqual([]);
  });
});

describe("holdsBuild", () => {
  it("needs every file, by name and digest, and no other", () => {
    const draft = { id: 1, target: commit, assets: asUploaded(files) };
    expect(holdsBuild(draft, files)).toBe(true);
    expect(holdsBuild({ ...draft, assets: draft.assets.slice(1) }, files)).toBe(
      false,
    );
    expect(
      holdsBuild(
        {
          ...draft,
          assets: [...draft.assets, { name: "extra.txt", digest: undefined }],
        },
        files,
      ),
    ).toBe(false);
  });
});
