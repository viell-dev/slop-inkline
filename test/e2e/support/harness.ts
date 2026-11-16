// The end-to-end harness's settings and output, kept free of WebdriverIO so
// that unit tests can check them. It imports only Node.js's own modules, so
// that test/e2e/shards.ts runs it in CI without installing the dependencies.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Reads an environment variable, treating an empty value as unset. */
export function setting(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/**
 * The displays that test/e2e/session.sh started, one for each Obsidian
 * version, from `INKLINE_E2E_DISPLAYS`, or none when it started none, as on
 * a desktop with a display of its own. Throws when `versions` Obsidian
 * versions are more than the displays, since two versions on one display
 * resize each other's windows.
 */
export function sessionDisplays(
  value: string | undefined,
  versions: number,
): string[] {
  const displays = (setting(value) ?? "")
    .split(" ")
    .filter((display) => display !== "");
  if (displays.length > 0 && versions > displays.length) {
    throw new Error(
      `the end-to-end session has ${String(displays.length)} displays, one for each Obsidian version, but OBSIDIAN_VERSIONS lists ${String(versions)} versions`,
    );
  }
  return displays;
}

/**
 * The display for a WebdriverIO worker, by the version that the first number
 * of its id counts from 0: `"1-3"` runs the second version.
 */
export function workerDisplay(
  worker: string,
  displays: readonly string[],
): string | undefined {
  const version = Number(worker.split("-")[0]);
  return Number.isInteger(version) ? displays[version] : undefined;
}

/**
 * Resolves the output directory from `E2E_OUTPUT_DIR`, or `test-results/e2e`
 * under `root` when it is unset or empty.
 */
export function outputDirectory(
  value: string | undefined,
  root: string,
): string {
  const directory = setting(value);
  return directory === undefined
    ? path.join(root, "test-results", "e2e")
    : path.resolve(directory);
}

/**
 * The directory of the plugin's files to install, from `E2E_PLUGIN_DIR`, or
 * the build's `dist` under `root` when it is unset or empty. The Release
 * workflow names the release's own files.
 */
export function pluginDirectory(
  value: string | undefined,
  root: string,
): string {
  const directory = setting(value);
  return directory === undefined
    ? path.join(root, "dist")
    : path.resolve(root, directory);
}

/** The file that marks a directory as the harness's own output. */
export const ownerMarker = ".inkline-e2e-output";

/**
 * The file in the output directory that records how long each spec file took
 * on each Obsidian version, as {@link Durations}.
 */
export const durationsFile = "durations.json";

/** The entries the harness creates in its output directory. */
export const outputEntries = [
  "logs",
  "screenshots",
  "pdfs",
  durationsFile,
] as const;

/**
 * Prepares the output directory for a run and removes the previous run's
 * output. The harness claims a directory that is new or empty by writing
 * {@link ownerMarker} into it, and refuses one that holds anything else
 * without the marker, so that a wrong `E2E_OUTPUT_DIR` deletes nothing. The
 * directory itself stays, since Docker mounts it.
 */
export async function prepareOutput(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory);
  if (entries.length > 0 && !entries.includes(ownerMarker)) {
    throw new Error(
      `${directory} is not empty and is not Inkline's end-to-end output; ` +
        "set E2E_OUTPUT_DIR to a new or empty directory.",
    );
  }
  await writeFile(
    path.join(directory, ownerMarker),
    `Output of Inkline's end-to-end tests. Each run replaces logs/, screenshots/, pdfs/, and ${durationsFile}.\n`,
  );
  await Promise.all(
    outputEntries.map((entry) =>
      rm(path.join(directory, entry), { recursive: true, force: true }),
    ),
  );
}

/** One of the jobs the spec files are split over, as `E2E_SHARD` names it. */
export interface Shard {
  /** Which shard, counting from 1. */
  readonly index: number;
  /** How many shards there are. */
  readonly total: number;
}

/**
 * Reads `E2E_SHARD`, of the form `i/n` with 1 ≤ i ≤ n, such as `2/4`. Unset
 * or blank means one run of every spec file. Throws on any other value, so
 * that a wrong setting never runs a different set of files.
 */
