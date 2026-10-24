import { describe, expect, it } from "vitest";
import { docsSource } from "../../scripts/lib/docs.ts";

describe("docsSource", () => {
  it.each(["push", "dispatch"] as const)(
    "deploys released guide corrections from main on %s",
    (event) => {
      expect(
        docsSource({
          event,
          ref: "main",
          refType: "branch",
          releases: ["0.1.1-rc.1", "0.1.0"],
          version: "0.1.1-rc.1",
        }),
      ).toEqual({ deploy: true, ref: "main", version: "0.1.1-rc.1" });
    },
  );

  it("deploys an explicitly unreleased guide before any release exists", () => {
    expect(
      docsSource({
        event: "push",
        ref: "main",
        refType: "branch",
        releases: [],
        version: "0.0.0",
      }),
    ).toEqual({ deploy: true, ref: "main", version: "unreleased" });
  });

  it.each([[], ["0.1.0"], ["0.2.0", "0.1.0"]])(
    "keeps the existing site when the prepared version is not the newest published release: %j",
    (...releases) => {
      expect(
        docsSource({
          event: "push",
          ref: "main",
          refType: "branch",
          releases,
          version: "0.1.1-rc.1",
        }),
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
          event: "dispatch",
          ref,
          refType,
          releases: ["0.1.1-rc.1"],
          version: "0.1.1-rc.1",
        }),
      ).toMatchObject({ deploy: false, error: true });
    },
  );
});
