// Runs the end-to-end suite in Docker, on any system with Docker, Windows
// included: builds test/e2e/Dockerfile from this checkout and runs it. It
// runs the image it built by its ID, so that a run from another checkout,
// which builds under the same tag, cannot swap its code in.
// Arguments go to `wdio run`, such as `--spec test/e2e/specs/plugin.e2e.ts`.
//
// OBSIDIAN_VERSIONS picks the Obsidian versions, as in test/e2e/wdio.conf.mts.
// Downloaded versions stay in the named volume `inkline-obsidian-cache`, or
// INKLINE_OBSIDIAN_CACHE_VOLUME; screenshots and logs go to test-results/e2e.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const image = "inkline-e2e";
const cacheVolume =
  process.env.INKLINE_OBSIDIAN_CACHE_VOLUME ?? "inkline-obsidian-cache";
const output = resolve("test-results/e2e");

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(output, { recursive: true });
// The container's user can differ from the host's on Linux and macOS.
if (process.platform !== "win32") chmodSync(output, 0o777);

const versions = process.env.OBSIDIAN_VERSIONS;
// The image's ID, from a file of its own, which goes once the build ends,
// whether it succeeds, fails, or is stopped with Ctrl+C: the build stops
// then, and this script ends below.
const built = mkdtempSync(join(tmpdir(), "inkline-e2e-"));
const idFile = join(built, "image-id");
const stay = (): void => undefined;
process.on("SIGINT", stay);
let build: ReturnType<typeof spawnSync>;
let id = "";
try {
  build = spawnSync(
    "docker",
    [
      "build",
      "--file",
      "test/e2e/Dockerfile",
      "--tag",
      image,
      "--iidfile",
      idFile,
      ".",
    ],
    { stdio: "inherit" },
  );
  if (build.status === 0 && existsSync(idFile)) {
    id = readFileSync(idFile, "utf8").trim();
  }
} finally {
  process.off("SIGINT", stay);
  rmSync(built, { recursive: true, force: true });
}
if (build.error !== undefined) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
if (id === "") throw new Error("docker build wrote no image ID");
run("docker", [
  "run",
  "--rm",
  "--init",
  "--shm-size=1g",
  ...(versions === undefined ? [] : ["--env", `OBSIDIAN_VERSIONS=${versions}`]),
  "--volume",
  `${cacheVolume}:/cache`,
  "--volume",
  `${output}:/out`,
  id,
  ...process.argv.slice(2),
]);
