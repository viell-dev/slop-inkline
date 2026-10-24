// Checks that the repository's live settings match the files that record
// them, and that issues and pull requests use the labels as AGENTS.md
// says: `node scripts/settings.ts`. It reads GitHub's API, with the token in
// GH_TOKEN or GITHUB_TOKEN if one is set, for the repository in
// GITHUB_REPOSITORY, by default viell-dev/slop-inkline. It changes nothing.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isRecord,
  labelProblems,
  labelUsageProblems,
  rulesetProblems,
  type Labelled,
} from "./lib/settings.ts";

const repository = process.env.GITHUB_REPOSITORY ?? "viell-dev/slop-inkline";
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

async function api(path: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${path}: ${String(response.status)}`);
  }
  return response.json();
}

/** Every page of a list, 100 items at a time. */
async function all(path: string): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; ; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await api(
      `${path}${separator}per_page=100&page=${String(page)}`,
    );
    if (!Array.isArray(batch)) throw new Error(`GET ${path}: not a list`);
    const listed: readonly unknown[] = batch;
    items.push(...listed);
    if (batch.length < 100) return items;
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

const recordedLabels = await readJson(".github/labels.json");
const rulesetDirectory = ".github/rulesets";
const recordedRulesets = await Promise.all(
  (await readdir(rulesetDirectory))
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(join(rulesetDirectory, name))),
);

const liveLabels = await all(`repos/${repository}/labels`);
// The list leaves out the rules, which each ruleset's own address gives.
const rulesetIds = (await all(`repos/${repository}/rulesets`)).flatMap(
  (ruleset) =>
    isRecord(ruleset) && typeof ruleset.id === "number" ? [ruleset.id] : [],
);
const liveRulesets = await Promise.all(
  rulesetIds.map((id) => api(`repos/${repository}/rulesets/${String(id)}`)),
);
const items: Labelled[] = (
  await all(`repos/${repository}/issues?state=all`)
).flatMap((item) => {
  if (!isRecord(item) || typeof item.number !== "number") return [];
  const labels = Array.isArray(item.labels) ? item.labels : [];
  return [
    {
      number: item.number,
      labels: labels.flatMap((label) => {
        const name: unknown = isRecord(label) ? label.name : undefined;
        return typeof name === "string" ? [name] : [];
      }),
    },
  ];
});

const rulesets = rulesetProblems(recordedRulesets, liveRulesets);
const problems = [
  ...labelProblems(recordedLabels, liveLabels),
  ...rulesets.problems,
  ...labelUsageProblems(recordedLabels, items),
];
console.log(
  `Compared ${String(liveLabels.length)} labels, ${String(liveRulesets.length)} rulesets, and the labels of ${String(items.length)} issues and pull requests in ${repository}.`,
);
if (rulesets.unseen.length > 0) {
  console.log(
    `Bypass actors not shown to this token, so not compared: ${rulesets.unseen.join(", ")}.`,
  );
}
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
