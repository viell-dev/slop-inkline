// Prototype for #167 §4: what linked parts would have to check.

import { describe, expect, it } from "vitest";
import {
  checkComposite,
  dependents,
  renamedParts,
  wouldLoop,
  type Node,
  type PartRef,
} from "../../e2e/browser/compose-graph.ts";

const at = (symbol: string): PartRef => ({ symbol, x: 0, y: 0, scale: 2048 });

function library(entries: Record<string, Node>) {
  return (symbol: string): Node | undefined => entries[symbol];
}

describe("linked parts", () => {
  it("count each use of a part, through nesting", () => {
    const vault = library({
      mark: { points: 100, parts: [] },
      pair: { points: 0, parts: [at("mark"), at("mark")] },
      triangle: { points: 4, parts: [at("pair"), at("mark")] },
    });
    expect(checkComposite("triangle", vault)).toEqual({
      ok: true,
      draws: 4,
      points: 304,
      depth: 2,
    });
  });

  it("find a symbol that contains itself, directly or through others", () => {
    const vault = library({
      a: { points: 1, parts: [at("b")] },
      b: { points: 1, parts: [at("c")] },
      c: { points: 1, parts: [at("a")] },
      self: { points: 1, parts: [at("self")] },
    });
    expect(checkComposite("a", vault)).toMatchObject({
      ok: false,
      reason: "loop",
      path: ["a", "b", "c", "a"],
    });
    expect(checkComposite("self", vault)).toMatchObject({ reason: "loop" });
    expect(wouldLoop("a", "c", vault)).toBe(true);
    expect(wouldLoop("x", "a", vault)).toBe(false);
  });

  it("can meet a loop that no single edit made, as two synced edits can", () => {
    // On one computer, A is placed into B; on another, before the sync, B
    // into A. Each was checked and fine where it was made.
    const first = { a: { points: 1, parts: [] }, b: { points: 1, parts: [at("a")] } };
    const second = { a: { points: 1, parts: [at("b")] }, b: { points: 1, parts: [] } };
    expect(checkComposite("b", library(first)).ok).toBe(true);
    expect(checkComposite("a", library(second)).ok).toBe(true);
    const synced = library({ a: second.a, b: first.b });
    expect(checkComposite("a", synced)).toMatchObject({ reason: "loop" });
  });

  it("say which part is missing", () => {
    const vault = library({
      triangle: { points: 0, parts: [at("mark"), at("gone")] },
      mark: { points: 1, parts: [] },
    });
    expect(checkComposite("triangle", vault)).toMatchObject({
      ok: false,
      reason: "missing",
      path: ["triangle", "gone"],
    });
  });

  it("refuse an expansion bomb at once, without drawing it", () => {
    // Each level uses the one below three times: 3^12 uses of the leaf, from
    // thirteen small files.
    const entries: Record<string, Node> = { level0: { points: 50, parts: [] } };
    for (let level = 1; level <= 12; level++) {
      const below = at(`level${String(level - 1)}`);
      entries[`level${String(level)}`] = {
        points: 0,
        parts: [below, below, below],
      };
    }
    const started = performance.now();
    const result = checkComposite("level12", library(entries), {
      depth: 64,
      draws: 10_000,
      points: 250_000,
    });
    const elapsed = performance.now() - started;
    expect(result).toMatchObject({ ok: false, reason: "too-costly" });
    expect(result.ok ? 0 : result.points).toBe(50 * 3 ** 12);
    expect(elapsed).toBeLessThan(50);
    expect(checkComposite("level12", library(entries))).toMatchObject({
      reason: "too-deep",
    });
  });

  it("order dependents so that each is redrawn after its parts", () => {
    const vault = library({
      mark: { points: 1, parts: [] },
      pair: { points: 0, parts: [at("mark"), at("mark")] },
      other: { points: 0, parts: [at("mark")] },
      triangle: { points: 0, parts: [at("pair"), at("other")] },
      unrelated: { points: 1, parts: [] },
    });
    const order = dependents(
      "mark",
      ["mark", "pair", "other", "triangle", "unrelated"],
      vault,
    );
    expect(order).toHaveLength(3);
    expect(order.indexOf("triangle")).toBeGreaterThan(order.indexOf("pair"));
    expect(order.indexOf("triangle")).toBeGreaterThan(order.indexOf("other"));
  });

  it("rename a part where a composite names it", () => {
    const parts = [at("old"), at("kept"), at("old")];
    expect(renamedParts(parts, "old", "new")?.map((p) => p.symbol)).toEqual([
      "new",
      "kept",
      "new",
    ]);
    expect(renamedParts(parts, "absent", "new")).toBeUndefined();
  });
});
