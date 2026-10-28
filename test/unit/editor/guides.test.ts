import { describe, expect, it } from "vitest";
import {
  cropSpan,
  fontGrid,
  fontGuides,
  joinSpans,
  type Guide,
} from "../../../src/editor/guides.ts";

describe("fontGuides", () => {
  it("places the font's lines in the line box, from its baseline", () => {
    expect(
      fontGuides({ ascent: 1, descent: 0.25, capHeight: 0.75, xHeight: 0.5 }),
    ).toEqual([
      { name: "ascender", y: 16 },
      { name: "cap height", y: 48 },
      { name: "x-height", y: 80 },
      { name: "baseline", y: 144 },
      { name: "descender", y: 176 },
    ]);
  });

  it("leaves out lines outside the line box", () => {
    expect(
      fontGuides({
        ascent: 1.5,
        descent: 0.5,
        capHeight: 0.7,
        xHeight: 0.5,
      }).map((guide) => guide.name),
    ).toEqual(["cap height", "x-height", "baseline"]);
  });
});

describe("fontGrid", () => {
  // Inter's metrics, whose x-height is just over 4 cells of the 1/8 em grid
  // and its cap height just under 6.
  const inter = fontGuides({
    ascent: 1984 / 2048,
    descent: 496 / 2048,
    capHeight: 1490 / 2048,
    xHeight: 1118 / 2048,
  });
  const xHeight = (1118 / 2048) * 128;
  const at = (lines: readonly Guide[], name: string): number =>
    lines.find((line) => line.name === name)?.y ?? Number.NaN;
  /** How many cells lie between two rows of `rows`. */
  const cells = (rows: readonly number[], from: number, to: number) =>
    Math.abs(rows.indexOf(to) - rows.indexOf(from));

  it("puts a row on every line, and the chosen cells across the x-height", () => {
    const { spacing, rows } = fontGrid(inter, xHeight, 5);
    for (const line of inter) expect(rows).toContain(line.y);
    expect(cells(rows, 144, at(inter, "x-height"))).toBe(5);
    // The cap height, 23 pixels above the x-height, is 2 cells above it.
    expect(cells(rows, 144, at(inter, "cap height"))).toBe(7);
    expect(cells(rows, 144, at(inter, "descender"))).toBe(2);
    // The columns are as far apart as the x-height's rows, in whole units.
    expect(spacing).toBe(14);
    expect(Math.abs(spacing - xHeight / 5)).toBeLessThan(1 / 32);
    expect(cells(fontGrid(inter, xHeight, 8).rows, 144, 74.125)).toBe(8);
  });

  it("divides the space between neighbouring lines evenly", () => {
    const { rows } = fontGrid(inter, xHeight, 5);
    const between = (from: number, to: number) => {
      const band = rows.filter((y) => y >= from && y <= to);
      return band.slice(1).map((y, index) => y - (band[index] ?? 0));
    };
    for (const [from, to] of [
      [at(inter, "ascender"), at(inter, "cap height")],
      [at(inter, "cap height"), at(inter, "x-height")],
      [at(inter, "x-height"), 144],
      [144, at(inter, "descender")],
    ] as const) {
      const steps = between(from, to);
      for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? 0, 9);
    }
  });

  it("goes on a spacing apart beyond the outermost lines, within the box", () => {
    const { spacing, rows } = fontGrid(inter, xHeight, 5);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(rows[0]).toBe(at(inter, "ascender") - spacing);
    expect(rows.at(-1)).toBe(at(inter, "descender") + spacing);
    expect(rows[0]).toBeGreaterThanOrEqual(0);
    expect(rows.at(-1)).toBeLessThanOrEqual(192);
    // With only the baseline, the grid is even, a spacing apart.
    const plain = fontGrid([], xHeight, 5).rows;
    expect(plain).toContain(144);
    for (const [index, y] of plain.slice(1).entries()) {
      expect(y - (plain[index] ?? 0)).toBe(14);
    }
    expect(plain[0]).toBe(4);
    expect(plain.at(-1)).toBe(186);
  });

  it("follows only the chosen lines, always with the baseline", () => {
    const chosen = inter.filter(
      (line) => line.name === "ascender" || line.name === "baseline",
    );
    const { rows } = fontGrid(chosen, xHeight, 5);
    expect(rows).toContain(at(inter, "ascender"));
    expect(rows).not.toContain(at(inter, "cap height"));
    expect(rows).not.toContain(at(inter, "x-height"));
    expect(fontGrid([], xHeight, 5).rows).toContain(144);
  });

  it("keeps one row for lines at the same height", () => {
    const together: Guide[] = [
      { name: "ascender", y: 40 },
      { name: "cap height", y: 40 },
      { name: "baseline", y: 144 },
    ];
    const { rows } = fontGrid(together, 64, 4);
    expect(rows.filter((y) => y === 40)).toHaveLength(1);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it("keeps the cells within range, and a font it cannot measure", () => {
    expect(cells(fontGrid(inter, xHeight, 0).rows, 144, 74.125)).toBe(2);
    expect(cells(fontGrid(inter, xHeight, 99).rows, 144, 74.125)).toBe(10);
    expect(cells(fontGrid(inter, xHeight, Number.NaN).rows, 144, 74.125)).toBe(
      5,
    );
    // Half an em, 64 pixels, over 5 cells: 12.8, in whole units.
    expect(fontGrid([], Number.NaN, 5).spacing).toBe(205 / 16);
    expect(fontGrid([], 0, 5).spacing).toBe(205 / 16);
  });
});

describe("cropSpan", () => {
  it("is the crop a save makes: the ink plus side bearings", () => {
    // Ink from 98 to 202 pixels, with 8 to spare on each side.
    expect(cropSpan({ left: 98, right: 202 })).toEqual({
      left: 90,
      right: 210,
    });
  });

  it("is the narrowest image for no ink or a dot", () => {
    expect(cropSpan(undefined)).toEqual({ left: 0, right: 48 });
    // 2 to 20 with side bearings, widened evenly to 48.
    expect(cropSpan({ left: 10, right: 12 })).toEqual({ left: -13, right: 35 });
  });
});
describe("joinSpans", () => {
  it("reaches across both, either of which may be empty", () => {
    expect(joinSpans({ left: 0, right: 10 }, { left: -5, right: 4 })).toEqual({
      left: -5,
      right: 10,
    });
    expect(joinSpans(undefined, { left: 1, right: 2 })).toEqual({
      left: 1,
      right: 2,
    });
    expect(joinSpans(undefined, undefined)).toBeUndefined();
  });
});
