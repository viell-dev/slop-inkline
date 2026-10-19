import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanOutput,
  outputDirectory,
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

describe("cleanOutput", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "inkline-harness-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("removes only the harness's own entries", async () => {
    await mkdir(path.join(directory, "logs"));
    await writeFile(path.join(directory, "logs", "wdio.log"), "");
    await mkdir(path.join(directory, "screenshots", "1.14.4-1.14.4"), {
      recursive: true,
    });
    await mkdir(path.join(directory, ".git"));
    await mkdir(path.join(directory, "src"));
    await writeFile(path.join(directory, "src", "uncommitted.ts"), "");

    await cleanOutput(directory);

    expect((await readdir(directory)).sort()).toEqual([".git", "src"]);
    expect(await readdir(path.join(directory, "src"))).toEqual([
      "uncommitted.ts",
    ]);
  });

  it("accepts a directory that does not exist yet", async () => {
    await expect(
      cleanOutput(path.join(directory, "missing")),
    ).resolves.toBeUndefined();
  });
});
