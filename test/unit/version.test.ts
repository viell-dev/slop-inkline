import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareSemver,
  obsidianOffers,
  specificationName,
  specificationPath,
  versionOrderProblems,
} from "../../scripts/lib/version.ts";

/** What had been published when the release flow changed. */
const published = [
  "0.1.0",
  "0.1.1-rc.1",
  "0.1.1-rc.10",
  "0.2.0-rc.1",
  "0.3.0-alpha.1",
  "0.3.0-alpha.8",
  "0.9.0",
];

describe("compareSemver", () => {
  it("orders SemVer's own example of precedence", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.0.1",
      "1.1.0",
      "1.10.0",
      "2.0.0",
    ];
    for (const [index, version] of ordered.entries()) {
      expect(compareSemver(version, version), version).toBe(0);
      for (const later of ordered.slice(index + 1)) {
        expect(
          compareSemver(version, later),
          `${version}, ${later}`,
        ).toBeLessThan(0);
        expect(
          compareSemver(later, version),
          `${later}, ${version}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("keeps a hyphen inside a suffix's identifier", () => {
    expect(compareSemver("1.0.0-a-b.2", "1.0.0-a-b.10")).toBeLessThan(0);
    expect(compareSemver("1.0.0-a-b", "1.0.0-a-c")).toBeLessThan(0);
  });
});

describe("obsidianOffers", () => {
  it("gives the answers #141 records for suffixes", () => {
    expect(obsidianOffers("1.0.0-rc.1", "1.0.0")).toBe(false);
    expect(obsidianOffers("1.0.0", "1.0.0-rc.1")).toBe(true);
    expect(obsidianOffers("0.3.0-alpha.8", "0.3.0")).toBe(false);
    expect(obsidianOffers("0.3.0-alpha.8", "0.9.0")).toBe(true);
    expect(obsidianOffers("1.0.0-rc.1", "1.0.1")).toBe(true);
  });

  it("compares numbers, not text, and never offers the same version", () => {
    expect(obsidianOffers("1.9.0", "1.10.0")).toBe(true);
    expect(obsidianOffers("1.10.0", "1.9.0")).toBe(false);
    expect(obsidianOffers("1.0.0", "1.0.0")).toBe(false);
  });

  it("reads a suffix without a dot as no number at all", () => {
    expect(obsidianOffers("1.0.0-rc", "1.0.0")).toBe(false);
    expect(obsidianOffers("1.0.0", "1.0.0-rc")).toBe(false);
  });

  it("offers anything over a version it cannot read, and nothing it cannot read", () => {
    expect(obsidianOffers("1.0.0-rc.x", "0.1.0")).toBe(true);
    expect(obsidianOffers("1.0.0", "1.0.0-rc.x")).toBe(false);
  });
});

describe("versionOrderProblems", () => {
  it("accepts the versions that follow the published ones", () => {
    for (const version of ["0.9.1", "0.9.10", "1.0.0", "1.1.0", "2.0.0"]) {
      expect(versionOrderProblems(version, published), version).toEqual([]);
    }
    expect(versionOrderProblems("1.0.0", [])).toEqual([]);
  });

  it("refuses a version Obsidian ranks below a suffix, though SemVer ranks it above", () => {
    expect(versionOrderProblems("0.3.0", ["0.3.0-alpha.8"])).toEqual([
      "Obsidian would not offer 0.3.0 to someone on 0.3.0-alpha.8",
    ]);
  });

  it("refuses a version SemVer ranks below, though Obsidian ranks it above", () => {
    expect(versionOrderProblems("1.0.0-rc.1", ["1.0.0"])).toEqual([
      "1.0.0-rc.1 is not higher than 1.0.0 in SemVer's order",
    ]);
  });

  it("refuses a version that is lower in both orders, naming each it follows wrongly", () => {
    expect(versionOrderProblems("0.8.0", ["0.3.0", "0.9.0"])).toEqual([
      "0.8.0 is not higher than 0.9.0 in SemVer's order",
      "Obsidian would not offer 0.8.0 to someone on 0.9.0",
    ]);
  });

  it("refuses a public patch once a higher pre-release is published", () => {
    expect(versionOrderProblems("1.0.1", ["1.0.0", "1.1.0"])).toEqual([
      "1.0.1 is not higher than 1.1.0 in SemVer's order",
      "Obsidian would not offer 1.0.1 to someone on 1.1.0",
    ]);
  });

  it("leaves a published version itself to the publish step, which resumes it", () => {
    expect(versionOrderProblems("0.9.0", published)).toEqual([]);
  });
});

describe("specificationName", () => {
  it("names the repository's specification by its title and revision", () => {
    const document = readFileSync(specificationPath, "utf8");
    const [title = "", , revision = ""] = document.split("\n");
    const version = /, version (\d+)$/.exec(title)?.[1];
    const number = /^Revision (\d+),/.exec(revision)?.[1];
    expect(version).toBeDefined();
    expect(number).toBeDefined();
    expect(specificationName(document)).toBe(
      `inkline-file-format-version-${version ?? ""}-revision-${number ?? ""}.md`,
    );
  });

  it("follows a new revision, or a new version", () => {
    const header = (version: string, revision: string) =>
      `# Inkline file format, version ${version}\n\nRevision ${revision}, 1 January 2031\n\nText.\n`;
    expect(specificationName(header("1", "2"))).toBe(
      "inkline-file-format-version-1-revision-2.md",
    );
    expect(specificationName(header("2", "1"))).toBe(
      "inkline-file-format-version-2-revision-1.md",
    );
    expect(specificationName(header("12", "30").replaceAll("\n", "\r\n"))).toBe(
      "inkline-file-format-version-12-revision-30.md",
    );
  });

  it.each([
    [
      "another title",
      "# Another file format, version 1\n\nRevision 1, 7 November 2026\n",
    ],
    [
      "no revision",
      "# Inkline file format, version 1\n\nDraft, 7 November 2026\n",
    ],
    ["no date", "# Inkline file format, version 1\n\nRevision 1\n"],
    [
      "a leading zero",
      "# Inkline file format, version 01\n\nRevision 1, 7 November 2026\n",
    ],
    [
      "revision 0",
      "# Inkline file format, version 1\n\nRevision 0, 7 November 2026\n",
    ],
    [
      "no blank line",
      "# Inkline file format, version 1\nRevision 1, 7 November 2026\n",
    ],
    [
      "text before the title",
      "Intro.\n\n# Inkline file format, version 1\n\nRevision 1, 7 November 2026\n",
    ],
  ])("refuses a document with %s", (_, document) => {
    expect(() => specificationName(document)).toThrow(
      `${specificationPath} must open with`,
    );
  });
});
