import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignShards,
  coverageProblems,
  defaultWeight,
  durationsFile,
  mergeWeights,
  outputDirectory,
  parseDurations,
  parseShard,
  parseWeights,
  pluginDirectory,
  ownerMarker,
  prepareOutput,
  readDurations,
  readWeights,
  sessionDisplays,
  setting,
  shardSeconds,
  specFiles,
  specName,
  workerDisplay,
  type Durations,
  type ShardRun,
} from "../e2e/support/harness.ts";

const specsDir = path.resolve("test/e2e/specs");
const weightsFile = path.resolve("test/e2e/weights.json");

describe("setting", () => {
  it("treats an empty or blank value as unset", () => {
    expect(setting(undefined)).toBeUndefined();
    expect(setting("")).toBeUndefined();
    expect(setting("  ")).toBeUndefined();
    expect(setting("latest/latest")).toBe("latest/latest");
  });
});

describe("pluginDirectory", () => {
  const root = path.resolve("checkout");

  it("defaults to the build in dist", () => {
    expect(pluginDirectory(undefined, root)).toBe(path.join(root, "dist"));
    expect(pluginDirectory(" ", root)).toBe(path.join(root, "dist"));
  });

  it("resolves a given directory from the checkout", () => {
    expect(pluginDirectory("release", root)).toBe(path.join(root, "release"));
    expect(pluginDirectory("/release", root)).toBe(path.resolve("/release"));
  });
});

describe("outputDirectory", () => {
  const root = path.resolve("checkout");

  it("defaults to test-results/e2e in the checkout", () => {
    const expected = path.join(root, "test-results", "e2e");
    expect(outputDirectory(undefined, root)).toBe(expected);
    expect(outputDirectory("", root)).toBe(expected);
  });

  it("resolves a given directory", () => {
    expect(outputDirectory("/out", root)).toBe(path.resolve("/out"));
  });
});

describe("prepareOutput", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "inkline-harness-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function addPreviousRun(): Promise<void> {
    await mkdir(path.join(directory, "logs"));
    await writeFile(path.join(directory, "logs", "wdio.log"), "");
    await mkdir(path.join(directory, "screenshots", "1.14.4-1.14.4"), {
      recursive: true,
    });
    await mkdir(path.join(directory, "pdfs"));
    await writeFile(path.join(directory, "pdfs", "old-export.pdf"), "%PDF-");
    await writeFile(
      path.join(directory, durationsFile),
      '{"shard":null,"specs":{}}',
    );
  }

  it("claims a directory that does not exist yet", async () => {
    const output = path.join(directory, "new", "e2e");
    await prepareOutput(output);
    expect(await readdir(output)).toEqual([ownerMarker]);
  });

  it("claims an empty directory", async () => {
    await prepareOutput(directory);
    expect(await readdir(directory)).toEqual([ownerMarker]);
    expect(await readFile(path.join(directory, ownerMarker), "utf8")).toBe(
      "Output of Inkline's end-to-end tests. Each run replaces logs/, screenshots/, pdfs/, and durations.json.\n",
    );
  });

  it("replaces its own previous output and keeps anything else", async () => {
    await prepareOutput(directory);
    await addPreviousRun();
    await writeFile(path.join(directory, "notes.txt"), "");

    await prepareOutput(directory);

    expect((await readdir(directory)).sort()).toEqual(
      [ownerMarker, "notes.txt"].sort(),
    );
  });

  it("refuses a non-empty directory it does not own, deleting nothing", async () => {
    await mkdir(path.join(directory, ".git"));
    await mkdir(path.join(directory, "logs"));
    await writeFile(path.join(directory, "logs", "other-application.log"), "");
    await mkdir(path.join(directory, "screenshots"));
    await writeFile(path.join(directory, "screenshots", "drawing.png"), "");

    await expect(prepareOutput(directory)).rejects.toThrow(
      "is not Inkline's end-to-end output",
    );

    expect((await readdir(directory)).sort()).toEqual(
      [".git", "logs", "screenshots"].sort(),
    );
    expect(await readdir(path.join(directory, "logs"))).toEqual([
      "other-application.log",
    ]);
    expect(await readdir(path.join(directory, "screenshots"))).toEqual([
      "drawing.png",
    ]);
  });
});

