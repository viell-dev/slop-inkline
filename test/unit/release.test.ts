import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json" with { type: "json" };
import packageJson from "../../package.json" with { type: "json" };
import versions from "../../versions.json" with { type: "json" };
import {
  metadataProblems,
  releaseNotes,
  releaseProblems,
  syncMetadata,
  type Metadata,
} from "../../scripts/lib/release.ts";

const released: Metadata = {
  packageJson: { version: "0.2.0" },
  manifest: { version: "0.2.0", minAppVersion: "1.13.4" },
  versions: { "0.1.0": "1.13.4", "0.2.0": "1.13.4" },
};

const changelog = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "- Something new.",
  "",
  "## 0.2.0 - 2026-11-02",
  "",
  "### Fixed",
  "",
  "- Something broken.",
  "",
  "## 0.1.0 - 2026-10-30",
  "",
  "## 0.0.9 - 2026-10-01",
  "",
  "- The first release.",
  "",
].join("\n");

describe("the repository's release metadata", () => {
  it("is consistent", () => {
    expect(metadataProblems({ packageJson, manifest, versions })).toEqual([]);
  });

  it("names the plugin inkline and keeps it desktop only", () => {
    expect(manifest.id).toBe("inkline");
    expect(manifest.isDesktopOnly).toBe(true);
  });
});

describe("metadataProblems", () => {
  it("accepts matching versions", () => {
    expect(metadataProblems(released)).toEqual([]);
  });

  it("accepts an unreleased repository without a versions entry", () => {
    expect(
      metadataProblems({
        packageJson: { version: "0.0.0" },
        manifest: { version: "0.0.0", minAppVersion: "1.13.4" },
        versions: {},
      }),
    ).toEqual([]);
  });

  it("reports a manifest version that differs from package.json", () => {
    expect(
      metadataProblems({
        ...released,
        manifest: { version: "0.1.0", minAppVersion: "1.13.4" },
      }),
    ).toEqual([
      "manifest.json version 0.1.0 differs from package.json version 0.2.0",
    ]);
  });

  it("reports a release missing from versions.json", () => {
    expect(
      metadataProblems({ ...released, versions: { "0.1.0": "1.13.4" } }),
    ).toEqual([
      "versions.json does not map 0.2.0 to the manifest's minAppVersion 1.13.4",
    ]);
  });

  it("reports versions that are not plain dotted numbers", () => {
    expect(
      metadataProblems({
        packageJson: { version: "1.0.0-beta.1" },
        manifest: { version: "1.0.0-beta.1", minAppVersion: "1.13" },
        versions: { v1: 2 },
      }),
    ).toEqual([
      "package.json version 1.0.0-beta.1 is not x.y.z",
      "manifest.json minAppVersion 1.13 is not x.y.z",
      "versions.json key v1 is not x.y.z",
      "versions.json entry for v1 is not x.y.z",
      "versions.json does not map 1.0.0-beta.1 to the manifest's minAppVersion 1.13",
    ]);
  });

  it("reports versions with leading zeros", () => {
    for (const version of ["01.2.3", "1.02.3", "1.2.03", "00.1.0"]) {
      expect(
        metadataProblems({
          packageJson: { version },
          manifest: { version, minAppVersion: "1.013.4" },
          versions: { [version]: "1.013.4" },
        }),
      ).toEqual([
        `package.json version ${version} is not x.y.z`,
        "manifest.json minAppVersion 1.013.4 is not x.y.z",
        `versions.json key ${version} is not x.y.z`,
        `versions.json entry for ${version} is not x.y.z`,
      ]);
    }
  });

  it("reports a minAppVersion raised apart from the release that needs it", () => {
    expect(
      metadataProblems({
        packageJson: { version: "0.1.0" },
        manifest: { version: "0.1.0", minAppVersion: "1.14.4" },
        versions: { "0.1.0": "1.13.4" },
      }),
    ).toEqual([
      "versions.json does not map 0.1.0 to the manifest's minAppVersion 1.14.4",
    ]);
  });

  it("reports files that are not objects", () => {
    expect(
      metadataProblems({ packageJson: null, manifest: [], versions: "{}" }),
    ).toEqual([
      "package.json version undefined is not x.y.z",
      "manifest.json minAppVersion undefined is not x.y.z",
      "versions.json is not an object",
    ]);
  });
});

