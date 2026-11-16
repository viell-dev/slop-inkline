import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultObsidianVersions,
  durationsFile,
} from "../e2e/support/harness.ts";
import {
  assignShards,
  coverageProblems,
  defaultWeight,
  durationsFormat,
  mergeWeights,
  parseDurations,
  parseShard,
  parseWeights,
  readDurations,
  readWeights,
  shardProblems,
  shardSeconds,
  shardsCommand,
  shardsUsage,
  specFiles,
  specName,
  type Durations,
  type ShardRun,
  type WorkerRun,
} from "../e2e/support/shards.ts";

const specsDir = path.resolve("test/e2e/specs");
const weightsFile = path.resolve("test/e2e/weights.json");

describe("parseShard", () => {
  it("runs every spec file when E2E_SHARD is unset or blank", () => {
    expect(parseShard(undefined)).toBeUndefined();
    expect(parseShard("")).toBeUndefined();
    expect(parseShard("  ")).toBeUndefined();
  });

  it("reads i/n", () => {
    expect(parseShard("2/4")).toEqual({ index: 2, total: 4 });
    expect(parseShard("1/1")).toEqual({ index: 1, total: 1 });
    expect(parseShard("4/4")).toEqual({ index: 4, total: 4 });
    expect(parseShard(" 10/12 ")).toEqual({ index: 10, total: 12 });
  });

  it.each([
    "0/4",
    "5/4",
    "2",
    "2/",
    "/4",
    "2/0",
    "-1/4",
    "1.5/4",
    "2/4/6",
    "02/4",
    "two/four",
    "2 / 4",
    "2-4",
  ])("refuses %j, naming the variable and the form", (value) => {
    expect(() => parseShard(value)).toThrow(
      `E2E_SHARD is "${value}", but must be "i/n" with whole numbers 1 ≤ i ≤ n, such as "2/4", or unset to run every spec file`,
    );
  });
});

describe("specName", () => {
  const directory = path.resolve("checkout", "test", "e2e", "specs");

  it("names a spec by its path under the specs, with forward slashes", () => {
    const file = path.join(directory, "area", "editor.e2e.ts");
    expect(specName(file, directory)).toBe("area/editor.e2e.ts");
    expect(specName(pathToFileURL(file).href, directory)).toBe(
      "area/editor.e2e.ts",
    );
  });
});

describe("specFiles", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "inkline-specs-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("lists spec files at any depth, by forward-slashed paths", async () => {
    await mkdir(path.join(directory, "area", "deeper"), { recursive: true });
    for (const file of [
      "b.e2e.ts",
      "a.e2e.ts",
      "helper.ts",
      "notes.md",
      path.join("area", "c.e2e.ts"),
      path.join("area", "deeper", "d.e2e.ts"),
      path.join("area", "support.ts"),
    ]) {
      await writeFile(path.join(directory, file), "");
    }
    expect(await specFiles(directory)).toEqual([
      "a.e2e.ts",
      "area/c.e2e.ts",
      "area/deeper/d.e2e.ts",
      "b.e2e.ts",
    ]);
  });
});

