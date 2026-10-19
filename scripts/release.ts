// Release steps that read or write the repository's files:
//
//   node scripts/release.ts sync              after `npm version`, copy the
//                                             version to manifest.json and
//                                             versions.json
//   node scripts/release.ts check <version>   fail unless <version> can be
//                                             released from this checkout
//   node scripts/release.ts notes <section>   print a changelog section, a
//                                             version or "Unreleased"

import { readFile, writeFile } from "node:fs/promises";
import {
  isRecord,
  releaseNotes,
  releaseProblems,
  syncMetadata,
  type Metadata,
} from "./lib/release.ts";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readMetadata(): Promise<Metadata> {
  return {
    packageJson: await readJson("package.json"),
    manifest: await readJson("manifest.json"),
    versions: await readJson("versions.json"),
  };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [command, argument] = process.argv.slice(2);

switch (command) {
  case "sync": {
    const { packageJson, manifest, versions } = await readMetadata();
    if (!isRecord(packageJson) || typeof packageJson.version !== "string") {
      fail("package.json has no version");
    }
    if (!isRecord(manifest) || !isRecord(versions)) {
      fail("manifest.json and versions.json must be objects");
    }
    const synced = syncMetadata(packageJson.version, manifest, versions);
    await writeJson("manifest.json", synced.manifest);
    await writeJson("versions.json", synced.versions);
    break;
  }
  case "check": {
    if (argument === undefined) fail("usage: release.ts check <version>");
    const changelog = await readFile("CHANGELOG.md", "utf8");
    const problems = releaseProblems(await readMetadata(), changelog, argument);
    if (problems.length > 0) fail(problems.join("\n"));
    break;
  }
  case "notes": {
    if (argument === undefined) fail("usage: release.ts notes <section>");
    const notes = releaseNotes(
      await readFile("CHANGELOG.md", "utf8"),
      argument,
    );
    if (notes === undefined) fail(`CHANGELOG.md has no ${argument} notes`);
    console.log(notes);
    break;
  }
  default:
    fail("usage: release.ts sync | check <version> | notes <section>");
}
