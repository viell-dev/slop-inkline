import { describe, expect, it } from "vitest";
import {
  cropSpan,
  finerGrid,
  fontGrid,
  fontGuides,
  joinSpans,
  type FontMetrics,
  type Grid,
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
    // The columns are as far apart as the x-height's rows, in even units.
    expect(spacing).toBe(14);
    expect(Math.abs(spacing - xHeight / 5)).toBeLessThanOrEqual(1 / 16);
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
    // Half an em, 64 pixels, over 5 cells: 12.8, in even units.
    expect(fontGrid([], Number.NaN, 5).spacing).toBe(204 / 16);
    expect(fontGrid([], 0, 5).spacing).toBe(204 / 16);
  });

  it("keeps its columns an even number of units apart, within 1/16 pixel", () => {
    for (let xHeight = 32; xHeight <= 128; xHeight += 0.3) {
      for (let count = 2; count <= 10; count++) {
        const units = fontGrid([], xHeight, count).spacing * 16;
        expect(units % 2).toBe(0);
        expect(Math.abs(units / 16 - xHeight / count)).toBeLessThan(
          1 / 16 + 1e-9,
        );
      }
    }
  });

  it("keeps the cells within a quarter of an em to a whole one of x-height", () => {
    // A font that measures an x-height of a pixel draws no grid of
    // thousands of rows: it counts as a quarter of an em, 32 pixels.
    const tiny = fontGrid([{ name: "x-height", y: 143 }], 1, 10);
    expect(tiny.spacing).toBe(3.25);
    expect(tiny.rows.length).toBeLessThanOrEqual(192 / 3 + 2);
    // And one taller than an em counts as an em.
    expect(fontGrid([], 400, 2).spacing).toBe(64);
  });
});

describe("finerGrid", () => {
  const usualFont: FontMetrics = {
    ascent: 0.97,
    descent: 0.24,
    capHeight: 0.73,
    xHeight: 0.546,
  };
  /** Fonts of many x-heights, odd ones and one measured strangely too. */
  const fonts: readonly FontMetrics[] = [
    usualFont,
    { ascent: 0.9, descent: 0.21, capHeight: 0.66, xHeight: 0.449 },
    { ascent: 1.1, descent: 0.3, capHeight: 0.8, xHeight: 0.61 },
    { ascent: 1.3, descent: 0.4, capHeight: 0.71, xHeight: 0.5117 },
    { ascent: 0.8, descent: 0.2, capHeight: 0.8, xHeight: 0.8 },
    { ascent: 0.8, descent: 0.2, capHeight: 0.1, xHeight: 0.0078 },
  ];
  const lineChoices = (metrics: FontMetrics): readonly Guide[][] => {
    const lines = fontGuides(metrics);
    return [
      lines,
      [],
      lines.filter((line) => line.name !== "x-height"),
      lines.filter((line) => line.name === "cap height"),
    ];
  };
  const eachGrid = (check: (usual: Grid, fine: Grid) => void): void => {
    for (const metrics of fonts) {
      for (const lines of lineChoices(metrics)) {
        for (let count = 2; count <= 10; count++) {
          const usual = fontGrid(lines, metrics.xHeight * 128, count);
          check(usual, finerGrid(usual));
        }
      }
    }
  };

  it("has twice the cells between two lines, whatever the grid size", () => {
    const lines = fontGuides(usualFont);
    const y = (name: string): number =>
      lines.find((line) => line.name === name)?.y ?? Number.NaN;
    const cells = (rows: readonly number[], name: string) =>
      Math.abs(rows.indexOf(144) - rows.indexOf(y(name)));
    for (let count = 2; count <= 10; count++) {
      const usual = fontGrid(lines, 144 - y("x-height"), count);
      const { rows } = finerGrid(usual);
      expect(cells(usual.rows, "x-height")).toBe(count);
      expect(cells(rows, "x-height")).toBe(count * 2);
      expect(cells(rows, "cap height")).toBe(
        cells(usual.rows, "cap height") * 2,
      );
      expect(cells(rows, "descender")).toBe(cells(usual.rows, "descender") * 2);
    }
  });

  it("keeps every point of the usual grid", () => {
    eachGrid((usual, fine) => {
      for (const y of usual.rows) expect(fine.rows).toContain(y);
      // Columns: two steps of the fine grid are exactly one of the usual.
      expect(fine.spacing * 2).toBe(usual.spacing);
    });
  });

  it("keeps ends snapped to it whole, in units", () => {
    eachGrid((_usual, fine) => {
      expect(Number.isInteger(fine.spacing * 16)).toBe(true);
    });
  });

  it("puts one row midway between two, and stays in the line box, in order", () => {
    eachGrid((usual, fine) => {
      expect(fine.rows).toEqual([...new Set(fine.rows)].sort((a, b) => a - b));
      expect(fine.rows[0]).toBeGreaterThanOrEqual(0);
      expect(fine.rows.at(-1)).toBeLessThanOrEqual(192);
      for (const [index, y] of usual.rows.slice(1).entries()) {
        const above = usual.rows[index] ?? 0;
        const between = fine.rows.filter((row) => row > above && row < y);
        expect(between).toEqual([(above + y) / 2]);
      }
    });
  });

  it("goes on past the outermost row only as far as the line box has room", () => {
    const fine = (rows: readonly number[]) =>
      finerGrid({ spacing: 14, rows }).rows;
    expect(fine([20, 34])).toEqual([13, 20, 27, 34, 41]);
    expect(fine([6, 20])).toEqual([6, 13, 20, 27]);
    expect(fine([7, 185])).toEqual([0, 7, 96, 185, 192]);
    expect(fine([6, 186])).toEqual([6, 96, 186]);
    expect(fine([])).toEqual([]);
  });

  it("remembers how far apart the usual grid's columns are", () => {
    expect(finerGrid({ spacing: 14, rows: [0] })).toMatchObject({
      spacing: 7,
      period: 14,
    });
    expect(finerGrid({ spacing: 7, period: 14, rows: [0] }).period).toBe(14);
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
