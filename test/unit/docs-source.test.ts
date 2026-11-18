import { describe, expect, it } from "vitest";
import {
  docsSource,
  publishedReleases,
  type DocsRequest,
} from "../../scripts/lib/docs.ts";

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

  it("skips an older main build once a newer public release exists", () => {
    const source = docsSource({
      ...main,
      releases: [nextPublic, publicRelease],
    });
    expect(source).toMatchObject({ deploy: false, error: false });
    expect(source.deploy ? "" : source.reason).toContain(nextPublic.tag);
  });

  it("fails when the manifest's release is published as a pre-release", () => {
    for (const releases of [
      [{ tag: nextPublic.tag, prerelease: true }, publicRelease],
      [{ tag: nextPublic.tag, prerelease: true }],
    ]) {
      expect(
        docsSource({ ...main, releases, manifestVersion: nextPublic.tag }),
      ).toMatchObject({ deploy: false, error: true });
    }
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

describe("publishedReleases", () => {
  const release = (
    tag: string,
    published: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    tag_name: tag,
    draft: false,
    prerelease: isPrereleaseTag(tag),
    published_at: published,
    ...extra,
  });
  const isPrereleaseTag = (tag: string): boolean =>
    Number(tag.split(".")[1]) % 2 === 1;

  it("lists every page's releases newest first, without drafts", () => {
    expect(
      publishedReleases([
        [
          release("1.1.0", "2026-11-20T10:00:00Z"),
          {
            tag_name: "1.2.0",
            draft: true,
            prerelease: false,
            published_at: null,
          },
          release("0.9.5", "2026-11-15T21:00:00Z"),
        ],
        [release("1.0.0", "2026-11-16T14:28:32Z")],
        [],
      ]),
    ).toEqual([
      { tag: "1.1.0", prerelease: true },
      { tag: "1.0.0", prerelease: false },
      { tag: "0.9.5", prerelease: true },
    ]);
  });

  it("keeps GitHub's flag, even where the version says otherwise", () => {
    // docsSource refuses a public version flagged by hand as a pre-release, so
    // the flag must come through as GitHub gives it.
    expect(
      publishedReleases([
        [release("1.2.0", "2026-11-30T10:00:00Z", { prerelease: true })],
      ]),
    ).toEqual([{ tag: "1.2.0", prerelease: true }]);
  });

  it.each([
    ["a non-object", "1.0.0"],
    [
      "no prerelease flag",
      { ...release("1.0.0", "2026-11-16T14:28:32Z"), prerelease: undefined },
    ],
    ["no tag", { ...release("1.0.0", "2026-11-16T14:28:32Z"), tag_name: 100 }],
    [
      "an empty tag",
      { ...release("1.0.0", "2026-11-16T14:28:32Z"), tag_name: "" },
    ],
    ["no time of publication", release("1.0.0", "")],
    ["a time that is not one", release("1.0.0", "yesterday")],
    [
      "a draft flag that is not a boolean",
      release("1.0.0", "2026-11-16T14:28:32Z", { draft: "no" }),
    ],
  ] as const)("refuses a list with %s", (_case, entry) => {
    expect(() =>
      publishedReleases([[release("1.1.0", "2026-11-20T10:00:00Z"), entry]]),
    ).toThrow(/the releases list contains/);
  });
});
