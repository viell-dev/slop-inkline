// The end-to-end suite's spec files, how they are split into shards and
// balanced by weights.json, the durations.json record each run writes, and
// the checks that read it, with the command test/e2e/shards.ts runs. Like
// harness.ts, it is free of WebdriverIO and imports only Node.js's own
// modules, so that unit tests can check it and CI runs it without the
// dependencies.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { durationsFile, requestedVersions, setting } from "./harness.ts";

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
 * The spec files under `directory`, at any depth, as paths relative to it
 * with forward slashes, sorted: the suite, and the form the weights and
 * durations name them by.
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

/** Reads JSON from `file`, naming the file when it is not JSON. */
async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${file} is not JSON`);
  }
}

/** Reads and checks the weights table at `file`. */
export async function readWeights(file: string): Promise<Weights> {
  return parseWeights(await readJson(file), file);
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

/** How a spec file is weighed: by the table, or else by {@link defaultWeight}. */
function weigher(weights: Weights): (spec: string) => number {
  const fallback = defaultWeight(weights);
  return (spec) =>
    Object.hasOwn(weights, spec) ? (weights[spec] ?? fallback) : fallback;
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
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(
      `the spec files need at least 1 shard, not ${String(total)}`,
    );
  }
  const weightOf = weigher(weights);
  const order = [...specs].sort(
    (a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const shards: { specs: string[]; seconds: number }[] = Array.from(
    { length: total },
    () => ({ specs: [], seconds: 0 }),
  );
  for (const spec of order) {
    const lightest = shards.reduce((least, shard) =>
      shard.seconds < least.seconds ? shard : least,
    );
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
  const weightOf = weigher(weights);
  return specs.reduce((sum, spec) => sum + weightOf(spec), 0);
}

/** One worker's run of one spec file on one requested Obsidian version. */
export interface WorkerRun {
  /** The `appVersion/installerVersion` the request resolved to. */
  readonly resolved: string;
  /** From the worker's start to its exit, Obsidian's start included. */
  readonly seconds: number;
  /** The worker's exit code: 0 when every test of the file passed. */
  readonly exitCode: number;
}

/** The {@link Durations} format this harness writes and reads. */
export const durationsFormat = 2;

/**
 * What a run of the suite records in {@link durationsFile}: the format, which
 * shard it was, the Obsidian versions it requested, the launcher's exit code,
 * and each spec file's worker on each requested version. For example:
 *
 * ```json
 * {
 *   "format": 2,
 *   "shard": "2/4",
 *   "versions": ["earliest/earliest", "latest/latest"],
 *   "exitCode": 0,
 *   "specs": {
 *     "editor.e2e.ts": {
 *       "earliest/earliest": { "resolved": "1.13.4/1.5.8", "seconds": 331.2, "exitCode": 0 },
 *       "latest/latest": { "resolved": "1.15.1/1.15.1", "seconds": 338.0, "exitCode": 0 }
 *     }
 *   }
 * }
 * ```
 */
export interface Durations {
  readonly format: typeof durationsFormat;
  /** `E2E_SHARD` as the run read it, or null for a run of every file. */
  readonly shard: string | null;
  /** The versions the run requested, as {@link requestedVersions} gives them. */
  readonly versions: readonly string[];
  /** The launcher's exit code: 0 when every worker passed. */
  readonly exitCode: number;
  readonly specs: Readonly<Record<string, Readonly<Record<string, WorkerRun>>>>;
}

function isExitCode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "string")
  );
}

function isWorkerRun(value: unknown): value is WorkerRun {
  return (
    isRecord(value) &&
    typeof value.resolved === "string" &&
    isSeconds(value.seconds) &&
    isExitCode(value.exitCode)
  );
}

/**
 * Checks a {@link durationsFile}'s contents, naming `source` on an error. A
 * file of another format is refused rather than read as passing.
 */
export function parseDurations(value: unknown, source: string): Durations {
  if (!isRecord(value) || value.format !== durationsFormat) {
    throw new Error(
      `${source} is not a format ${String(durationsFormat)} ${durationsFile}; run the suite again with this harness`,
    );
  }
  const { shard, versions, exitCode, specs } = value;
  if (
    !(shard === null || typeof shard === "string") ||
    !isStringList(versions) ||
    !isExitCode(exitCode) ||
    !isRecord(specs)
  ) {
    throw new Error(
      `${source} must hold "shard", a string or null, "versions", a list of strings, "exitCode", a whole number, and "specs", an object`,
    );
  }
  const malformed = (spec: string): Error =>
    new Error(
      `${source} must give ${spec} an object of Obsidian versions to "resolved", "seconds", and "exitCode"`,
    );
  const checked: Record<string, Record<string, WorkerRun>> = {};
  for (const [spec, runs] of Object.entries(specs)) {
    if (!isRecord(runs)) throw malformed(spec);
    const workers: Record<string, WorkerRun> = {};
    for (const [version, run] of Object.entries(runs)) {
      if (!isWorkerRun(run)) throw malformed(spec);
      workers[version] = {
        resolved: run.resolved,
        seconds: run.seconds,
        exitCode: run.exitCode,
      };
    }
    checked[spec] = workers;
  }
  return {
    format: durationsFormat,
    shard,
    versions: [...versions],
    exitCode,
    specs: checked,
  };
}

/** A {@link durationsFile} that a run wrote, and where it was found. */
export interface ShardRun {
  readonly source: string;
  readonly durations: Durations;
}

/** Reads and checks the {@link durationsFile} at `file`. */
export async function readDurationsFile(file: string): Promise<ShardRun> {
  return {
    source: file,
    durations: parseDurations(await readJson(file), file),
  };
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
  return Promise.all(files.map(readDurationsFile));
}

/**
 * Every reason the runs do not show `specs` passing on every one of
 * `versions`: no spec files or no versions to expect, a run whose launcher
 * failed or that requested other versions, a spec file that no run names or
 * more than one does, one that a run names but `specs` does not, and one
 * that did not run on an expected version, ran on another, or failed. The
 * expected versions come from the caller, never from the runs, so that a run
 * on too few or the wrong versions fails.
 */
export function coverageProblems(
  specs: readonly string[],
  runs: readonly ShardRun[],
  versions: readonly string[],
): string[] {
  if (specs.length === 0) return ["there are no spec files to expect"];
  if (versions.length === 0)
    return ["there are no Obsidian versions to expect"];
  if (runs.length === 0) return [`no run recorded a ${durationsFile}`];
  const problems: string[] = [];
  const expected = versions.join(" ");
  for (const { source, durations } of runs) {
    if (durations.exitCode !== 0) {
      problems.push(
        `${source}: the run ended with exit code ${String(durations.exitCode)}`,
      );
    }
    if (durations.versions.join(" ") !== expected) {
      problems.push(
        `${source}: the run requested Obsidian ${durations.versions.join(" ") || "(none)"}, not ${expected}`,
      );
    }
    for (const spec of Object.keys(durations.specs)) {
      if (!specs.includes(spec)) {
        problems.push(
          `${source} names ${spec}, which is not one of the spec files expected`,
        );
      }
    }
  }
  for (const spec of specs) {
    const found = runs.filter((run) =>
      Object.hasOwn(run.durations.specs, spec),
    );
    if (found.length === 0) {
      problems.push(`${spec} is in no ${durationsFile}`);
      continue;
    }
    if (found.length > 1) {
      problems.push(
        `${spec} is in more than one ${durationsFile}: ${found.map((run) => run.source).join(", ")}`,
      );
    }
    for (const { durations } of found) {
      const workers = durations.specs[spec] ?? {};
      for (const version of versions) {
        const worker = Object.hasOwn(workers, version)
          ? workers[version]
          : undefined;
        if (worker === undefined) {
          problems.push(`${spec} did not run on Obsidian ${version}`);
        } else if (worker.exitCode !== 0) {
          problems.push(
            `${spec} failed on Obsidian ${version} (${worker.resolved}), with exit code ${String(worker.exitCode)}`,
          );
        }
      }
      for (const version of Object.keys(workers)) {
        if (!versions.includes(version)) {
          problems.push(`${spec} ran on Obsidian ${version}, not expected`);
        }
      }
    }
  }
  return problems;
}

/**
 * Every reason a shard's own run, `run`, or its absence, does not show that
 * this execution of the shard ran and passed exactly the spec files that
 * `assigned` gives it, on every one of `versions`.
 */
export function shardProblems(
  shard: Shard,
  assigned: readonly string[],
  run: ShardRun | undefined,
  versions: readonly string[],
): string[] {
  const label = `${String(shard.index)}/${String(shard.total)}`;
  if (run === undefined) return [`shard ${label} wrote no ${durationsFile}`];
  const problems: string[] = [];
  if (run.durations.shard !== label) {
    problems.push(
      `${run.source} was written by shard ${run.durations.shard ?? "(none)"}, not ${label}`,
    );
  }
  return [...problems, ...coverageProblems(assigned, [run], versions)];
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
        ? Object.values(run.specs[spec] ?? {}).map((worker) => worker.seconds)
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

/** Where {@link shardsCommand} finds the suite, and how it reports. */
export interface ShardsContext {
  readonly specsDir: string;
  readonly weightsFile: string;
  /** `OBSIDIAN_VERSIONS`, which sets the versions to expect. */
  readonly obsidianVersions: string | undefined;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

/** How to run test/e2e/shards.ts. */
export const shardsUsage = [
  "Usage: node test/e2e/shards.ts check <directory>",
  "       node test/e2e/shards.ts shard <i/n> <output directory>",
  "       node test/e2e/shards.ts weights <directory>...",
].join("\n");

function report(problems: readonly string[], context: ShardsContext): number {
  for (const problem of problems) context.error(`error: ${problem}`);
  return problems.length > 0 ? 1 : 0;
}

/**
 * Runs test/e2e/shards.ts with `args`, returning its exit code: 0 when the
 * check passed or the table was written, 1 when it found a problem, and 2 for
 * wrong arguments. Every failure is a one-line message, not a stack trace.
 */
export async function shardsCommand(
  args: readonly string[],
  context: ShardsContext,
): Promise<number> {
  const [command, ...rest] = args;
  const valid =
    (command === "check" && rest.length === 1) ||
    (command === "shard" && rest.length === 2) ||
    (command === "weights" && rest.length > 0);
  if (!valid) {
    context.error(shardsUsage);
    return 2;
  }
  try {
    const specs = await specFiles(context.specsDir);
    const versions = requestedVersions(context.obsidianVersions);
    if (command === "check") {
      const runs = await readDurations(rest[0] ?? "");
      for (const { source, durations } of runs) {
        context.log(
          `${source}: shard ${durations.shard ?? "of every file"}, ${String(Object.keys(durations.specs).length)} spec files, exit code ${String(durations.exitCode)}`,
        );
      }
      const problems = coverageProblems(specs, runs, versions);
      if (problems.length === 0) {
        context.log(
          `The ${String(runs.length)} runs ran and passed each of the ${String(specs.length)} spec files once, on Obsidian ${versions.join(" ")}.`,
        );
      }
      return report(problems, context);
    }
    if (command === "shard") {
      const shard = parseShard(rest[0]);
      if (shard === undefined) {
        context.error("error: name the shard, as i/n");
        return 2;
      }
      const assigned =
        assignShards(
          specs,
          await readWeights(context.weightsFile),
          shard.total,
        )[shard.index - 1] ?? [];
      const file = path.join(rest[1] ?? "", durationsFile);
      const run = await readDurationsFile(file).catch((error: unknown) => {
        if (isRecord(error) && error.code === "ENOENT") return undefined;
        throw error;
      });
      const problems = shardProblems(shard, assigned, run, versions);
      if (problems.length === 0) {
        context.log(
          `Shard ${String(shard.index)}/${String(shard.total)} ran and passed its ${String(assigned.length)} spec files, on Obsidian ${versions.join(" ")}.`,
        );
      }
      return report(problems, context);
    }
    const runs = (await Promise.all(rest.map(readDurations))).flat();
    if (runs.length === 0) {
      return report([`no ${durationsFile} under ${rest.join(", ")}`], context);
    }
    const weights = mergeWeights(
      await readWeights(context.weightsFile),
      runs.map((run) => run.durations),
      specs,
    );
    await writeFile(
      context.weightsFile,
      `${JSON.stringify(weights, null, 2)}\n`,
    );
    context.log(
      `Wrote ${context.weightsFile} from ${String(runs.length)} runs, with ${String(Object.keys(weights).length)} of the ${String(specs.length)} spec files.`,
    );
    return 0;
  } catch (error: unknown) {
    context.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