describe("weights and shards", () => {
  let specs: string[];
  let weights: Record<string, number>;

  beforeEach(async () => {
    specs = await specFiles(specsDir);
    weights = { ...(await readWeights(weightsFile)) };
  });

  it("lists the spec files on disk", () => {
    expect(specs.length).toBeGreaterThan(0);
    expect(specs).toContain("editor.e2e.ts");
    expect(specs).toEqual([...specs].sort());
  });

  // So that the table cannot rot: a spec file renamed or removed takes its
  // weight with it, as `node test/e2e/shards.ts weights` also does.
  it("weights only spec files that exist", () => {
    expect(
      Object.keys(weights).filter((spec) => !specs.includes(spec)),
    ).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "puts every spec file in exactly one of %i shards",
    (total) => {
      const shards = assignShards(specs, weights, total);
      expect(shards).toHaveLength(total);
      expect(shards.flat().sort()).toEqual(specs);
      for (const shard of shards) {
        expect(shard.length).toBeGreaterThan(0);
        expect(shard).toEqual([...shard].sort());
      }
      // The same assignment, whatever order the files are listed in.
      expect(assignShards([...specs].reverse(), weights, total)).toEqual(
        shards,
      );
      expect(assignShards(specs, weights, total)).toEqual(shards);
    },
  );

  it.each([0, -1, 1.5, Number.NaN])("refuses %s shards", (total) => {
    expect(() => assignShards(specs, weights, total)).toThrow(
      `the spec files need at least 1 shard, not ${String(total)}`,
    );
  });

  // This reads only the table and the list of spec files, so it cannot tell
  // whether the table still matches how long the files take; the shards'
  // logs and durations.json show that. A failure means the table cannot be
  // split into four shards within 10% of each other, because one file
  // outweighs a fair share: split that file, or change the number of shards
  // in .github/workflows/ci.yml and here.
  it("can split the table into four shards within 10% of each other", () => {
    const totals = assignShards(specs, weights, 4).map((shard) =>
      shardSeconds(shard, weights),
    );
    expect(
      Math.max(...totals),
      `four shards weigh ${totals.join(", ")} s: one spec file outweighs a fair share, so split it, or change the number of shards in ci.yml and in this test`,
    ).toBeLessThanOrEqual(Math.min(...totals) * 1.1);
  });

  it("places a spec file that the table does not list", () => {
    const added = [...specs, "zz-new.e2e.ts"];
    const shards = assignShards(added, weights, 4);
    expect(shards.flat().sort()).toEqual(added);
    expect(shardSeconds(["zz-new.e2e.ts"], weights)).toBe(
      defaultWeight(weights),
    );
  });

  it("takes the heaviest first, to the lightest shard, lowest on a tie", () => {
    const table = { a: 5, b: 4, c: 3, d: 3, e: 1 };
    expect(assignShards(Object.keys(table), table, 2)).toEqual([
      ["a", "d"],
      ["b", "c", "e"],
    ]);
    expect(assignShards(["x", "y"], {}, 3)).toEqual([["x"], ["y"], []]);
  });

  it("weighs an unlisted file by the median, or 1 for an empty table", () => {
    expect(defaultWeight({})).toBe(1);
    expect(defaultWeight({ a: 7 })).toBe(7);
    expect(defaultWeight({ a: 1, b: 100, c: 3 })).toBe(3);
    expect(defaultWeight({ a: 1, b: 100, c: 3, d: 5 })).toBe(4);
    expect(shardSeconds(["a", "z"], { a: 1, b: 100, c: 3 })).toBe(4);
  });

  it("refuses a table that is not spec files to seconds", () => {
    expect(() => parseWeights([], "w.json")).toThrow(
      "w.json must be an object of spec files to seconds",
    );
    expect(() => parseWeights({ "a.e2e.ts": "5" }, "w.json")).toThrow(
      'w.json gives a.e2e.ts "5", not a number of seconds',
    );
    expect(() => parseWeights({ "a.e2e.ts": -1 }, "w.json")).toThrow(
      "not a number of seconds",
    );
  });
});

const pairs = [...defaultObsidianVersions];

/** A worker that ran a spec file on a version, passing unless told. */
function worker(exitCode = 0, resolved = "1.15.1/1.15.1"): WorkerRun {
  return { resolved, seconds: 10, exitCode };
}

/** Workers that passed a spec file on each of `versions`. */
function passedOn(
  versions: readonly string[] = pairs,
): Record<string, WorkerRun> {
  return Object.fromEntries(versions.map((version) => [version, worker()]));
}

function record(
  specs: Durations["specs"],
  options: Partial<Pick<Durations, "shard" | "exitCode" | "versions">> = {},
): Durations {
  return {
    format: durationsFormat,
    shard: options.shard ?? null,
    versions: options.versions ?? pairs,
    exitCode: options.exitCode ?? 0,
    specs,
  };
}

function run(
  source: string,
  specs: Durations["specs"],
  options: Partial<Pick<Durations, "shard" | "exitCode" | "versions">> = {},
): ShardRun {
  return { source, durations: record(specs, options) };
}

describe("coverageProblems", () => {
  const specs = ["a.e2e.ts", "b.e2e.ts", "c.e2e.ts"];

  it("passes when the shards ran and passed every spec file once on every version", () => {
    expect(
      coverageProblems(
        specs,
        [
          run("1", { "a.e2e.ts": passedOn() }, { shard: "1/2" }),
          run(
            "2",
            { "b.e2e.ts": passedOn(), "c.e2e.ts": passedOn() },
            { shard: "2/2" },
          ),
        ],
        pairs,
      ),
    ).toEqual([]);
  });

  it("passes when latest resolved to another version in another shard", () => {
    expect(
      coverageProblems(
        specs,
        [
          run("1", { "a.e2e.ts": passedOn(), "b.e2e.ts": passedOn() }),
          run("2", {
            "c.e2e.ts": {
              "earliest/earliest": worker(0, "1.13.4/1.5.8"),
              "latest/latest": worker(0, "1.15.2/1.15.2"),
            },
          }),
        ],
        pairs,
      ),
    ).toEqual([]);
  });

  it("fails, naming the spec file, when one ran nowhere", () => {
    expect(
      coverageProblems(
        specs,
        [
          run("1", { "a.e2e.ts": passedOn() }),
          run("2", { "c.e2e.ts": passedOn() }),
        ],
        pairs,
      ),
    ).toEqual(["b.e2e.ts is in no durations.json"]);
  });

  it("fails, naming the spec file, when one ran in two shards", () => {
    expect(
      coverageProblems(
        specs,
        [
          run("1", { "a.e2e.ts": passedOn(), "b.e2e.ts": passedOn() }),
          run("2", { "b.e2e.ts": passedOn(), "c.e2e.ts": passedOn() }),
        ],
        pairs,
      ),
    ).toEqual(["b.e2e.ts is in more than one durations.json: 1, 2"]);
  });

  // A partial re-run: shards 2 and 3 failed, only shard 2 was run again and
  // passed, and shard 3's first record, uploaded after its failure, is still
  // the newest of its name. Every spec file is there once, so only the
  // recorded exit codes can tell.
  it("fails, naming the spec file and version, when a shard's record holds a failure", () => {
    expect(
      coverageProblems(
        specs,
        [
          run("e2e-results-1", { "a.e2e.ts": passedOn() }, { shard: "1/3" }),
          run("e2e-results-2", { "b.e2e.ts": passedOn() }, { shard: "2/3" }),
          run(
            "e2e-results-3",
            {
              "c.e2e.ts": {
                "earliest/earliest": worker(0, "1.13.4/1.5.8"),
                "latest/latest": worker(1),
              },
            },
            { shard: "3/3", exitCode: 1 },
          ),
        ],
        pairs,
      ),
    ).toEqual([
      "e2e-results-3: the run ended with exit code 1",
      "c.e2e.ts failed on Obsidian latest/latest (1.15.1/1.15.1), with exit code 1",
    ]);
  });

  it("fails when a launcher failed, though every worker it recorded passed", () => {
    expect(
      coverageProblems(
        specs,
        [
          run(
            "1",
            {
              "a.e2e.ts": passedOn(),
              "b.e2e.ts": passedOn(),
              "c.e2e.ts": passedOn(),
            },
            { exitCode: 1 },
          ),
        ],
        pairs,
      ),
    ).toEqual(["1: the run ended with exit code 1"]);
  });

  it("fails when every spec file ran on only one of the two versions", () => {
    const one = ["latest/latest"];
    expect(
      coverageProblems(
        specs,
        [
          run(
            "1",
            {
              "a.e2e.ts": passedOn(one),
              "b.e2e.ts": passedOn(one),
              "c.e2e.ts": passedOn(one),
            },
            { versions: one },
          ),
        ],
        pairs,
      ),
    ).toEqual([
      "1: the run requested Obsidian latest/latest, not earliest/earliest latest/latest",
      "a.e2e.ts did not run on Obsidian earliest/earliest",
      "b.e2e.ts did not run on Obsidian earliest/earliest",
      "c.e2e.ts did not run on Obsidian earliest/earliest",
    ]);
  });

  it("fails when the spec files ran on two versions, but the wrong ones", () => {
    const wrong = ["latest/latest", "1.14.4/1.14.4"];
    const problems = coverageProblems(
      specs,
      [
        run(
          "1",
          {
            "a.e2e.ts": passedOn(wrong),
            "b.e2e.ts": passedOn(wrong),
            "c.e2e.ts": passedOn(wrong),
          },
          { versions: wrong },
        ),
      ],
      pairs,
    );
    expect(problems).toContain(
      "a.e2e.ts did not run on Obsidian earliest/earliest",
    );
    expect(problems).toContain(
      "a.e2e.ts ran on Obsidian 1.14.4/1.14.4, not expected",
    );
  });

  it("fails rather than pass with nothing to expect or nothing recorded", () => {
    const all = run("1", { "a.e2e.ts": passedOn() });
    expect(coverageProblems([], [all], pairs)).toEqual([
      "there are no spec files to expect",
    ]);
    expect(coverageProblems(specs, [all], [])).toEqual([
      "there are no Obsidian versions to expect",
    ]);
    expect(coverageProblems(specs, [], pairs)).toEqual([
      "no run recorded a durations.json",
    ]);
  });

  it("fails when a run names a spec file that is not expected", () => {
    expect(
      coverageProblems(
        specs,
        [
          run("1", {
            "a.e2e.ts": passedOn(),
            "b.e2e.ts": passedOn(),
            "c.e2e.ts": passedOn(),
            "gone.e2e.ts": passedOn(),
          }),
        ],
        pairs,
      ),
    ).toEqual([
      "1 names gone.e2e.ts, which is not one of the spec files expected",
    ]);
  });
});

describe("shardProblems", () => {
  const shard = { index: 2, total: 3 };
  const assigned = ["b.e2e.ts", "d.e2e.ts"];
  const own = run(
    "out/durations.json",
    { "b.e2e.ts": passedOn(), "d.e2e.ts": passedOn() },
    { shard: "2/3" },
  );

  it("passes when this execution ran and passed exactly its spec files", () => {
    expect(shardProblems(shard, assigned, own, pairs)).toEqual([]);
  });

  // A re-run whose tests exited 0 having run nothing: this execution wrote
  // no record, and the artifact of the earlier, failed attempt is the newest
  // of its name. The shard's own check fails, and so would e2e's.
  it("fails a re-run that wrote no record, at the shard and at e2e", () => {
    const earlier = run(
      "e2e-results-2/durations.json",
      {
        "b.e2e.ts": passedOn(),
        "d.e2e.ts": { ...passedOn(), "latest/latest": worker(1) },
      },
      { shard: "2/3", exitCode: 1 },
    );
    expect(shardProblems(shard, assigned, undefined, pairs)).toEqual([
      "shard 2/3 wrote no durations.json",
    ]);
    expect(coverageProblems(assigned, [earlier], pairs)).toEqual([
      "e2e-results-2/durations.json: the run ended with exit code 1",
      "d.e2e.ts failed on Obsidian latest/latest (1.15.1/1.15.1), with exit code 1",
    ]);
  });

  it("fails a record of another shard, or of other spec files", () => {
    expect(
      shardProblems(
        shard,
        assigned,
        { ...own, durations: { ...own.durations, shard: "3/3" } },
        pairs,
      ),
    ).toEqual(["out/durations.json was written by shard 3/3, not 2/3"]);
    expect(
      shardProblems(
        shard,
        assigned,
        run(
          "out",
          { "b.e2e.ts": passedOn(), "c.e2e.ts": passedOn() },
          { shard: "2/3" },
        ),
        pairs,
      ),
    ).toEqual([
      "out names c.e2e.ts, which is not one of the spec files expected",
      "d.e2e.ts is in no durations.json",
    ]);
  });
});

describe("durations", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "inkline-durations-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads every durations.json under a directory, as artifacts unpack", async () => {
    for (const shard of ["1", "2"]) {
      const artifact = path.join(directory, `e2e-results-${shard}`);
      await mkdir(path.join(artifact, "logs"), { recursive: true });
      await writeFile(
        path.join(artifact, durationsFile),
        JSON.stringify(
          record({ [`${shard}.e2e.ts`]: passedOn() }, { shard: `${shard}/2` }),
        ),
      );
    }
    const runs = await readDurations(directory);
    expect(runs.map((found) => found.durations.shard)).toEqual(["1/2", "2/2"]);
    expect(runs[0]?.source).toBe(
      path.join(directory, "e2e-results-1", durationsFile),
    );
  });

  it("refuses the first format, which recorded no exit codes", () => {
    expect(() =>
      parseDurations(
        { shard: "1/4", specs: { "a.e2e.ts": { "1.15.1/1.15.1": 3 } } },
        "d.json",
      ),
    ).toThrow(
      "d.json is not a format 2 durations.json; run the suite again with this harness",
    );
  });

  it("refuses a file of another shape, naming it", () => {
    const good = record({ "a.e2e.ts": passedOn() });
    expect(parseDurations(JSON.parse(JSON.stringify(good)), "d")).toEqual(good);
    // Built from the checked parts, so anything else the file holds is left
    // behind.
    expect(
      parseDurations(
        {
          ...good,
          extra: true,
          specs: {
            "a.e2e.ts": {
              "latest/latest": { ...worker(), extra: true },
            },
          },
        },
        "d",
      ),
    ).toEqual({
      ...good,
      specs: { "a.e2e.ts": { "latest/latest": worker() } },
    });
    for (const bad of [
      { ...good, shard: 2 },
      { ...good, versions: "latest/latest" },
      { ...good, exitCode: undefined },
      { ...good, exitCode: 0.5 },
      { ...good, specs: [] },
    ]) {
      expect(() => parseDurations(bad, "d.json")).toThrow(
        'd.json must hold "shard", a string or null, "versions", a list of strings, "exitCode", a whole number, and "specs", an object',
      );
    }
    for (const workers of [
      3,
      { "latest/latest": 3 },
      { "latest/latest": { resolved: "1.15.1/1.15.1", seconds: 3 } },
      { "latest/latest": { seconds: 3, exitCode: 0 } },
    ]) {
      expect(() =>
        parseDurations({ ...good, specs: { "a.e2e.ts": workers } }, "d.json"),
      ).toThrow(
        'd.json must give a.e2e.ts an object of Obsidian versions to "resolved", "seconds", and "exitCode"',
      );
    }
  });
});