export function parseShard(value: string | undefined): Shard | undefined {
  const text = setting(value);
  if (text === undefined) return undefined;
  const match = /^\s*([1-9]\d*)\/([1-9]\d*)\s*$/.exec(text);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (match === null || index > total) {
    throw new Error(
      `E2E_SHARD is "${text}", but must be "i/n" with whole numbers 1 ≤ i ≤ n, such as "2/4", or unset to run every spec file`,
    );
  }
  return { index, total };
}

/**
 * The spec files under `directory`, as paths relative to it with forward
 * slashes, sorted: the form the weights and durations name them by.
 */
export async function specFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".e2e.ts"))
    .map((entry) => entry.split(path.sep).join("/"))
    .sort();
}

/**
 * A spec file's name relative to `directory`, as {@link specFiles} gives it,
 * from the absolute path or `file://` URL WebdriverIO gives its workers.
 */
export function specName(spec: string, directory: string): string {
  const file = spec.startsWith("file://") ? fileURLToPath(spec) : spec;
  return path.relative(directory, file).split(path.sep).join("/");
}

/** Measured seconds for each spec file, by its name relative to the specs. */
export type Weights = Readonly<Record<string, number>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Checks test/e2e/weights.json's contents: an object from spec file names to
 * seconds. Throws, naming `source`, on anything else.
 */
export function parseWeights(value: unknown, source: string): Weights {
  if (!isRecord(value)) {
    throw new Error(`${source} must be an object of spec files to seconds`);
  }
  for (const [spec, seconds] of Object.entries(value)) {
    if (!isSeconds(seconds)) {
      throw new Error(
        `${source} gives ${spec} ${JSON.stringify(seconds)}, not a number of seconds`,
      );
    }
  }
  return value as Weights;
}

/** Reads and checks the weights table at `file`. */
export async function readWeights(file: string): Promise<Weights> {
  return parseWeights(
    JSON.parse(await readFile(file, "utf8")) as unknown,
    file,
  );
}

/**
 * The weight of a spec file that the table does not list: the median of the
 * listed weights, or 1 when there are none, so that a new spec file runs
 * somewhere without anyone editing the table.
 */
export function defaultWeight(weights: Weights): number {
  const values = Object.values(weights).sort((a, b) => a - b);
  if (values.length === 0) return 1;
  const middle = Math.floor(values.length / 2);
  const upper = values[middle] ?? 1;
  return values.length % 2 === 1
    ? upper
    : ((values[middle - 1] ?? 1) + upper) / 2;
}

/**
 * Splits `specs` over `total` shards of about equal measured time. Taking the
 * spec files from the heaviest down, by name on a tie, each goes to the shard
 * with the least time so far, the lowest-numbered on a tie. Returns each
 * shard's spec files sorted by name; the result depends only on the list and
 * the table.
 */
