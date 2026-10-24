import { describe, expect, it } from "vitest";
import { deploymentFiles, docsSource } from "../../scripts/lib/docs.ts";

describe("docsSource", () => {
  it("keeps the existing site while the first release is prepared but unpublished", () => {
    for (const event of ["push", "dispatch"] as const) {
      expect(
        docsSource({
          event,
          ref: "main",
          refType: "branch",
          releases: [],
          version: "0.1.0",
        }),
      ).toMatchObject({ deploy: false, error: false });
    }
    expect(
      docsSource({
        event: "dispatch",
        ref: "0.1.0",
        refType: "tag",
        releases: ["0.1.0"],
        version: "0.1.0",
      }),
    ).toEqual({ deploy: true, ref: "0.1.0", version: "0.1.0" });
  });

  it("deploys main, as unreleased, before the first release", () => {
    for (const event of ["push", "dispatch"] as const) {
      expect(
        docsSource({
          version: "0.0.0",
          event,
          ref: "main",
          refType: "branch",
          releases: [],
        }),
      ).toEqual({ deploy: true, ref: "main", version: "unreleased" });
    }
  });

  it("refuses any other ref before the first release", () => {
    for (const [ref, refType] of [
      ["docs-site", "branch"],
      ["0.1.0", "tag"],
      ["docs-0.1.0", "branch"],
      ["main", "tag"],
    ] as const) {
      expect(
        docsSource({
          version: "0.0.0",
          event: "dispatch",
          ref,
          refType,
          releases: [],
        }),
      ).toMatchObject({ deploy: false, error: true });
    }
  });

  it("leaves the newest release's site alone when main changes", () => {
    expect(
      docsSource({
        version: "0.0.0",
        event: "push",
        ref: "main",
        refType: "branch",
        releases: ["0.2.0", "0.1.0"],
      }),
    ).toMatchObject({ deploy: false, error: false });
  });

  it("deploys the newest release when run on its tag", () => {
    expect(
      docsSource({
        version: "0.0.0",
        event: "dispatch",
        ref: "0.2.0",
        refType: "tag",
        releases: ["0.2.0", "0.1.0"],
      }),
    ).toEqual({ deploy: true, ref: "0.2.0", version: "0.2.0" });
  });

  it("refuses an older release, main, another branch, or a branch named like the release", () => {
    for (const [ref, refType] of [
      ["0.1.0", "tag"],
      ["main", "branch"],
      ["docs-0.1.0", "branch"],
      ["feature", "branch"],
      ["0.2.0", "branch"],
      ["docs-0.2.0", "tag"],
    ] as const) {
      expect(
        docsSource({
          version: "0.0.0",
          event: "dispatch",
          ref,
          refType,
          releases: ["0.2.0", "0.1.0"],
        }),
      ).toMatchObject({ deploy: false, error: true });
    }
  });

  it("deploys a correction branch that holds the tag and changes docs, or the deployment", () => {
    for (const changed of [
      ["docs/install.md"],
      ["docs/a.md", ...deploymentFiles],
    ]) {
      expect(
        docsSource({
          version: "0.0.0",
          event: "dispatch",
          ref: "docs-0.2.0",
          refType: "branch",
          releases: ["0.2.0"],
          branch: { containsTag: true, changed },
        }),
      ).toEqual({ deploy: true, ref: "docs-0.2.0", version: "0.2.0" });
    }
  });

  it("refuses a correction branch that changes code or lacks the tag", () => {
    const releases = ["0.2.0"];
    for (const branch of [
      { containsTag: true, changed: ["docs/install.md", "src/main.ts"] },
      { containsTag: true, changed: ["package.json"] },
      { containsTag: false, changed: ["docs/install.md"] },
    ]) {
      expect(
        docsSource({
          version: "0.0.0",
          event: "dispatch",
          ref: "docs-0.2.0",
          refType: "branch",
          releases,
          branch,
        }),
      ).toMatchObject({ deploy: false, error: true });
    }
    expect(
      docsSource({
        version: "0.0.0",
        event: "dispatch",
        ref: "docs-0.2.0",
        refType: "branch",
        releases,
      }),
    ).toMatchObject({ deploy: false, error: true });
  });

  it("names the files outside the documentation that a branch changes", () => {
    const source = docsSource({
      version: "0.0.0",
      event: "dispatch",
      ref: "docs-0.2.0",
      refType: "branch",
      releases: ["0.2.0"],
      branch: { containsTag: true, changed: ["docs/a.md", "src/main.ts"] },
    });
    expect(source.deploy ? "" : source.reason).toContain("src/main.ts");
  });
});
