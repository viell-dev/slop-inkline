import { describe, expect, it } from "vitest";
import {
  bratPublishedProblems,
  bratVersionProblems,
  finalFormat,
  keepsStrokesFrom,
} from "../support/updates.ts";

/** The releases published when the BRAT check's rules were written. */
const published = [
  "0.9.2",
  "0.9.1",
  "0.9.0",
  "0.3.0-alpha.8",
  "0.3.0-alpha.1",
  "0.2.0-rc.1",
  "0.1.1-rc.10",
  "0.1.1-rc.9",
  "0.1.0",
];

describe("keepsStrokesFrom", () => {
  it("keeps strokes and drafts from the final format on, and no earlier", () => {
    expect(finalFormat).toBe("0.9.2");
    for (const version of ["0.9.2", "0.9.3", "1.0.0", "1.1.0"]) {
      expect(keepsStrokesFrom(version), version).toBe(true);
    }
    for (const version of ["0.9.1", "0.9.0", "0.3.0-alpha.8", "0.1.0"]) {
      expect(keepsStrokesFrom(version), version).toBe(false);
    }
  });
});

describe("bratVersionProblems", () => {
  it.each([
    ["0.9.2", "0.9.1"],
    ["0.9.2", "0.3.0-alpha.8"],
    ["0.9.3", "0.9.2"],
    ["1.0.0", "0.9.3"],
  ])("takes %s as the latest from %s", (latest, start) => {
    expect(bratVersionProblems(latest, start)).toEqual([]);
  });

  it("names each missing version", () => {
    expect(bratVersionProblems(undefined, "")).toEqual([
      "E2E_BRAT_LATEST must name the highest published release",
      "E2E_BRAT_START must name an earlier published release to update from",
    ]);
  });

  it("refuses what is not a version, before comparing anything", () => {
    expect(bratVersionProblems("latest", "v0.9.1")).toEqual([
      'E2E_BRAT_LATEST is "latest", not a version',
      'E2E_BRAT_START is "v0.9.1", not a version',
    ]);
  });

  it("refuses a latest release before the final format", () => {
    // The pair CONTRIBUTING.md gave until #229.
    expect(bratVersionProblems("0.9.0", "0.3.0-alpha.8")).toEqual([
      "E2E_BRAT_LATEST is 0.9.0, but the highest published release is 0.9.2 or later",
    ]);
  });

  it("refuses the same version twice, or an update that goes back", () => {
    expect(bratVersionProblems("0.9.2", "0.9.2")).toEqual([
      "E2E_BRAT_START must be earlier than E2E_BRAT_LATEST, not 0.9.2 too",
    ]);
    expect(bratVersionProblems("0.9.2", "0.9.3")).toEqual([
      "BRAT cannot update from 0.9.3: 0.9.2 is not higher than 0.9.3 in SemVer's order",
      "BRAT cannot update from 0.9.3: Obsidian would not offer 0.9.2 to someone on 0.9.3",
    ]);
  });
});

describe("bratPublishedProblems", () => {
  it("takes the highest release and an earlier one", () => {
    expect(bratPublishedProblems("0.9.2", "0.9.1", published)).toEqual([]);
    expect(bratPublishedProblems("0.9.2", "0.3.0-alpha.8", published)).toEqual(
      [],
    );
  });

  it("refuses a release that is not published", () => {
    expect(bratPublishedProblems("0.9.3", "0.9.2", published)).toEqual([
      "E2E_BRAT_LATEST is 0.9.3, which is not published",
      "E2E_BRAT_LATEST is 0.9.3, but the highest published release is 0.9.2",
    ]);
    expect(bratPublishedProblems("0.9.2", "0.4.0", published)).toEqual([
      "E2E_BRAT_START is 0.4.0, which is not published",
    ]);
  });

  it("refuses a latest that a later release has replaced", () => {
    expect(bratPublishedProblems("0.9.1", "0.9.0", published)).toEqual([
      "E2E_BRAT_LATEST is 0.9.1, but the highest published release is 0.9.2",
    ]);
  });

  it("finds the highest release by version, in any order", () => {
    // 0.1.1-rc.10 is above 0.1.1-rc.9, as text would not order them.
    expect(
      bratPublishedProblems("0.1.1-rc.10", "0.1.1-rc.9", [
        "0.1.1-rc.9",
        "0.1.1-rc.10",
        "0.1.0",
      ]),
    ).toEqual([]);
  });
});
