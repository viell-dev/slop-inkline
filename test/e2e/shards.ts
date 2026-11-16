// Reads the durations.json files that the end-to-end runs write.
//
//   node test/e2e/shards.ts check <directory>
//     Fails unless the runs under <directory> together ran and passed every
//     spec file in test/e2e/specs exactly once, on each Obsidian version that
//     OBSIDIAN_VERSIONS requests, the default pair when it is unset. CI's e2e
//     job runs it on the shards' downloaded artifacts.
//
//   node test/e2e/shards.ts shard <i/n> <output directory>
//     Fails unless <output directory>/durations.json shows shard i of n
//     running and passing exactly its own spec files on those versions. Each
//     CI shard runs it on its own output, before the upload.
//
//   node test/e2e/shards.ts weights <directory>...
//     Rewrites test/e2e/weights.json from the runs under the directories.
//
// It imports only Node.js's own modules, through support/shards.ts, so that
// CI runs it without installing the dependencies. Everything but reading the
// process's arguments and environment is in shardsCommand, which unit tests
// run.

import path from "node:path";
import { shardsCommand } from "./support/shards.ts";

process.exitCode = await shardsCommand(process.argv.slice(2), {
  specsDir: path.join(import.meta.dirname, "specs"),
  weightsFile: path.join(import.meta.dirname, "weights.json"),
  obsidianVersions: process.env.OBSIDIAN_VERSIONS,
  log: (message) => {
    console.log(message);
  },
  error: (message) => {
    console.error(message);
  },
});
