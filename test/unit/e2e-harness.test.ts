import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  outputDirectory,
  ownerMarker,
  prepareOutput,
  setting,
} from "../e2e/support/harness.ts";

describe("setting", () => {
  it("treats an empty or blank value as unset", () => {
    expect(setting(undefined)).toBeUndefined();
    expect(setting("")).toBeUndefined();
    expect(setting("  ")).toBeUndefined();
    expect(setting("latest/latest")).toBe("latest/latest");
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
  }

  it("claims a directory that does not exist yet", async () => {
    const output = path.join(directory, "new", "e2e");
    await prepareOutput(output);
    expect(await readdir(output)).toEqual([ownerMarker]);
  });

  it("claims an empty directory", async () => {
    await prepareOutput(directory);
    expect(await readdir(directory)).toEqual([ownerMarker]);
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
