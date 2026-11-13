// Prototype for #167 §4.1: where each layout puts its parts.

import { describe, expect, it } from "vitest";
import type { InkRecord } from "../../../src/format/record.ts";
import {
  arrange,
  copyStrokes,
  layoutNamed,
  layouts,
  orders,
  rowGap,
  type Part,
} from "../../../src/editor/layouts.ts";

/** A part whose pen ink is a bar from row `top` to `bottom`, `width` wide. */
function bar(width: number, top = 54, bottom = 144): Part {
  const record: InkRecord = {
    strokes: [
      {
        tool: "pen",
        kind: "fill",
        points: [8, top, width - 8, top, width - 8, bottom, 8, bottom].map(
          (value) => value * 16,
        ),
      },
    ],
  };
  return { record, width };
}

const centre = (p: { box: { left: number; top: number; width: number; height: number } }) => ({
  x: p.box.left + p.box.width / 2,
  y: p.box.top + p.box.height / 2,
});

describe("layouts", () => {
  it("are the owner's eight, as IDS would write them", () => {
    expect(layouts.map((layout) => layout.ids)).toEqual([
      "A",
      "⿰AB",
      "⿱AB",
      "⿱A⿰BC",
      "⿰⿱ACB",
      "⿱⿰ABC",
      "⿰B⿱AC",
      "⿱⿰AB⿰CD",
    ]);
  });

  it("keep a single part where it is, at full size", () => {
    const [placement] = arrange(layoutNamed("single"), [bar(100)]).placements;
    expect(placement).toMatchObject({ x: 0, y: 0, scale: 1 });
  });

  it("put two parts side by side at half size, centred in the band", () => {
    const { placements, width, band } = arrange(
      layoutNamed("across"),
      [bar(100), bar(60)],
      "ink",
    );
    expect(band).toEqual({ top: 54, bottom: 144 });
    expect(width).toBe(80);
    expect(placements.map((p) => [p.x, p.scale])).toEqual([
      [0, 0.5],
      [50, 0.5],
    ]);
    // The band is 54 to 144, so a half-size part's ink, 45 tall, is centred
    // on 99: 76.5 to 121.5.
    for (const p of placements) {
      expect(p.y + 54 * p.scale).toBeCloseTo(76.5);
    }
  });

  it("stand a stack on the baseline, its top part above with a gap", () => {
    const { placements, band } = arrange(layoutNamed("stacked"), [
      bar(100),
      bar(60),
    ]);
    expect(band).toEqual({ top: 54, bottom: 144 });
    // A part standing on the baseline at full size does so in the bottom row.
    expect((placements[1]?.y ?? 0) + 144 * 0.5).toBeCloseTo(144);
    expect((placements[0]?.y ?? 0) + 54 * 0.5).toBeCloseTo(144 - 90 - rowGap);
    const across = arrange(layoutNamed("across"), [bar(100), bar(60)]);
    // A lone row is centred on the middle of where two rows would be.
    expect((across.placements[0]?.y ?? 0) + 54 * 0.5).toBeCloseTo(
      144 - (90 + rowGap) / 2 - 22.5,
    );
  });

  it("stack two parts with a gap like the one across, filling the band", () => {
    const { placements } = arrange(
      layoutNamed("stacked"),
      [bar(100), bar(60)],
      "ink",
    );
    const [top, bottom] = placements.map((p) => p.y + 54 * p.scale);
    expect(top).toBeCloseTo(54 - rowGap / 2);
    expect(bottom).toBeCloseTo(54 - rowGap / 2 + 45 + rowGap);
    // The narrower one is centred under the wider.
    expect(placements[1]?.x).toBe(10);
  });

  it("centre a lone part across its row or down its column", () => {
    const parts = [bar(100), bar(100), bar(100)];
    const up = arrange(layoutNamed("point-up"), parts).placements;
    expect(centre(up[0]!).x).toBeCloseTo((centre(up[1]!).x + centre(up[2]!).x) / 2);
    const right = arrange(layoutNamed("point-right"), parts).placements;
    const b = right.find((p) => p.letter === "B")!;
    const a = right.find((p) => p.letter === "A")!;
    const c = right.find((p) => p.letter === "C")!;
    expect(centre(b).y).toBeCloseTo((centre(a).y + centre(c).y) / 2);
    expect(centre(b).x).toBeGreaterThan(centre(a).x);
    const left = arrange(layoutNamed("point-left"), parts).placements;
    const lone = left.find((p) => p.letter === "B")!;
    expect(centre(lone).x).toBeLessThan(centre(left.find((p) => p.letter === "A")!).x);
  });

  it("widen both columns for a lone part wider than the two below it", () => {
    const { width, placements } = arrange(layoutNamed("point-up"), [
      bar(200),
      bar(60),
      bar(60),
    ]);
    expect(width).toBe(100);
    expect(placements[1]?.x).toBe(10);
    expect(placements[2]?.x).toBe(60);
  });

  it("align a square's columns by their widest part", () => {
    const { placements } = arrange(layoutNamed("square"), [
      bar(100),
      bar(60),
      bar(40),
      bar(80),
    ]);
    expect(placements.map((p) => p.box.left)).toEqual([0, 50, 0, 50]);
    expect(placements.map((p) => p.x)).toEqual([0, 55, 15, 50]);
  });

  it("try every order of four parts, the natural one first", () => {
    const all = orders(4);
    expect(all).toHaveLength(24);
    expect(all[0]).toEqual([0, 1, 2, 3]);
  });

  it("scale widths by weight", () => {
    const part: Part = {
      width: 100,
      record: { strokes: [{ tool: "pen", size: 160, points: [800, 800, 1600, 1600] }] },
    };
    const arrangement = arrange(layoutNamed("across"), [part, part]);
    const sizes = (weight: "scaled" | "between" | "kept") =>
      copyStrokes([part, part], arrangement, weight).map((s) => s.size);
    expect(sizes("scaled")).toEqual([80, 80]);
    expect(sizes("between")).toEqual([113, 113]);
    expect(sizes("kept")).toEqual([160, 160]);
  });
});
