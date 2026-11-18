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
  releases: [publicRelease, historical],
} satisfies DocsRequest;

describe("docsSource", () => {
  it.each([
    ["preparing a pre-release", [publicRelease, historical]],
    ["after publishing a pre-release", [prerelease, publicRelease, historical]],
  ] as const)("deploys the public guide %s", (_state, releases) => {
    expect(docsSource({ ...main, releases })).toEqual({
      deploy: true,
      ref: "main",
      version: publicRelease.tag,
    });
  });

  it("waits for a prepared public release to be published", () => {
    expect(
      docsSource({
        ...main,
        releases: [prerelease, publicRelease, historical],
        manifestVersion: nextPublic.tag,
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
      }),
    ).toEqual({ deploy: true, ref: "main", version: nextPublic.tag });
  });

  it.each([
    ["public release", [publicRelease, historical]],
    ["pre-release", [prerelease, publicRelease, historical]],
  ] as const)(
    "deploys corrections once merged to main during a %s",
    (_state, releases) => {
      expect(docsSource({ ...main, releases })).toEqual({
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

  it("waits while no public release is published", () => {
    expect(docsSource({ ...main, releases: [historical] })).toMatchObject({
      deploy: false,
      error: false,
    });
  });

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
