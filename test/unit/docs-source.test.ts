import { describe, expect, it } from "vitest";
import { docsSource } from "../../scripts/lib/docs.ts";

describe("docsSource", () => {
  it("deploys main, as unreleased, before the first release", () => {
    for (const event of ["push", "dispatch"] as const) {
      expect(docsSource({ event, ref: "main", releases: [] })).toEqual({
        deploy: true,
        ref: "main",
        version: "unreleased",
      });
    }
  });

  it("refuses any other ref before the first release", () => {
    const source = docsSource({
      event: "dispatch",
      ref: "docs-site",
      releases: [],
    });
    expect(source).toMatchObject({ deploy: false, error: true });
  });

  it("leaves the newest release's site alone when main changes", () => {
    expect(
      docsSource({ event: "push", ref: "main", releases: ["0.2.0", "0.1.0"] }),
    ).toMatchObject({ deploy: false, error: false });
  });

  it("deploys the newest release, after it is published or on request", () => {
    for (const event of ["release", "dispatch"] as const) {
      expect(
        docsSource({ event, ref: "0.2.0", releases: ["0.2.0", "0.1.0"] }),
      ).toEqual({ deploy: true, ref: "0.2.0", version: "0.2.0" });
    }
  });

  it("refuses an older release, main, or another branch once released", () => {
    for (const ref of ["0.1.0", "main", "docs-0.1.0", "feature"]) {
      expect(
        docsSource({ event: "dispatch", ref, releases: ["0.2.0", "0.1.0"] }),
      ).toMatchObject({ deploy: false, error: true });
    }
  });

  it("deploys a correction branch that holds the tag and changes docs only", () => {
    expect(
      docsSource({
        event: "dispatch",
        ref: "docs-0.2.0",
        releases: ["0.2.0"],
        branch: { containsTag: true, changed: ["docs/install.md"] },
      }),
    ).toEqual({ deploy: true, ref: "docs-0.2.0", version: "0.2.0" });
  });

  it("refuses a correction branch that changes code or lacks the tag", () => {
    const releases = ["0.2.0"];
    for (const branch of [
      { containsTag: true, changed: ["docs/install.md", "src/main.ts"] },
      { containsTag: true, changed: ["package.json"] },
      { containsTag: false, changed: ["docs/install.md"] },
    ]) {
      expect(
        docsSource({ event: "dispatch", ref: "docs-0.2.0", releases, branch }),
      ).toMatchObject({ deploy: false, error: true });
    }
    expect(
      docsSource({ event: "dispatch", ref: "docs-0.2.0", releases }),
    ).toMatchObject({ deploy: false, error: true });
  });

  it("names the files outside the documentation that a branch changes", () => {
    const source = docsSource({
      event: "dispatch",
      ref: "docs-0.2.0",
      releases: ["0.2.0"],
      branch: { containsTag: true, changed: ["docs/a.md", "src/main.ts"] },
    });
    expect(source.deploy ? "" : source.reason).toContain("src/main.ts");
  });
});