describe("mergeWeights", () => {
  it("takes the slower version's whole seconds, keeps unmeasured weights, and drops the rest", () => {
    const old = { "a.e2e.ts": 10, "b.e2e.ts": 20, "gone.e2e.ts": 30 };
    const timed = (seconds: number): WorkerRun => ({
      ...worker(),
      seconds,
    });
    const runs: Durations[] = [
      record({
        "c.e2e.ts": {
          "earliest/earliest": timed(4.4),
          "latest/latest": timed(6.5),
        },
      }),
      record({
        "a.e2e.ts": {
          "earliest/earliest": timed(12.4),
          "latest/latest": timed(11.9),
        },
      }),
    ];
    const merged = mergeWeights(old, runs, [
      "c.e2e.ts",
      "b.e2e.ts",
      "a.e2e.ts",
      "d.e2e.ts",
    ]);
    expect(merged).toEqual({ "a.e2e.ts": 12, "b.e2e.ts": 20, "c.e2e.ts": 7 });
    expect(Object.keys(merged)).toEqual(["a.e2e.ts", "b.e2e.ts", "c.e2e.ts"]);
  });
});

describe("shardsCommand", () => {
  let directory: string;
  let specs: string;
  let weights: string;
  let output: string[];
  let errors: string[];

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "inkline-shards-"));
    specs = path.join(directory, "specs");
    weights = path.join(directory, "weights.json");
    await mkdir(specs);
    for (const file of ["a.e2e.ts", "b.e2e.ts", "c.e2e.ts"]) {
      await writeFile(path.join(specs, file), "");
    }
    // a alone outweighs b and c together, so 2 shards give [a] and [b, c].
    await writeFile(weights, JSON.stringify({ "a.e2e.ts": 9, "b.e2e.ts": 2 }));
    output = [];
    errors = [];
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function command(
    args: readonly string[],
    obsidianVersions?: string,
  ): Promise<number> {
    return shardsCommand(args, {
      specsDir: specs,
      weightsFile: weights,
      obsidianVersions,
      log: (message) => output.push(message),
      error: (message) => errors.push(message),
    });
  }

  async function write(dir: string, durations: unknown): Promise<void> {
    await mkdir(path.join(directory, dir), { recursive: true });
    await writeFile(
      path.join(directory, dir, durationsFile),
      typeof durations === "string" ? durations : JSON.stringify(durations),
    );
  }

  it.each([
    [[]],
    [["bogus", "x"]],
    [["check"]],
    [["check", "a", "b"]],
    [["shard", "1/2"]],
    [["shard", "1/2", "a", "b"]],
    [["weights"]],
  ])("prints the usage and exits 2 for %j", async (args) => {
    expect(await command(args)).toBe(2);
    expect(errors).toEqual([shardsUsage]);
  });

  it("checks downloaded shards: 0 when they cover the suite, 1 when not", async () => {
    await write(
      "runs/e2e-results-1",
      record({ "a.e2e.ts": passedOn() }, { shard: "1/2" }),
    );
    await write(
      "runs/e2e-results-2",
      record(
        { "b.e2e.ts": passedOn(), "c.e2e.ts": passedOn() },
        { shard: "2/2" },
      ),
    );
    expect(await command(["check", path.join(directory, "runs")])).toBe(0);
    expect(errors).toEqual([]);
    expect(output.at(-1)).toBe(
      "The 2 runs ran and passed each of the 3 spec files once, on Obsidian earliest/earliest latest/latest.",
    );

    // Told to expect other versions, the same records fail.
    expect(
      await command(["check", path.join(directory, "runs")], "latest/latest"),
    ).toBe(1);
    expect(errors[0]).toContain("the run requested Obsidian");
  });

  it("checks a shard's own output", async () => {
    await write("out", record({ "a.e2e.ts": passedOn() }, { shard: "1/2" }));
    expect(await command(["shard", "1/2", path.join(directory, "out")])).toBe(
      0,
    );
    expect(errors).toEqual([]);

    expect(await command(["shard", "2/2", path.join(directory, "out")])).toBe(
      1,
    );
    expect(errors).toContain(
      `error: ${path.join(directory, "out", durationsFile)} was written by shard 1/2, not 2/2`,
    );

    errors = [];
    expect(await command(["shard", "1/2", path.join(directory, "none")])).toBe(
      1,
    );
    expect(errors).toEqual(["error: shard 1/2 wrote no durations.json"]);

    errors = [];
    expect(await command(["shard", "3/2", path.join(directory, "out")])).toBe(
      1,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^error: E2E_SHARD is "3\/2"/);
  });

  it("ends a malformed or older durations.json in one line, exit code 1", async () => {
    await write("old/e2e-results-1", {
      shard: "1/2",
      specs: { "a.e2e.ts": { "1.15.1/1.15.1": 3 } },
    });
    expect(await command(["check", path.join(directory, "old")])).toBe(1);
    expect(errors).toEqual([
      `error: ${path.join(directory, "old", "e2e-results-1", durationsFile)} is not a format 2 durations.json; run the suite again with this harness`,
    ]);

    errors = [];
    await write("broken/e2e-results-1", "{ not json");
    expect(await command(["check", path.join(directory, "broken")])).toBe(1);
    expect(errors).toEqual([
      `error: ${path.join(directory, "broken", "e2e-results-1", durationsFile)} is not JSON`,
    ]);

    errors = [];
    expect(await command(["check", path.join(directory, "missing")])).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^error: ENOENT/);
  });

  it("rewrites the weights from downloaded runs", async () => {
    const timed = (seconds: number): WorkerRun => ({ ...worker(), seconds });
    await write(
      "runs/e2e-results-1",
      record({
        "c.e2e.ts": {
          "earliest/earliest": timed(3.6),
          "latest/latest": timed(1),
        },
      }),
    );
    expect(await command(["weights", path.join(directory, "runs")])).toBe(0);
    expect(await readFile(weights, "utf8")).toBe(
      '{\n  "a.e2e.ts": 9,\n  "b.e2e.ts": 2,\n  "c.e2e.ts": 4\n}\n',
    );

    expect(await command(["weights", path.join(directory, "specs")])).toBe(1);
    expect(errors).toEqual([
      `error: no durations.json under ${path.join(directory, "specs")}`,
    ]);
  });
});
