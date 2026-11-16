// Reads the durations.json files that the end-to-end shards wrote.
//
//   node test/e2e/shards.ts check <directory>
//     Fails unless the runs under <directory> together ran every spec file in
//     test/e2e/specs exactly once, each on as many Obsidian versions as the
//     others. CI's e2e job runs it on the shards' downloaded artifacts, so
//     that a spec file that runs nowhere fails the required check.
//
//   node test/e2e/shards.ts weights <directory>...
//     Rewrites test/e2e/weights.json from the runs under the directories.
//
// It imports only Node.js's own modules, through support/harness.ts, so that
// CI runs it without installing the dependencies.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  coverageProblems,
  mergeWeights,
  readDurations,
  readWeights,
  specFiles,
  type ShardRun,
} from "./support/harness.ts";

const specsDir = path.join(import.meta.dirname, "specs");
const weightsFile = path.join(import.meta.dirname, "weights.json");

async function runsUnder(directories: readonly string[]): Promise<ShardRun[]> {
  const found = await Promise.all(directories.map(readDurations));
  return found.flat();
}

const [command, ...directories] = process.argv.slice(2);
if (
  (command !== "check" && command !== "weights") ||
  directories.length === 0 ||
  (command === "check" && directories.length > 1)
) {
  console.error(
    "Usage: node test/e2e/shards.ts check <directory>\n" +
      "       node test/e2e/shards.ts weights <directory>...",
  );
  process.exit(2);
}

const specs = await specFiles(specsDir);
const runs = await runsUnder(directories);

if (command === "check") {
  for (const run of runs) {
    console.log(
      `${run.source}: shard ${run.durations.shard ?? "of every file"}, ${String(Object.keys(run.durations.specs).length)} spec files`,
    );
  }
  const problems = coverageProblems(specs, runs);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exit(1);
  }
  console.log(
    `The ${String(runs.length)} runs ran each of the ${String(specs.length)} spec files once.`,
  );
} else {
  if (runs.length === 0) {
    console.error(`error: no durations.json under ${directories.join(", ")}`);
    process.exit(1);
  }
  const weights = mergeWeights(
    await readWeights(weightsFile),
    runs.map((run) => run.durations),
    specs,
  );
  await writeFile(weightsFile, `${JSON.stringify(weights, null, 2)}\n`);
  console.log(
    `Wrote ${weightsFile} from ${String(runs.length)} runs, with ${String(Object.keys(weights).length)} of the ${String(specs.length)} spec files.`,
  );
}