export function assignShards(
  specs: readonly string[],
  weights: Weights,
  total: number,
): string[][] {
  const fallback = defaultWeight(weights);
  const weightOf = (spec: string): number =>
    Object.hasOwn(weights, spec) ? (weights[spec] ?? fallback) : fallback;
  const order = [...specs].sort(
    (a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const shards = Array.from({ length: total }, () => ({
    specs: [] as string[],
    seconds: 0,
  }));
  for (const spec of order) {
    let lightest = shards[0];
    for (const shard of shards) {
      if (lightest === undefined || shard.seconds < lightest.seconds) {
        lightest = shard;
      }
    }
    if (lightest === undefined) break;
    lightest.specs.push(spec);
    lightest.seconds += weightOf(spec);
  }
  return shards.map((shard) => shard.specs.sort());
}

/** The total weight of `specs`, as {@link assignShards} counts it. */
export function shardSeconds(
  specs: readonly string[],
  weights: Weights,
): number {
  const fallback = defaultWeight(weights);
  return specs.reduce(
    (sum, spec) =>
      sum + (Object.hasOwn(weights, spec) ? (weights[spec] ?? 0) : fallback),
    0,
  );
}

/**
 * What a run of the suite records in {@link durationsFile}: which shard it
 * was, and how many seconds each spec file's worker took on each Obsidian
 * version, keyed by spec file name and then by the version's resolved
 * `appVersion/installerVersion`. For example:
 *
 * ```json
 * {
 *   "shard": "2/4",
 *   "specs": { "editor.e2e.ts": { "1.13.4/1.13.4": 331.2, "1.15.2/1.15.2": 338.0 } }
 * }
 * ```
 */
export interface Durations {
  /** `E2E_SHARD` as the run read it, or null for a run of every file. */
  readonly shard: string | null;
  readonly specs: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** Checks a {@link durationsFile}'s contents, naming `source` on an error. */
export function parseDurations(value: unknown, source: string): Durations {
  const shard = isRecord(value) ? value.shard : undefined;
  const specs = isRecord(value) ? value.specs : undefined;
  if (!(shard === null || typeof shard === "string") || !isRecord(specs)) {
    throw new Error(
      `${source} must hold "shard", a string or null, and "specs", an object`,
    );
  }
  for (const [spec, versions] of Object.entries(specs)) {
    if (!isRecord(versions) || !Object.values(versions).every(isSeconds)) {
      throw new Error(
        `${source} must give ${spec} an object of Obsidian versions to seconds`,
      );
    }
  }
  return value as Durations;
}

/** A {@link durationsFile} that a shard wrote, and where it was found. */
export interface ShardRun {
  readonly source: string;
  readonly durations: Durations;
}

/**
 * Reads every {@link durationsFile} under `directory`, at any depth, as
 * `gh run download` and the download-artifact action leave each artifact in a
 * directory of its own.
 */
export async function readDurations(directory: string): Promise<ShardRun[]> {
  const entries = await readdir(directory, { recursive: true });
  const files = entries
    .filter((entry) => path.basename(entry) === durationsFile)
    .map((entry) => path.join(directory, entry))
    .sort();
  return Promise.all(
    files.map(async (source) => ({
      source,
      durations: parseDurations(
        JSON.parse(await readFile(source, "utf8")) as unknown,
        source,
      ),
    })),
  );
}

/**
 * Every reason the shards' runs do not cover the suite: a spec file on disk
 * that no run names, or more than one does, a spec file that a run names but
 * is not on disk, and a spec file that ran on fewer Obsidian versions than
 * another, or on none. The versions are counted rather than compared, as the
 * latest Obsidian can change between one shard's start and another's.
 */
export function coverageProblems(
  specs: readonly string[],
  runs: readonly ShardRun[],
): string[] {
  if (runs.length === 0) return [`no shard recorded a ${durationsFile}`];
  const problems: string[] = [];
  const onDisk = new Set(specs);
  const versions = new Map<string, number>();
  for (const spec of specs) {
    const found = runs.filter((run) =>
      Object.hasOwn(run.durations.specs, spec),
    );
    if (found.length === 0) {
      problems.push(`${spec} ran in no shard`);
    } else if (found.length > 1) {
      problems.push(
        `${spec} ran in more than one shard: ${found.map((run) => run.source).join(", ")}`,
      );
    }
    const first = found[0]?.durations.specs[spec];
    if (first !== undefined) versions.set(spec, Object.keys(first).length);
  }
  for (const run of runs) {
    for (const spec of Object.keys(run.durations.specs)) {
      if (!onDisk.has(spec)) {
        problems.push(`${run.source} names ${spec}, which is not a spec file`);
      }
    }
  }
  const most = Math.max(0, ...versions.values());
  if (most === 0 && versions.size > 0) {
    problems.push("no spec file ran on any Obsidian version");
  } else {
    for (const [spec, count] of versions) {
      if (count < most) {
        problems.push(
          `${spec} ran on ${String(count)} Obsidian versions, where others ran on ${String(most)}`,
        );
      }
    }
  }
  return problems;
}

/**
 * The weights table refreshed from measured runs: each spec file on disk
 * that a run measured weighs the seconds of its slowest Obsidian version,
 * rounded to whole seconds; one that no run measured keeps its old weight;
 * a weight for a file that no longer exists is dropped. Keys are sorted.
 */
export function mergeWeights(
  old: Weights,
  runs: readonly Durations[],
  specs: readonly string[],
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const spec of [...specs].sort()) {
    const measured = runs.flatMap((run) =>
      Object.hasOwn(run.specs, spec)
        ? Object.values(run.specs[spec] ?? {})
        : [],
    );
    if (measured.length > 0) {
      merged[spec] = Math.round(Math.max(...measured));
    } else if (Object.hasOwn(old, spec) && old[spec] !== undefined) {
      merged[spec] = old[spec];
    }
  }
  return merged;
}
