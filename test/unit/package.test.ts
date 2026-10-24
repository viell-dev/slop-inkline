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

  it("extracts with the platform's archive tool directly into plugins", async () => {
    const folder = await mkdtemp(join(tmpdir(), "inkline-install-"));
    try {
      const archive = join(folder, installArchiveName("0.1.1-rc.1"));
      const plugins = join(folder, "vault", "test-config", "plugins");
      await mkdir(plugins, { recursive: true });
      await writeFile(archive, createInstallZip(files));
      if (process.platform === "win32") {
        execFileSync(
          "pwsh",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Expand-Archive -LiteralPath $env:INKLINE_TEST_ZIP -DestinationPath $env:INKLINE_TEST_PLUGINS",
          ],
          {
            windowsHide: true,
            env: {
              ...process.env,
              INKLINE_TEST_ZIP: archive,
              INKLINE_TEST_PLUGINS: plugins,
            },
          },
        );
      } else {
        execFileSync("unzip", ["-q", archive, "-d", plugins]);
      }
      for (const [name, expected] of Object.entries(files)) {
        expect(
          new Uint8Array(await readFile(join(plugins, "inkline", name))),
        ).toEqual(expected);
      }
      const preferences = join(plugins, "inkline", "data.json");
      const drawing = join(folder, "vault", "001.ink.png");
      await writeFile(preferences, '{"symbolScale":150}');
      await writeFile(drawing, new Uint8Array([137, 80, 78, 71]));
      await writeFile(join(plugins, "inkline", "main.js"), "old installation");
      if (process.platform === "win32") {
        execFileSync(
          "pwsh",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Expand-Archive -Force -LiteralPath $env:INKLINE_TEST_ZIP -DestinationPath $env:INKLINE_TEST_PLUGINS",
          ],
          {
            windowsHide: true,
            env: {
              ...process.env,
              INKLINE_TEST_ZIP: archive,
              INKLINE_TEST_PLUGINS: plugins,
            },
          },
        );
      } else {
        execFileSync("unzip", ["-qo", archive, "-d", plugins]);
      }
      expect(await readFile(preferences, "utf8")).toBe('{"symbolScale":150}');
      expect(new Uint8Array(await readFile(drawing))).toEqual(
        new Uint8Array([137, 80, 78, 71]),
      );
      expect(
        new Uint8Array(await readFile(join(plugins, "inkline", "main.js"))),
      ).toEqual(files["main.js"]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe("release candidates", () => {
  it.each(["0.1.1-rc.1", "1.0.0-beta.2", "0.2.0-alpha", "1.2.3-0"])(
    "accepts and flags %s",
    (version) => {
      const synced = syncMetadata(
        version,
        { id: "inkline", minAppVersion: "1.13.4" },
        { "0.1.0": "1.13.4" },
      );
      const metadata = { packageJson: { version }, ...synced };
      expect(metadataProblems(metadata)).toEqual([]);
      expect(
        releaseProblems(
          metadata,
          `## ${version} - 2026-10-25\n\n- Synthetic candidate.\n`,
          version,
        ),
      ).toEqual([]);
      expect(synced.versions).toEqual({ "0.1.0": "1.13.4" });
      expect(isPrerelease(version)).toBe(true);
    },
  );

  it("does not label a numeric 0.x release as a prerelease", () => {
    expect(isPrerelease("0.2.0")).toBe(false);
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