describe("sessionDisplays and workerDisplay", () => {
  const four = ":99 :100 :101 :102";

  it("gives each version a display of its own", () => {
    const displays = sessionDisplays(four, 4);
    expect(displays).toEqual([":99", ":100", ":101", ":102"]);
    expect(workerDisplay("0-0", displays)).toBe(":99");
    expect(workerDisplay("1-27", displays)).toBe(":100");
    expect(workerDisplay("3-1", displays)).toBe(":102");
    expect(workerDisplay("x-1", displays)).toBeUndefined();
  });

  it("refuses more versions than displays rather than share one", () => {
    expect(() => sessionDisplays(four, 5)).toThrow(
      "the end-to-end session has 4 displays, one for each Obsidian version, but OBSIDIAN_VERSIONS lists 5 versions",
    );
  });

  it("leaves the display alone when the session started none", () => {
    expect(sessionDisplays(undefined, 5)).toEqual([]);
    expect(sessionDisplays(" ", 5)).toEqual([]);
    expect(workerDisplay("0-0", [])).toBeUndefined();
  });
});

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

  // A failure here means the spec files' times have moved since the table
  // was measured. Refresh it from a recent run of CI on main, as
  // CONTRIBUTING.md's Tests say:
  //   gh run download <run-id> --pattern 'e2e-results-*' --dir <dir>
  //   node test/e2e/shards.ts weights <dir>
  it("balances four shards to within 10% by the table", () => {
    const totals = assignShards(specs, weights, 4).map((shard) =>
      shardSeconds(shard, weights),
    );
    expect(Math.max(...totals)).toBeLessThanOrEqual(Math.min(...totals) * 1.1);
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

describe("coverageProblems", () => {
  const specs = ["a.e2e.ts", "b.e2e.ts", "c.e2e.ts"];
  const both = { "1.13.4/1.13.4": 10, "1.15.2/1.15.2": 12 };

  function run(
    source: string,
    times: Durations["specs"],
    shard: string | null = null,
  ): ShardRun {
    return { source, durations: { shard, specs: times } };
  }

  it("passes when the shards ran every spec file once on every version", () => {
    expect(
      coverageProblems(specs, [
        run("1", { "a.e2e.ts": both }, "1/2"),
        run("2", { "b.e2e.ts": both, "c.e2e.ts": both }, "2/2"),
      ]),
    ).toEqual([]);
  });

  it("passes when the latest version moved between shards", () => {
    expect(
      coverageProblems(specs, [
        run("1", { "a.e2e.ts": both, "b.e2e.ts": both }),
        run("2", { "c.e2e.ts": { "1.13.4/1.13.4": 1, "1.15.3/1.15.3": 1 } }),
      ]),
    ).toEqual([]);
  });

  it("fails, naming the spec file, when one ran nowhere", () => {
    expect(
      coverageProblems(specs, [
        run("1", { "a.e2e.ts": both }),
        run("2", { "c.e2e.ts": both }),
      ]),
    ).toEqual(["b.e2e.ts ran in no shard"]);
  });

  it("fails, naming the spec file, when one ran in two shards", () => {
    expect(
      coverageProblems(specs, [
        run("1", { "a.e2e.ts": both, "b.e2e.ts": both }),
        run("2", { "b.e2e.ts": both, "c.e2e.ts": both }),
      ]),
    ).toEqual(["b.e2e.ts ran in more than one shard: 1, 2"]);
  });

  it("fails, naming the spec file, when one ran on fewer versions", () => {
    expect(
      coverageProblems(specs, [
        run("1", { "a.e2e.ts": both, "b.e2e.ts": both }),
        run("2", { "c.e2e.ts": { "1.15.2/1.15.2": 12 } }),
      ]),
    ).toEqual(["c.e2e.ts ran on 1 Obsidian versions, where others ran on 2"]);
  });

  it("fails when nothing ran on any version, or nothing was recorded", () => {
    expect(
      coverageProblems(specs, [
        run("1", { "a.e2e.ts": {}, "b.e2e.ts": {}, "c.e2e.ts": {} }),
      ]),
    ).toEqual(["no spec file ran on any Obsidian version"]);
    expect(coverageProblems(specs, [])).toEqual([
      "no shard recorded a durations.json",
    ]);
  });

  it("fails when a run names a spec file that does not exist", () => {
    expect(
      coverageProblems(specs, [
        run("1", {
          "a.e2e.ts": both,
          "b.e2e.ts": both,
          "c.e2e.ts": both,
          "gone.e2e.ts": both,
        }),
      ]),
    ).toEqual(["1 names gone.e2e.ts, which is not a spec file"]);
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
        JSON.stringify({
          shard: `${shard}/2`,
          specs: { [`${shard}.e2e.ts`]: { "1.15.2/1.15.2": 3 } },
        }),
      );
    }
    const runs = await readDurations(directory);
    expect(runs.map((found) => found.durations.shard)).toEqual(["1/2", "2/2"]);
    expect(runs[0]?.source).toBe(
      path.join(directory, "e2e-results-1", durationsFile),
    );
  });

  it("refuses a file of another shape, naming it", () => {
    expect(() => parseDurations({ specs: {} }, "d.json")).toThrow(
      'd.json must hold "shard", a string or null, and "specs", an object',
    );
    expect(() =>
      parseDurations({ shard: null, specs: { "a.e2e.ts": 3 } }, "d.json"),
    ).toThrow("d.json must give a.e2e.ts an object of Obsidian versions");
    expect(
      parseDurations({ shard: "1/4", specs: { "a.e2e.ts": { v: 3 } } }, "d"),
    ).toEqual({ shard: "1/4", specs: { "a.e2e.ts": { v: 3 } } });
  });
});

describe("mergeWeights", () => {
  it("takes the slower version's whole seconds, keeps unmeasured weights, and drops the rest", () => {
    const old = { "a.e2e.ts": 10, "b.e2e.ts": 20, "gone.e2e.ts": 30 };
    const runs: Durations[] = [
      { shard: "1/2", specs: { "c.e2e.ts": { old: 4.4, new: 6.5 } } },
      { shard: "2/2", specs: { "a.e2e.ts": { old: 12.4, new: 11.9 } } },
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
