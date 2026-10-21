// Runs the end-to-end suite in Docker, on any system with Docker, Windows
// included: builds test/e2e/Dockerfile from this checkout and runs it. It
// runs the image it built by its ID, so that a run from another checkout,
// which builds under the same name, cannot swap its code in, and gives that
// image a tag of its own for as long as the run lasts: under containerd's
// image store, which Docker Desktop uses, an image that loses its last tag
// to a newer build is gone, and its ID with it.
// Arguments go to `wdio run`, such as `--spec test/e2e/specs/plugin.e2e.ts`.
//
// OBSIDIAN_VERSIONS picks the Obsidian versions, as in test/e2e/wdio.conf.mts.
// Downloaded versions stay in the named volume `inkline-obsidian-cache`, or
// INKLINE_OBSIDIAN_CACHE_VOLUME; screenshots and logs go to test-results/e2e.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
// This run's own tag, which no other run moves.
const runTag = `${image}:run-${randomBytes(6).toString("hex")}`;
const cacheVolume =
  process.env.INKLINE_OBSIDIAN_CACHE_VOLUME ?? "inkline-obsidian-cache";
const output = resolve("test-results/e2e");

mkdirSync(output, { recursive: true });
// The container's user can differ from the host's on Linux and macOS.
if (process.platform !== "win32") chmodSync(output, 0o777);

const versions = process.env.OBSIDIAN_VERSIONS;
// The image's ID, from a file of its own, which goes once the build ends.
const built = mkdtempSync(join(tmpdir(), "inkline-e2e-"));
const idFile = join(built, "image-id");
// Ctrl+C stops `docker build` and `docker run`, which get it too, and this
// script then cleans up after them rather than stopping first.
const stay = (): void => undefined;
process.on("SIGINT", stay);
let status = 1;
try {
  const build = spawnSync(
    "docker",
    [
      "build",
      "--file",
      "test/e2e/Dockerfile",
      "--tag",
      image,
      "--tag",
      runTag,
      "--iidfile",
      idFile,
      ".",
    ],
    { stdio: "inherit" },
  );
  if (build.error !== undefined) throw build.error;
  status = build.status ?? 1;
  const id =
    status === 0 && existsSync(idFile)
      ? readFileSync(idFile, "utf8").trim()
      : "";
  if (status === 0 && id === "") {
    throw new Error("docker build wrote no image ID");
  }
  if (status === 0) {
    const run = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--init",
        "--shm-size=1g",
        ...(versions === undefined
          ? []
          : ["--env", `OBSIDIAN_VERSIONS=${versions}`]),
        "--volume",
        `${cacheVolume}:/cache`,
        "--volume",
        `${output}:/out`,
        id,
        ...process.argv.slice(2),
      ],
      { stdio: "inherit" },
    );
    if (run.error !== undefined) throw run.error;
    status = run.status ?? 1;
  }
} finally {
  rmSync(built, { recursive: true, force: true });
  // Takes away this run's tag only; the image stays while another tag, such
  // as `inkline-e2e` itself, still names it. A build that failed made none.
  spawnSync("docker", ["image", "rm", runTag], { stdio: "ignore" });
  process.off("SIGINT", stay);
}
process.exit(status);
