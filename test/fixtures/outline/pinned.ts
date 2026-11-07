// What the pinned shape files hold, computed afresh, for generate.ts to write
// and test/unit/ink/outline.test.ts to compare with them.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseRecord, type Stroke } from "../../../src/format/record.ts";
import {
  restShape,
  smoothShape,
  strokeShape,
  type Outline,
} from "../../../src/ink/outline.ts";
import { pinnedStrokes } from "./strokes.ts";

type Rounded = number[][];

const round = (value: number): number => Math.round(value * 1000) / 1000;

function rounded(outline: Outline): Rounded {
  return outline.map(([x, y]) => [round(x), round(y)]);
}

/** The outlines of {@link pinnedStrokes}, in order. */
export function pinnedOutlines(): Rounded[] {
  return pinnedStrokes.map((stroke) => {
    const shape = smoothShape(stroke);
    if (shape.kind !== "smooth") throw new Error("a pinned stroke is a dot");
    return rounded(shape.outline);
  });
}

/** Every stroke a golden file's record holds, by that file's name. */
function strokesOf(name: string): readonly Stroke[] {
  const text = readFileSync(
    path.join(import.meta.dirname, "../format", `${name}.json`),
    "utf8",
  );
  const parsed = parseRecord(text);
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.record.strokes;
}

/** What {@link pinnedPieces} holds. */
export interface PinnedPieces {
  /** Each stroke of `v1-polygons`, as its pieces, in no particular order. */
  readonly polygons: Rounded[][];
  /**
   * Each stroke of `v1-cuts`, as the outline of its rest, the circle of a rest
   * that is a dot, or null without a rest.
   */
  readonly rests: (Rounded | { center: number[]; radius: number } | null)[];
}

/**
 * The polygon pieces and the cut strokes' rests of the golden files, from the
 * records they hold, so where a save's crop put them. The order of a polygon's
 * pieces, and of each piece's corners, is this code's: the format defines only
 * what they cover.
 */
export function pinnedPieces(): PinnedPieces {
  return {
    polygons: strokesOf("v1-polygons").map((stroke) => {
      const shape = strokeShape(stroke);
      if (shape.kind !== "pieces") throw new Error("not a polygon");
      return shape.pieces.map(rounded);
    }),
    rests: strokesOf("v1-cuts").map((stroke) => {
      const shape = restShape(stroke);
      if (shape === undefined) return null;
      if (shape.kind === "smooth") return rounded(shape.outline);
      if (shape.kind === "pieces") throw new Error("a rest is smooth");
      return { center: [...shape.center], radius: shape.radius };
    }),
  };
}
