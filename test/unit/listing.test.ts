// Holds the material for Obsidian's community directory listing to the limits
// its public documents give, as listing/README.md says.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json" with { type: "json" };

const text = (name: string): string =>
  readFileSync(join("listing", name), "utf8");

/** The size a PNG's header gives. */
function pngSize(path: string): readonly [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.toString("latin1", 1, 4)).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("the listing's material", () => {
  it("has a short description by the directory's rules", () => {
    const description = text("short-description.txt").trim();
    expect(description).toBe(manifest.description);
    expect(description.length).toBeLessThanOrEqual(250);
    expect(description.endsWith(".")).toBe(true);
    expect(description.toLowerCase().startsWith("inkline")).toBe(false);
    expect(description).not.toMatch(/obsidian/i);
    expect(description).not.toMatch(/\bplugin\b/i);
  });

  it("has a long description with no emoji", () => {
    const description = text("long-description.txt");
    expect(description.length).toBeGreaterThan(250);
    expect(description).not.toMatch(/\p{Extended_Pictographic}/u);
    // Each paragraph is one line, so that it pastes without line breaks.
    expect(description.trim().split("\n\n").length).toBe(
      description.trim().split("\n").filter(Boolean).length,
    );
  });

  it("has up to five screenshots of the size and weight the listing takes", () => {
    const names = readdirSync(join("listing", "screenshots"));
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThanOrEqual(5);
    for (const name of names) {
      const path = join("listing", "screenshots", name);
      expect(pngSize(path), name).toEqual([1200, 800]);
      expect(statSync(path).size, name).toBeLessThanOrEqual(5_000_000);
      expect(text("README.md"), name).toContain(`screenshots/${name}`);
    }
  });

  it("has a square icon", () => {
    const [width, height] = pngSize(join("listing", "icon.png"));
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(256);
  });
});
