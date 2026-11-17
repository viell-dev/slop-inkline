import { describe, expect, it } from "vitest";
import { docsSource, type DocsRequest } from "../../scripts/lib/docs.ts";

const publicRelease = { tag: "1.0.0", prerelease: false };
const prerelease = { tag: "1.1.0", prerelease: true };
const nextPublic = { tag: "1.2.0", prerelease: false };
const historical = { tag: "0.9.5", prerelease: true };
const main = {
  event: "push",
  ref: "main",
  refType: "branch",
  manifestVersion: publicRelease.tag,
  packageVersion: publicRelease.tag,
  releases: [publicRelease, historical],
} satisfies DocsRequest;

describe("docsSource", () => {
  it.each([
    ["preparing a pre-release", [publicRelease, historical]],
    ["after publishing a pre-release", [prerelease, publicRelease, historical]],
  ] as const)("deploys the public guide %s", (_state, releases) => {
    expect(
      docsSource({ ...main, releases, packageVersion: prerelease.tag }),
    ).toEqual({ deploy: true, ref: "main", version: publicRelease.tag });
  });

  it("waits for a prepared public release to be published", () => {
    expect(
      docsSource({
        ...main,
        releases: [prerelease, publicRelease, historical],
        manifestVersion: nextPublic.tag,
        packageVersion: nextPublic.tag,
      }),
    ).toMatchObject({ deploy: false, error: false });
  });

  it("deploys the new public guide after publication", () => {
    expect(
      docsSource({
        ...main,
        event: "dispatch",
        releases: [nextPublic, prerelease, publicRelease, historical],
        manifestVersion: nextPublic.tag,
        packageVersion: nextPublic.tag,
      }),
    ).toEqual({ deploy: true, ref: "main", version: nextPublic.tag });
  });

  it.each([
    ["public release", "1.0.0", [publicRelease, historical]],
    ["pre-release", "1.1.0", [prerelease, publicRelease, historical]],
  ] as const)(
    "deploys corrections once merged to main during a %s",
    (_state, packageVersion, releases) => {
      expect(docsSource({ ...main, packageVersion, releases })).toEqual({
        deploy: true,
        ref: "main",
        version: publicRelease.tag,
      });
    },
  );

  it("skips an older main build once a newer public release exists", () => {
    expect(
      docsSource({ ...main, releases: [nextPublic, publicRelease] }),
    ).toMatchObject({ deploy: false, error: false });
  });

  it("ignores a pre-release even if its flag or version suggests a public release", () => {
    expect(
      docsSource({
        ...main,
        releases: [
          { tag: "1.2.0", prerelease: true },
          { tag: "1.1.0", prerelease: false },
          { tag: "1.1.0-rc.1", prerelease: false },
          publicRelease,
        ],
      }),
    ).toEqual({ deploy: true, ref: "main", version: publicRelease.tag });
  });

  it("uses the published package version before the first public release", () => {
    expect(
      docsSource({
        ...main,
        releases: [historical],
        manifestVersion: "0.9.0",
        packageVersion: historical.tag,
      }),
    ).toEqual({ deploy: true, ref: "main", version: historical.tag });
  });

  it.each([
    ["0.9.0", "0.9.6", [historical]],
    ["0.9.0", "0.9.5", []],
    ["1.0.0", "1.0.0", [historical]],
  ] as const)(
    "waits before the first public release when manifest names %s, package names %s, and published releases are %j",
    (manifestVersion, packageVersion, releases) => {
      expect(
        docsSource({ ...main, manifestVersion, packageVersion, releases }),
      ).toMatchObject({ deploy: false, error: false });
    },
  );

  it.each([
    ["main", "tag"],
    ["0.1.1-rc.1", "tag"],
    ["docs-0.1.0", "branch"],
    ["docs-0.1.1-rc.1", "branch"],
    ["feature", "branch"],
    ["0.1.1-rc.1", "branch"],
  ] as const)(
    "refuses %s (%s), even for a published version",
    (ref, refType) => {
      expect(
        docsSource({
          ...main,
          event: "dispatch",
          ref,
          refType,
        }),
      ).toMatchObject({ deploy: false, error: true });
    },
  );
});
