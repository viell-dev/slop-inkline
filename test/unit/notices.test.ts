import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleBanner } from "../../scripts/lib/notices.ts";

describe("bundleBanner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "inkline-notices-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const licence = async (name: string, text: string): Promise<void> => {
    const directory = path.join(root, "node_modules", name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "LICENSE"), text);
  };

  it("holds the licence of the package the plugin really bundles", async () => {
    const banner = await bundleBanner(process.cwd(), ["perfect-freehand"]);
    expect(banner).toContain("Includes perfect-freehand:");
    expect(banner).toContain("Copyright (c) 2021 Stephen Ruiz Ltd");
    expect(banner).toContain("Permission is hereby granted");
    expect(banner.startsWith("/* Inkline, built from")).toBe(true);
    expect(banner.endsWith("*/")).toBe(true);
    expect(banner.slice(2, -2)).not.toContain("*/");
  });

  it("names each package, in order, whatever order it is given", async () => {
    await licence("b", "B's licence\n");
    await licence("a", "A's licence\n");
    const banner = await bundleBanner(root, ["b", "a"]);
    expect(banner.indexOf("Includes a:")).toBeLessThan(
      banner.indexOf("Includes b:"),
    );
    expect(banner).toContain("A's licence");
  });

  it("refuses a bundled package without a licence file", async () => {
    await expect(bundleBanner(root, ["none"])).rejects.toThrow(
      "none is bundled, but has no licence file",
    );
  });

  it("refuses a licence that would end the comment", async () => {
    await licence("odd", "ends */ here");
    await expect(bundleBanner(root, ["odd"])).rejects.toThrow(
      "odd's licence ends a comment",
    );
  });
});
