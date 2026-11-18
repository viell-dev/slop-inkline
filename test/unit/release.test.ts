import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json" with { type: "json" };
import packageJson from "../../package.json" with { type: "json" };
import versions from "../../versions.json" with { type: "json" };
import {
  builtManifest,
  metadataProblems,
  releasedVersionsProblems,
  releaseNotes,
  releaseProblems,
  syncMetadata,
  type Metadata,
} from "../../scripts/lib/release.ts";
import {
  specificationName,
  specificationPath,
} from "../../scripts/lib/version.ts";

const released: Metadata = {
  packageJson: { version: "0.2.0" },
  manifest: { version: "0.2.0", minAppVersion: "1.13.4" },
  versions: { "0.0.9": "1.13.4", "0.2.0": "1.13.4" },
};

/** A pre-release in preparation: main still offers the public release. */
const prepared: Metadata = { ...released, packageJson: { version: "0.3.1" } };

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

  it("ships the committed manifest unchanged when it names this version", () => {
    const committed = readFileSync("manifest.json", "utf8");
    expect(builtManifest(committed, manifest.version)).toBe(committed);
  });

  // A merge of two branches' changelogs can keep both copies of a heading or an
  // entry, and each section becomes a release's notes.
  it("repeats no heading or entry within a changelog section", () => {
    const sections = readFileSync("CHANGELOG.md", "utf8").split(/^(?=## )/m);
    for (const section of sections) {
      const items = section
        .split("\n")
        .filter((line) => /^(###|-) /.test(line));
      expect(items).toEqual([...new Set(items)]);
    }
  });

  it("maps exactly the public releases that the changelog records", () => {
    expect(
      releasedVersionsProblems(readFileSync("CHANGELOG.md", "utf8"), versions),
    ).toEqual([]);
  });
});

describe("releasedVersionsProblems", () => {
  const history = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "```md",
    "## 1.6.0 - 2026-12-01",
    "```",
    "",
    "## 1.2.0 - 2026-11-30",
    "",
    "## 1.1.0 - 2026-11-20",
    "",
    "## 1.0.0 - 2026-11-16",
    "",
    "## 0.9.5 - 2026-11-15",
    "",
    "## 0.2.0 - 2026-11-02",
    "",
  ].join("\n");
  const mapped = { "1.0.0": "1.13.4", "1.2.0": "1.13.4" };

  it("accepts a map of the public releases from 1.0.0", () => {
    // 1.1.0 is a pre-release, 0.2.0 came before the first public release,
    // and a heading in a code block is no release.
    expect(releasedVersionsProblems(history, mapped)).toEqual([]);
    expect(
      releasedVersionsProblems(history.replaceAll("\n", "\r\n"), mapped),
    ).toEqual([]);
  });

  it("reports an older release dropped from the map", () => {
    expect(releasedVersionsProblems(history, { "1.2.0": "1.13.4" })).toEqual([
      "versions.json has no entry for 1.0.0, a public release in CHANGELOG.md",
    ]);
  });

  it("reports the newest release dropped with the manifest set back to match", () => {
    expect(releasedVersionsProblems(history, { "1.0.0": "1.13.4" })).toEqual([
      "versions.json has no entry for 1.2.0, a public release in CHANGELOG.md",
    ]);
  });

  it("reports an entry for a version the changelog does not record as released", () => {
    for (const key of ["0.8.0", "1.4.0", "1.6.0"]) {
      expect(
        releasedVersionsProblems(history, { ...mapped, [key]: "1.13.4" }),
        key,
      ).toEqual([
        `versions.json lists ${key}, which CHANGELOG.md does not record as a public release`,
      ]);
    }
  });
});

describe("metadataProblems", () => {
  it("accepts matching versions", () => {
    expect(metadataProblems(released)).toEqual([]);
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

  it("reports a public version that has not reached the manifest", () => {
    expect(
      metadataProblems({ ...released, packageJson: { version: "0.4.0" } }),
    ).toEqual([
      "manifest.json version 0.2.0 differs from package.json version 0.4.0",
      "versions.json does not map 0.4.0 to the manifest's minAppVersion 1.13.4",
    ]);
  });

  it("accepts a pre-release that has not reached the manifest", () => {
    expect(metadataProblems(prepared)).toEqual([]);
  });

  it("reports a manifest left at a pre-release while a later one is prepared", () => {
    // As 0.9.0 was until 1.0.0, which no manifest may name again.
    expect(
      metadataProblems({
        packageJson: { version: "1.1.0" },
        manifest: { version: "0.9.0", minAppVersion: "1.13.4" },
        versions: { "1.0.0": "1.13.4" },
      }),
    ).toEqual([
      "manifest.json version 0.9.0 is a pre-release, which Obsidian would offer to every user",
    ]);
  });

  // #324: main's manifest is what Obsidian offers, so while a pre-release is
  // prepared it names the newest public release that versions.json lists.
  it("reports a manifest that names a version never released", () => {
    expect(
      metadataProblems({
        packageJson: { version: "1.1.0" },
        manifest: { version: "0.8.0", minAppVersion: "1.13.4" },
        versions: { "1.0.0": "1.13.4" },
      }),
    ).toEqual([
      "manifest.json version 0.8.0 is not in versions.json, which lists every public release",
      "versions.json lists 1.0.0, a later public release than manifest.json version 0.8.0",
    ]);
  });

  it("reports a manifest set back to an older public release", () => {
    expect(
      metadataProblems({
        packageJson: { version: "1.3.0" },
        manifest: { version: "1.0.0", minAppVersion: "1.13.4" },
        versions: { "1.0.0": "1.13.4", "1.2.0": "1.13.4" },
      }),
    ).toEqual([
      "versions.json lists 1.2.0, a later public release than manifest.json version 1.0.0",
    ]);
  });

  it("reports a versions.json that has lost the manifest's release", () => {
    expect(
      metadataProblems({
        packageJson: { version: "1.1.0" },
        manifest: { version: "1.0.0", minAppVersion: "1.13.4" },
        versions: {},
      }),
    ).toEqual([
      "manifest.json version 1.0.0 is not in versions.json, which lists every public release",
    ]);
  });

  it("reports a public release prepared below one the map lists", () => {
    expect(
      metadataProblems({
        packageJson: { version: "1.2.0" },
        manifest: { version: "1.2.0", minAppVersion: "1.13.4" },
        versions: { "1.2.0": "1.13.4", "1.4.0": "1.13.4" },
      }),
    ).toEqual([
      "versions.json lists 1.4.0, a later public release than manifest.json version 1.2.0",
    ]);
  });

  it("accepts the manifest naming the newest public release of several", () => {
    const versions = {
      "1.0.0": "1.13.4",
      "1.2.0": "1.13.4",
      "1.10.0": "1.15.1",
    };
    for (const version of ["1.11.0", "1.11.4"]) {
      expect(
        metadataProblems({
          packageJson: { version },
          manifest: { version: "1.10.0", minAppVersion: "1.15.1" },
          versions,
        }),
        version,
      ).toEqual([]);
    }
    expect(
      metadataProblems({
        packageJson: { version: "1.10.0" },
        manifest: { version: "1.10.0", minAppVersion: "1.15.1" },
        versions,
      }),
    ).toEqual([]);
  });

  it("names only the newest of several later public releases", () => {
    expect(
      metadataProblems({
        packageJson: { version: "1.5.0" },
        manifest: { version: "1.0.0", minAppVersion: "1.13.4" },
        versions: { "1.0.0": "1.13.4", "1.4.0": "1.13.4", "1.2.0": "1.13.4" },
      }),
    ).toEqual([
      "versions.json lists 1.4.0, a later public release than manifest.json version 1.0.0",
    ]);
  });

  it("leaves a key that is not a public release to its own message", () => {
    for (const key of ["1.1.0", "1.2.0-rc.1"]) {
      expect(
        metadataProblems({
          packageJson: { version: "1.1.0" },
          manifest: { version: "1.0.0", minAppVersion: "1.13.4" },
          versions: { "1.0.0": "1.13.4", [key]: "1.13.4" },
        }),
        key,
      ).toEqual([
        key.includes("-")
          ? `versions.json key ${key} is not x.y.z`
          : `versions.json key ${key} is a pre-release`,
      ]);
    }
  });

  it("compares no invalid version with the map", () => {
    expect(
      metadataProblems({
        packageJson: { version: "01.2.3" },
        manifest: { version: "01.2.3", minAppVersion: "1.13.4" },
        versions: { "01.2.3": "1.13.4", "2.0.0": "1.13.4" },
      }),
    ).toEqual([
      "package.json version 01.2.3 is not a release version",
      "versions.json key 01.2.3 is not x.y.z",
    ]);
  });

  it("reports a pre-release's version in the manifest", () => {
    for (const version of ["0.3.1", "0.3.0-rc.1"]) {
      const problems = metadataProblems({
        ...prepared,
        packageJson: { version },
        manifest: { version, minAppVersion: "1.13.4" },
      });
      expect(problems, version).toEqual([
        version.includes("-")
          ? `manifest.json version ${version} is not x.y.z`
          : `manifest.json version ${version} is a pre-release, which Obsidian would offer to every user`,
      ]);
    }
  });

  it("reports a manifest that is ahead of the version being prepared", () => {
    expect(
      metadataProblems({ ...released, packageJson: { version: "0.1.5" } }),
    ).toEqual([
      "manifest.json version 0.2.0 is higher than package.json version 0.1.5",
    ]);
  });

  it("reports a pre-release in the map that Obsidian falls back on", () => {
    expect(
      metadataProblems({
        ...released,
        versions: { ...(released.versions as object), "0.1.0": "1.13.4" },
      }),
    ).toEqual(["versions.json key 0.1.0 is a pre-release"]);
  });

  it("reports a release missing from versions.json", () => {
    expect(
      metadataProblems({ ...released, versions: { "0.0.9": "1.13.4" } }),
    ).toEqual([
      "versions.json does not map 0.2.0 to the manifest's minAppVersion 1.13.4",
    ]);
  });

  it("lets a pre-release raise the manifest's minimum ahead of the map", () => {
    expect(
      metadataProblems({
        ...prepared,
        manifest: { version: "0.2.0", minAppVersion: "1.15.0" },
      }),
    ).toEqual([]);
  });

  it("reports invalid release identifiers and non-numeric app versions", () => {
    expect(
      metadataProblems({
        packageJson: { version: "1.0.0-beta.01" },
        manifest: { version: "1.0.0-beta.01", minAppVersion: "1.13" },
        versions: { v1: 2 },
      }),
    ).toEqual([
      "package.json version 1.0.0-beta.01 is not a release version",
      "manifest.json minAppVersion 1.13 is not x.y.z",
      "versions.json key v1 is not x.y.z",
      "versions.json entry for v1 is not x.y.z",
      "versions.json does not map 1.0.0-beta.01 to the manifest's minAppVersion 1.13",
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
        `package.json version ${version} is not a release version`,
        "manifest.json minAppVersion 1.013.4 is not x.y.z",
        `versions.json key ${version} is not x.y.z`,
        `versions.json entry for ${version} is not x.y.z`,
      ]);
    }
  });

  it("reports a minAppVersion raised apart from the release that needs it", () => {
    expect(
      metadataProblems({
        packageJson: { version: "1.0.0" },
        manifest: { version: "1.0.0", minAppVersion: "1.14.4" },
        versions: { "1.0.0": "1.13.4" },
      }),
    ).toEqual([
      "versions.json does not map 1.0.0 to the manifest's minAppVersion 1.14.4",
    ]);
  });

  it("reports files that are not objects", () => {
    expect(
      metadataProblems({ packageJson: null, manifest: [], versions: "{}" }),
    ).toEqual([
      "package.json version undefined is not a release version",
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

  it("reads a changelog that starts with a byte order mark", () => {
    for (const newline of ["\n", "\r\n"]) {
      const text = `\uFEFF${changelog.replaceAll("\n", newline)}`;
      expect(releaseNotes(text, "0.2.0")).toBe(
        "### Fixed\n\n- Something broken.",
      );
      expect(releaseNotes(text, "Unreleased")).toBe("- Something new.");
    }
  });

  const withExample = (fence: string, close = fence): string =>
    [
      "## 0.2.0 - 2026-11-02",
      "",
      "Headings in notes:",
      "",
      `${fence}markdown`,
      "## example",
      "",
      "# title",
      close,
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

  const withListExample = (fence: string, line: string): string =>
    [
      "## 0.2.0 - 2026-11-02",
      "",
      `- ${fence}text`,
      `  ${line}`,
      `  ${fence}`,
      "",
      "- More notes.",
      "",
      "## 0.1.0 - 2026-10-30",
      "",
      "- Older notes.",
    ].join("\n");

  it("reads fences that open on a list marker", () => {
    for (const fence of ["```", "~~~"]) {
      for (const line of ["example", "## example"]) {
        const text = withListExample(fence, line);
        const notes = releaseNotes(text, "0.2.0");
        expect(notes).toContain(line);
        expect(notes?.endsWith("- More notes.")).toBe(true);
        expect(notes).not.toContain("Older notes");
        expect(releaseNotes(text, "0.1.0")).toBe("- Older notes.");
      }
    }
  });

  it("ignores headings inside lists and quotes", () => {
    const text = [
      "## 0.2.0 - 2026-11-02",
      "",
      "- ## A heading in a list",
      "> ## A heading in a quote",
      "",
      "- More notes.",
      "",
      "## 0.1.0 - 2026-10-30",
      "",
      "- Older notes.",
    ].join("\n");
    expect(releaseNotes(text, "0.2.0")).toBe(
      "- ## A heading in a list\n> ## A heading in a quote\n\n- More notes.",
    );
    expect(releaseNotes(text, "0.1.0")).toBe("- Older notes.");
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

  it("refuses a version the files do not carry", () => {
    expect(releaseProblems(released, changelog, "0.0.9")).toEqual([
      "package.json version 0.2.0 is not 0.0.9",
    ]);
  });

  it("refuses a release without notes", () => {
    const empty: Metadata = {
      packageJson: { version: "0.1.0" },
      manifest: { version: "0.0.8", minAppVersion: "1.13.4" },
      versions: { "0.0.8": "1.13.4" },
    };
    expect(releaseProblems(empty, changelog, "0.1.0")).toEqual([
      'CHANGELOG.md has no non-empty "## 0.1.0 - YYYY-MM-DD" section',
    ]);
  });

  it("accepts a prepared pre-release that the manifest does not name", () => {
    const notes = "## 0.3.1 - 2026-11-06\n\n- A pre-release.\n";
    expect(releaseProblems(prepared, notes, "0.3.1")).toEqual([]);
  });

  it("refuses a public release that the manifest does not name", () => {
    const notes = "## 0.4.0 - 2026-11-06\n\n- A public release.\n";
    expect(
      releaseProblems(
        { ...released, packageJson: { version: "0.4.0" } },
        notes,
        "0.4.0",
      ),
    ).toEqual([
      "manifest.json version 0.2.0 differs from package.json version 0.4.0",
      "versions.json does not map 0.4.0 to the manifest's minAppVersion 1.13.4",
    ]);
  });
});

describe("builtManifest", () => {
  const committed = `${JSON.stringify(
    { id: "inkline", version: "1.0.0", minAppVersion: "1.13.4" },
    null,
    2,
  )}\n`;

  it("names the version, changing nothing else and keeping the order", () => {
    const built = builtManifest(committed, "1.1.0");
    expect(built).toBe(committed.replace('"1.0.0"', '"1.1.0"'));
  });

  it("gives back the same text for the version the file names", () => {
    expect(builtManifest(committed, "1.0.0")).toBe(committed);
  });

  it("refuses a manifest that is not an object", () => {
    expect(() => builtManifest("[]", "1.0.0")).toThrow("must be an object");
  });
});

describe("syncMetadata", () => {
  it("copies the version and records its minimum Obsidian version", () => {
    expect(
      syncMetadata(
        "0.4.0",
        { id: "inkline", version: "0.2.0", minAppVersion: "1.14.0" },
        { "0.2.0": "1.13.4" },
      ),
    ).toEqual({
      manifest: { id: "inkline", version: "0.4.0", minAppVersion: "1.14.0" },
      versions: { "0.2.0": "1.13.4", "0.4.0": "1.14.0" },
    });
  });

  it("changes neither file for a pre-release, as Obsidian reads both from main", () => {
    const listed = { id: "inkline", version: "1.0.0", minAppVersion: "1.14.0" };
    const versions = { "1.0.0": "1.14.0" };
    expect(syncMetadata("1.1.0", listed, versions)).toEqual({
      manifest: listed,
      versions,
    });
  });

  it("keeps earlier releases' minimums when a release raises its own", () => {
    const synced = syncMetadata(
      "0.2.0",
      { version: "0.0.9", minAppVersion: "1.14.4" },
      { "0.0.9": "1.13.4" },
    );
    expect(synced.versions).toEqual({ "0.0.9": "1.13.4", "0.2.0": "1.14.4" });
    expect(
      metadataProblems({ packageJson: { version: "0.2.0" }, ...synced }),
    ).toEqual([]);
  });
});

describe("the specification step", () => {
  // As the Release workflow runs it, from the repository's root. Each test
  // starts Node.js, which loads the script and the Markdown parser it imports:
  // in a full parallel run on Windows one start took 7.8 seconds, so Vitest's
  // five were too few. The tests promise nothing about speed, only what the
  // step writes.
  const startup = 30_000;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["scripts/release.ts", ...args], {
      encoding: "utf8",
    });

  it(
    "copies the specification, byte for byte, under its versioned name",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "inkline-specification-"));
      try {
        const output = join(directory, "release");
        const result = run("specification", output);
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        const document = readFileSync(specificationPath);
        const copy = join(output, specificationName(document.toString("utf8")));
        expect(result.stdout.trim()).toBe(copy);
        expect(readdirSync(output)).toEqual([basename(copy)]);
        expect(readFileSync(copy).equals(document)).toBe(true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    startup,
  );

  it(
    "names its arguments when it has none",
    () => {
      const result = run("specification");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "usage: release.ts specification <directory>",
      );
    },
    startup,
  );
});