describe("releaseNotes", () => {
  it("returns a dated release's section without its heading", () => {
    expect(releaseNotes(changelog, "0.2.0")).toBe(
      "### Fixed\n\n- Something broken.",
    );
  });

  it("returns the unreleased section", () => {
    expect(releaseNotes(changelog, "Unreleased")).toBe("- Something new.");
  });

  it("treats an empty or missing section as no notes", () => {
    expect(releaseNotes(changelog, "0.1.0")).toBeUndefined();
    expect(releaseNotes(changelog, "0.3.0")).toBeUndefined();
  });

  it("does not match a version as a pattern or a prefix", () => {
    expect(releaseNotes(changelog, "0.0.9")).toBe("- The first release.");
    expect(releaseNotes(changelog, "0.0")).toBeUndefined();
    expect(releaseNotes(changelog, "0x2x0")).toBeUndefined();
  });

  it("reads Windows line endings", () => {
    expect(releaseNotes(changelog.replaceAll("\n", "\r\n"), "0.2.0")).toBe(
      "### Fixed\n\n- Something broken.",
    );
  });

  const withExample = (fence: string, close = fence): string =>
    [
      "## 0.2.0 - 2026-11-02",
      "",
      "- Headings in notes:",
      "",
      `  ${fence}markdown`,
      "  ## example",
      "",
      "# title",
      `  ${close}`,
      "",
      "- More notes.",
      "",
      "## 0.1.0 - 2026-10-30",
      "",
      "- Older notes.",
    ].join("\n");

  it("ignores headings inside backtick and tilde code fences", () => {
    for (const fence of ["```", "~~~", "````"]) {
      const notes = releaseNotes(withExample(fence), "0.2.0");
      expect(notes).toContain("## example");
      expect(notes).toContain("# title");
      expect(notes?.endsWith("- More notes.")).toBe(true);
    }
  });

  it("closes a fence only with the same character, at least as long", () => {
    const notes = releaseNotes(withExample("````", "```"), "0.2.0");
    expect(notes).toContain("- Older notes.");
    expect(releaseNotes(withExample("```", "~~~"), "0.1.0")).toBeUndefined();
  });

  it("finds no section heading inside a code fence", () => {
    const fenced = ["```", "## 0.3.0 - 2026-12-01", "", "- Fake.", "```"];
    expect(releaseNotes(fenced.join("\n"), "0.3.0")).toBeUndefined();
  });

  it("does not open a fence on backticks whose info string has a backtick", () => {
    const text = [
      "## 0.2.0 - 2026-11-02",
      "",
      "``` not `a fence",
      "",
      "## 0.1.0 - 2026-10-30",
      "",
      "- Older notes.",
    ].join("\n");
    expect(releaseNotes(text, "0.2.0")).toBe("``` not `a fence");
    expect(releaseNotes(text, "0.1.0")).toBe("- Older notes.");
  });
});

describe("releaseProblems", () => {
  it("accepts a prepared release", () => {
    expect(releaseProblems(released, changelog, "0.2.0")).toEqual([]);
  });

  it("refuses the unreleased placeholder version", () => {
    const placeholder: Metadata = {
      packageJson: { version: "0.0.0" },
      manifest: { version: "0.0.0", minAppVersion: "1.13.4" },
      versions: {},
    };
    expect(releaseProblems(placeholder, changelog, "0.0.0")).toEqual([
      "0.0.0 is not a releasable x.y.z version",
      'CHANGELOG.md has no non-empty "## 0.0.0 - YYYY-MM-DD" section',
    ]);
  });

  it("refuses a version the files do not carry", () => {
    expect(releaseProblems(released, changelog, "0.0.9")).toEqual([
      "package.json version 0.2.0 is not 0.0.9",
    ]);
  });

  it("refuses a release without notes", () => {
    const empty: Metadata = {
      packageJson: { version: "0.1.0" },
      manifest: { version: "0.1.0", minAppVersion: "1.13.4" },
      versions: { "0.1.0": "1.13.4" },
    };
    expect(releaseProblems(empty, changelog, "0.1.0")).toEqual([
      'CHANGELOG.md has no non-empty "## 0.1.0 - YYYY-MM-DD" section',
    ]);
  });
});

describe("syncMetadata", () => {
  it("copies the version and records its minimum Obsidian version", () => {
    expect(
      syncMetadata(
        "0.3.0",
        { id: "inkline", version: "0.2.0", minAppVersion: "1.14.0" },
        { "0.2.0": "1.13.4" },
      ),
    ).toEqual({
      manifest: { id: "inkline", version: "0.3.0", minAppVersion: "1.14.0" },
      versions: { "0.2.0": "1.13.4", "0.3.0": "1.14.0" },
    });
  });

  it("keeps earlier releases' minimums when a release raises its own", () => {
    const synced = syncMetadata(
      "0.2.0",
      { version: "0.1.0", minAppVersion: "1.14.4" },
      { "0.1.0": "1.13.4" },
    );
    expect(synced.versions).toEqual({ "0.1.0": "1.13.4", "0.2.0": "1.14.4" });
    expect(
      metadataProblems({ packageJson: { version: "0.2.0" }, ...synced }),
    ).toEqual([]);
  });
});
