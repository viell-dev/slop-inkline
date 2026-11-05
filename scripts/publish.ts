// The Release workflow's steps that need GitHub, as RELEASING.md describes:
//
//   node scripts/publish.ts ci <commit>       fail unless the checks that
//                                             .github/rulesets/main.json
//                                             requires passed on <commit>,
//                                             within the last week
//   node scripts/publish.ts order <version>   fail unless <version> is higher
//                                             than every published version,
//                                             in SemVer's and Obsidian's order
//   node scripts/publish.ts publish <version> <directory>
//                                             publish <directory>'s files,
//                                             listed in its SHA256SUMS, as
//                                             <version>, resuming a run that
//                                             failed part way
//
// It needs GH_TOKEN and GITHUB_REPOSITORY, as the workflow gives them, and,
// to publish, GITHUB_SHA, the commit to tag, and the GitHub CLI. It imports
// only Node.js and lib/, so that it runs without the dependencies. Everything
// but the running of the CLI is in lib/github.ts, where tests can reach it.

import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { publishCommand } from "./lib/github.ts";

await publishCommand(process.argv.slice(2), {
  repository: process.env.GITHUB_REPOSITORY ?? "viell-dev/slop-inkline",
  commit: process.env.GITHUB_SHA,
  gh: (args) => {
    const result = spawnSync("gh", args, {
      encoding: "utf8",
      // The list of releases, with their notes, reaches the default of 1 MB
      // at about 90 releases, when this would stop with ENOBUFS.
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error !== undefined) throw result.error;
    return result;
  },
  wait: async (ms) => {
    await sleep(ms);
  },
  log: (message) => {
    console.log(message);
  },
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
