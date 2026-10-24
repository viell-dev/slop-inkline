// node scripts/package.ts <directory> [output-directory]: package and verify
// the three raw plugin files, adding inkline-<version>.zip to the output.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createInstallZip,
  pluginFiles,
  verifyInstallZip,
} from "./lib/package.ts";
import { installArchiveName } from "./lib/version.ts";
import { isRecord } from "./lib/settings.ts";

const [directory, outputDirectory = directory] = process.argv.slice(2);
if (directory === undefined || outputDirectory === undefined) {
  throw new Error("usage: package.ts <directory> [output-directory]");
}
const files: Record<string, Uint8Array> = {};
for (const name of pluginFiles)
  files[name] = await readFile(join(directory, name));
const manifest: unknown = JSON.parse(
  await readFile(join(directory, "manifest.json"), "utf8"),
);
if (
  !isRecord(manifest) ||
  manifest.id !== "inkline" ||
  typeof manifest.version !== "string"
) {
  throw new Error("The package manifest must identify inkline and its version");
}
const archive = createInstallZip(files);
verifyInstallZip(archive, files);
await mkdir(outputDirectory, { recursive: true });
const output = join(outputDirectory, installArchiveName(manifest.version));
await writeFile(output, archive);
console.log(output);
