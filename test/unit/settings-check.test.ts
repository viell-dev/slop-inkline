import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import labels from "../../.github/labels.json" with { type: "json" };
import {
  labelProblems,
  labelUsageProblems,
  rulesetProblems,
} from "../../scripts/lib/settings.ts";

const recorded = [
  { name: "Type: Bug", color: "d73a4a", description: "Broken." },
  { name: "Status: Blocked", color: "d93f0b", description: "Waiting." },
  { name: "Status: Confirmed", color: "0e8a16", description: "Reproduced." },
  { name: "Needs: Owner", color: "c5def5", description: "The owner." },
  { name: "Needs: Human", color: "fbca04", description: "A person." },
];

const ruleset = {
  name: "PRs and CI for main",
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion" },
    {
      type: "pull_request",
      parameters: { required_approving_review_count: 0 },
    },
  ],
};

describe("the repository's label and ruleset files", () => {
  it("list each label once, with a colour and a description", () => {
    const names = labels.map((label) => label.name);
    expect(new Set(names).size).toBe(names.length);
    for (const label of labels) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description).not.toBe("");
    }
    expect(labelProblems(labels, labels)).toEqual([]);
  });

  it("have the Type, Status, and Needs labels that issues use", () => {
    const names = labels.map((label) => label.name);
    expect(names).toContain("Needs: Owner");
    expect(names).toContain("Needs: Human");
    expect(names).not.toContain("Status: Needs Owner Testing");
    expect(names.filter((name) => name.startsWith("Type: ")).length).toBe(7);
  });

  it("record every ruleset with a name, and none twice", () => {
    const directory = ".github/rulesets";
    const files = readdirSync(directory).map((name): unknown =>
      JSON.parse(readFileSync(join(directory, name), "utf8")),
    );
    expect(rulesetProblems(files, files).problems).toEqual([]);
  });
});

describe("labelProblems", () => {
  it("accepts live labels that match, colours in any case", () => {
    const live = recorded.map((label) => ({ ...label, id: 1 }));
    expect(labelProblems(recorded, live)).toEqual([]);
    expect(
      labelProblems([{ ...recorded[0], color: "D73A4A" }], [recorded[0]]),
    ).toEqual([]);
  });

  it("reports a missing label, another colour or description, and an extra one", () => {
    const live = [
      { ...recorded[0], color: "000000" },
      { ...recorded[1], description: "Old words." },
      ...recorded.slice(3),
      { name: "good first issue", color: "7057ff", description: "" },
    ];
    expect(labelProblems(recorded, live)).toEqual([
      'label "Type: Bug" has color "000000", not "d73a4a"',
      'label "Status: Blocked" has description "Old words.", not "Waiting."',
      'label "Status: Confirmed" is missing',
      'label "good first issue" is not in labels.json',
    ]);
  });

  it("refuses what is not a list", () => {
    expect(labelProblems({}, [])).toEqual(["labels.json is not a list"]);
    expect(labelProblems([], null)).toEqual(["the live labels are not a list"]);
  });
});

describe("rulesetProblems", () => {
  it("accepts a live ruleset that matches, its rules in any order", () => {
    const live = {
      ...ruleset,
      id: 7,
      source: "viell-dev/slop-inkline",
      rules: [...ruleset.rules].reverse(),
    };
    expect(rulesetProblems([ruleset], [live])).toEqual({
      problems: [],
      unseen: [],
    });
  });

  it("reports a changed rule, a missing ruleset, and one without a file", () => {
    const changed = {
      ...ruleset,
      rules: [
        { type: "deletion" },
        {
          type: "pull_request",
          parameters: { required_approving_review_count: 1 },
        },
      ],
    };
    const other = { ...ruleset, name: "Something else" };
    expect(rulesetProblems([ruleset], [changed]).problems).toEqual([
      'ruleset "PRs and CI for main" has other rules than its file',
    ]);
    expect(
      rulesetProblems([ruleset, other], [other, { ...ruleset, name: "New" }])
        .problems,
    ).toEqual([
      'ruleset "PRs and CI for main" is missing',
      'ruleset "New" has no file',
    ]);
  });

  it("compares bypass actors only where they are shown", () => {
    const { bypass_actors: _hidden, ...unseen } = ruleset;
    expect(rulesetProblems([ruleset], [unseen])).toEqual({
      problems: [],
      unseen: ["PRs and CI for main"],
    });
    const bypassed = {
      ...ruleset,
      bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5 }],
    };
    expect(rulesetProblems([ruleset], [bypassed]).problems).toEqual([
      'ruleset "PRs and CI for main" has other bypass_actors than its file',
    ]);
  });
});

describe("labelUsageProblems", () => {
  it("accepts one Type label, at most one Status, and one Needs", () => {
    expect(
      labelUsageProblems(recorded, [
        { number: 1, labels: ["Type: Bug"] },
        { number: 2, labels: ["Type: Bug", "Status: Blocked", "Needs: Owner"] },
      ]),
    ).toEqual([]);
  });

  it("reports a missing or second Type, a second Status, both Needs, and unknown labels", () => {
    expect(
      labelUsageProblems(recorded, [
        { number: 3, labels: [] },
        { number: 4, labels: ["Type: Bug", "Type: Question"] },
        {
          number: 5,
          labels: ["Type: Bug", "Status: Blocked", "Status: Confirmed"],
        },
        { number: 6, labels: ["Type: Bug", "Needs: Owner", "Needs: Human"] },
        { number: 7, labels: ["Type: Bug", "Status: Needs Owner Testing"] },
      ]),
    ).toEqual([
      "#3 has 0 Type labels, not one",
      "#4 has 2 Type labels, not one",
      '#4 has "Type: Question", which labels.json lacks',
      "#5 has 2 Status labels",
      "#6 has both Needs labels; keep the more specific",
      '#7 has "Status: Needs Owner Testing", which labels.json lacks',
    ]);
  });
});
