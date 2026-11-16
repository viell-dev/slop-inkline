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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultObsidianVersions,
  durationsFile,
  outputDirectory,
  ownerMarker,
  pluginDirectory,
  prepareOutput,
  requestedVersions,
  sessionDisplays,
  setting,
  workerDisplay,
  workerVersion,
} from "../e2e/support/harness.ts";

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

describe("workerVersion and requestedVersions", () => {
  it("reads a worker's version index from its id", () => {
    expect(workerVersion("0-0")).toBe(0);
    expect(workerVersion("1-27")).toBe(1);
    expect(workerVersion("x-1")).toBeUndefined();
    expect(workerVersion("-1")).toBeUndefined();
    expect(workerVersion("")).toBeUndefined();
  });

  it("requests the default versions unless OBSIDIAN_VERSIONS names others", () => {
    expect(defaultObsidianVersions).toEqual([
      "earliest/earliest",
      "latest/latest",
    ]);
    expect(requestedVersions(undefined)).toEqual(defaultObsidianVersions);
    expect(requestedVersions(" ")).toEqual(defaultObsidianVersions);
    expect(requestedVersions("latest/latest")).toEqual(["latest/latest"]);
    // As wdio-obsidian-service splits them, at spaces or commas.
    expect(requestedVersions(" 1.13.4/1.5.8,latest/latest ")).toEqual([
      "1.13.4/1.5.8",
      "latest/latest",
    ]);
  });
});
