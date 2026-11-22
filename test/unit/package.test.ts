import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import {
  createInstallZip,
  verifyInstallZip,
} from "../../scripts/lib/package.ts";
import {
  installArchiveName,
  isPrerelease,
  releaseVersionPattern,
} from "../../scripts/lib/version.ts";
import {
  metadataProblems,
  releaseProblems,
  syncMetadata,
} from "../../scripts/lib/release.ts";

const files = {
  "main.js": new TextEncoder().encode('console.log("synthetic package");\n'),
  "manifest.json": new TextEncoder().encode(
    '{"id":"inkline","version":"0.1.1-rc.1"}\n',
  ),
  "styles.css": new TextEncoder().encode(".synthetic { color: red; }\n"),
};

describe("manual install ZIP", () => {
  it("contains only one inkline directory with unchanged plugin files", () => {
    const bytes = createInstallZip(files);
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(
      Object.keys(files)
        .map((name) => `inkline/${name}`)
        .sort(),
    );
    expect(() => {
      verifyInstallZip(bytes, files);
    }).not.toThrow();
    expect(createInstallZip(files)).toEqual(bytes);
  });

  it("rejects a source tree that would include user settings", () => {
    expect(() =>
      createInstallZip({ ...files, "data.json": new Uint8Array([1]) }),
    ).toThrow("exactly");
  });

  it.each(["data.json", "../outside.js", "main.js"])(
    "rejects an extra or misplaced entry: %s",
    (name) => {
      const entries = unzipSync(createInstallZip(files));
      entries[name] = new Uint8Array([1]);
      expect(() => {
        verifyInstallZip(zipSync(entries), files);
      }).toThrow("only");
    },
  );

  it("detects changed bytes even inside a structurally valid ZIP", () => {
    const entries = unzipSync(createInstallZip(files));
    entries["inkline/main.js"] = new Uint8Array([1]);
    expect(() => {
      verifyInstallZip(zipSync(entries), files);
    }).toThrow("changed main.js");
  });

  // It starts PowerShell on Windows, where the time is the process and its
  // module starting, Expand-Archive alone taking 1.5 to 1.9 seconds on a busy
  // machine (#93). Starting it for each extraction, it took up to 41 seconds
  // in a whole run with the machine's CPU at 100% (#402); it now starts it once
  // for both, and has more than twice that. It promises nothing about speed;
  // only the archive's bytes and what survives an update are checked.
  it("extracts with the platform's archive tool directly into plugins", async () => {
    const folder = await mkdtemp(join(tmpdir(), "inkline-install-"));
    try {
      const archive = join(folder, installArchiveName("0.1.1-rc.1"));
      await writeFile(archive, createInstallZip(files));
      // A first installation, into a vault that has none.
      const fresh = join(folder, "new", "test-config", "plugins");
      await mkdir(fresh, { recursive: true });
      // An update, over an earlier installation with its preferences, in a
      // vault with a drawing.
      const plugins = join(folder, "vault", "test-config", "plugins");
      const installed = join(plugins, "inkline");
      await mkdir(installed, { recursive: true });
      for (const name of Object.keys(files)) {
        await writeFile(join(installed, name), "old installation");
      }
      const preferences = join(installed, "data.json");
      const drawing = join(folder, "vault", "001.ink.png");
      await writeFile(preferences, '{"symbolScale":150}');
      await writeFile(drawing, new Uint8Array([137, 80, 78, 71]));
      if (process.platform === "win32") {
        execFileSync(
          "pwsh",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Expand-Archive -LiteralPath $env:INKLINE_TEST_ZIP -DestinationPath $env:INKLINE_TEST_NEW; Expand-Archive -Force -LiteralPath $env:INKLINE_TEST_ZIP -DestinationPath $env:INKLINE_TEST_PLUGINS",
          ],
          {
            windowsHide: true,
            env: {
              ...process.env,
              INKLINE_TEST_ZIP: archive,
              INKLINE_TEST_NEW: fresh,
              INKLINE_TEST_PLUGINS: plugins,
            },
          },
        );
      } else {
        execFileSync("unzip", ["-q", archive, "-d", fresh]);
        execFileSync("unzip", ["-qo", archive, "-d", plugins]);
      }
      for (const directory of [fresh, plugins]) {
        for (const [name, expected] of Object.entries(files)) {
          expect(
            new Uint8Array(await readFile(join(directory, "inkline", name))),
          ).toEqual(expected);
        }
      }
      expect(await readFile(preferences, "utf8")).toBe('{"symbolScale":150}');
      expect(new Uint8Array(await readFile(drawing))).toEqual(
        new Uint8Array([137, 80, 78, 71]),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("release candidates", () => {
  it.each(["0.1.1-rc.1", "1.0.0-beta.2", "0.2.0-alpha", "1.2.3-0"])(
    "flags the suffix of %s as a pre-release, which no new release may have",
    (version) => {
      const manifest = {
        id: "inkline",
        version: "0.0.8",
        minAppVersion: "1.13.4",
      };
      const versions = { "0.0.8": "1.13.4" };
      const synced = syncMetadata(version, manifest, versions);
      const metadata = { packageJson: { version }, ...synced };
      expect(metadataProblems(metadata)).toEqual([]);
      expect(
        releaseProblems(
          metadata,
          `## ${version} - 2026-10-25\n\n- Synthetic candidate.\n`,
          version,
        ),
      ).toEqual([`${version} is not a releasable version`]);
      expect(synced).toEqual({ manifest, versions });
      expect(isPrerelease(version)).toBe(true);
    },
  );

  it("takes an odd minor version for a pre-release, and an even one for a public release", () => {
    for (const version of ["0.9.0", "0.9.12", "1.1.0", "1.3.2", "0.1.0"]) {
      expect(isPrerelease(version), version).toBe(true);
    }
    for (const version of ["0.2.0", "1.0.0", "1.0.3", "1.2.0", "2.10.1"]) {
      expect(isPrerelease(version), version).toBe(false);
    }
    // The pre-releases before 0.9.0 had suffixes, whatever their minor.
    expect(isPrerelease("0.2.0-rc.1")).toBe(true);
    expect(isPrerelease("not a version")).toBe(false);
  });

  it.each([
    "0.1.1-rc.01",
    "01.1.1-rc.1",
    "0.1.1-",
    "0.1.1-rc..1",
    "0.1.1-../secret",
  ])("refuses invalid %s", (version) => {
    expect(releaseVersionPattern.test(version)).toBe(false);
    expect(() => installArchiveName(version)).toThrow(
      "Invalid release version",
    );
  });
});
