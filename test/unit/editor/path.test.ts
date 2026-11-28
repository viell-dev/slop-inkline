import { describe, expect, it } from "vitest";
import {
  PathPlacer,
  controls,
  cubicAt,
  dragMin,
  pathPoints,
  segmentPoints,
  type PathNode,
  type PathPointer,
  type PathReach,
  type Point,
} from "../../../src/editor/path.ts";

/** The pointer at (x, y), off the grid. */
function at(x: number, y: number): PathPointer {
  return { at: { x, y }, placed: { x, y }, onGrid: false };
}

/** The pointer at (x, y), snapped to the grid point (gx, gy). */
function snapped(x: number, y: number, gx: number, gy: number): PathPointer {
  return { at: { x, y }, placed: { x: gx, y: gy }, onGrid: true };
}

/** As near to every point and handle's end, unless a test says. */
const reach: PathReach = { ends: 6, marks: 6 };

/** A path with a click at each point, after the first press's release. */
function clicked(...points: readonly (readonly [number, number])[]) {
  const [[x, y] = [0, 0], ...rest] = points;
  const placer = new PathPlacer(at(x, y), reach);
  placer.release(at(x, y));
  for (const [px, py] of rest) {
    placer.press(at(px, py), reach);
    placer.release(at(px, py));
  }
  return placer;
}

/** A press at `from`, dragged to `to` and let go there. */
function drag(
  placer: PathPlacer,
  from: readonly [number, number],
  to: readonly [number, number],
) {
  placer.press(at(...from), reach);
  placer.move(at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
  placer.move(at(...to));
  return placer.release(at(...to));
}

function gaps(points: readonly Point[]): number[] {
  return points
    .slice(1)
    .map((point, index) =>
      Math.hypot(
        point.x - (points[index]?.x ?? 0),
        point.y - (points[index]?.y ?? 0),
      ),
    );
}

const corner = (x: number, y: number): PathNode => ({ x, y, onGrid: false });

describe("the curve", () => {
  it("is the straight line between two corners", () => {
    const c = controls(corner(0, 0), corner(30, 40));
    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      const { x, y } = cubicAt(c, t);
      // On the line y = 4x / 3.
      expect(y).toBeCloseTo((4 * x) / 3, 9);
    }
    expect(cubicAt(c, 0)).toEqual({ x: 0, y: 0 });
    expect(cubicAt(c, 1)).toEqual({ x: 30, y: 40 });
  });

  it("leaves a smooth point along its handle and comes into one along the handle reversed", () => {
    const from: PathNode = {
      x: 0,
      y: 0,
      handle: { x: 10, y: 0 },
      onGrid: false,
    };
    const to: PathNode = {
      x: 40,
      y: 40,
      handle: { x: 0, y: 10 },
      onGrid: false,
    };
    expect(controls(from, to)).toEqual([
      from,
      { x: 10, y: 0 },
      { x: 40, y: 30 },
      to,
    ]);
    // Near its start the curve heads along the handle, and near its end
    // along the next handle.
    const early = cubicAt(controls(from, to), 0.001);
    expect(Math.abs(early.y / early.x)).toBeLessThan(0.01);
    const late = cubicAt(controls(from, to), 0.999);
    expect(Math.abs((40 - late.x) / (40 - late.y))).toBeLessThan(0.01);
  });

  it("is sampled evenly, within the spacing, from its first point to its last exactly", () => {
    // A quarter circle of radius 100, as handles of 0.5523 times the radius
    // make it, within 0.03% of the radius.
    const k = 0.5523 * 100;
    const from: PathNode = {
      x: 0,
      y: 100,
      handle: { x: 0, y: -k },
      onGrid: false,
    };
    const to: PathNode = {
      x: 100,
      y: 0,
      handle: { x: k, y: 0 },
      onGrid: false,
    };
    const points = segmentPoints(from, to, 1);
    expect(points.at(-1)).toEqual({ x: 100, y: 0 });
    // A quarter of 2π × 100 is about 157 long.
    expect(points.length).toBe(158);
    const apart = gaps([{ x: 0, y: 100 }, ...points]);
    for (const gap of apart) {
      expect(gap).toBeLessThanOrEqual(1);
      expect(gap).toBeGreaterThan(0.99);
    }
    // Every point lies on the circle about (100, 100).
    for (const { x, y } of points) {
      expect(Math.abs(Math.hypot(x - 100, y - 100) - 100)).toBeLessThan(0.03);
    }
  });

  it("keeps a straight side's points along it, as few as its length needs", () => {
    const points = segmentPoints(corner(10, 10), corner(110, 10), 1);
    expect(points).toHaveLength(100);
    for (const { y } of points) expect(y).toBeCloseTo(10, 9);
    expect(points.at(-1)).toEqual({ x: 110, y: 10 });
  });

  it("has no points between two corners at the same place", () => {
    expect(segmentPoints(corner(5, 5), corner(5, 5), 1)).toEqual([]);
  });

  it("goes through every point of the path, its corners exactly", () => {
    const nodes = [corner(0, 0), corner(20, 0), corner(20, 20)];
    const points = pathPoints(nodes, false, 1);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points).toContainEqual({ x: 20, y: 0 });
    expect(points.at(-1)).toEqual({ x: 20, y: 20 });
    expect(points).toHaveLength(41);
    for (const gap of gaps(points)) expect(gap).toBeLessThanOrEqual(1);
  });

  it("closes back to the first point, along the handles there", () => {
    const smooth: PathNode = {
      x: 50,
      y: 0,
      handle: { x: 0, y: 30 },
      onGrid: false,
    };
    const points = pathPoints([corner(0, 0), smooth], true, 1);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 0, y: 0 });
    // Out along the handle, below the line between the two, and back above.
    expect(Math.max(...points.map(({ y }) => y))).toBeGreaterThan(5);
    expect(Math.min(...points.map(({ y }) => y))).toBeLessThan(-5);
    for (const gap of gaps(points)) expect(gap).toBeLessThanOrEqual(1);
  });

  it("is a single point for a single point, and nothing for none", () => {
    expect(pathPoints([corner(3, 4)], false, 1)).toEqual([{ x: 3, y: 4 }]);
    expect(pathPoints([corner(3, 4)], true, 1)).toEqual([{ x: 3, y: 4 }]);
    expect(pathPoints([], false, 1)).toEqual([]);
  });

  it("stays within the spacing for a curve whose handles cross", () => {
    const from: PathNode = {
      x: 0,
      y: 0,
      handle: { x: 200, y: 150 },
      onGrid: false,
    };
    const to: PathNode = {
      x: 10,
      y: 0,
      handle: { x: 200, y: -150 },
      onGrid: false,
    };
    const points = segmentPoints(from, to, 1);
    for (const gap of gaps([from, ...points])) {
      expect(gap).toBeLessThanOrEqual(1);
    }
  });
});

describe("PathPlacer", () => {
  it("places a corner at a click, and a smooth point at a drag with mirrored handles", () => {
    const placer = clicked([10, 10]);
    expect(placer.nodes).toEqual([corner(10, 10)]);
    expect(drag(placer, [50, 10], [60, 20])).toBe("placing");
    expect(placer.nodes).toEqual([
      corner(10, 10),
      { x: 50, y: 10, handle: { x: 10, y: 10 }, onGrid: false },
    ]);
  });

  it("starts with a smooth point dragged from the first press", () => {
    const placer = new PathPlacer(at(10, 10), reach);
    placer.move(at(30, 10));
    expect(placer.release(at(30, 10))).toBe("placing");
    expect(placer.nodes).toEqual([
      { x: 10, y: 10, handle: { x: 20, y: 0 }, onGrid: false },
    ]);
  });

  it("keeps a click a corner, and leaves no handle shorter than a drag", () => {
    const placer = clicked([10, 10]);
    placer.press(at(50, 10), reach);
    // A wobble under the drag's distance changes nothing.
    placer.move(at(50 + dragMin - 0.5, 10));
    expect(placer.release(at(50 + dragMin - 0.5, 10))).toBe("placing");
    expect(placer.nodes.at(-1)).toEqual(corner(50, 10));
    // Dragged out and back near the point, it is a corner again.
    placer.press(at(90, 10), reach);
    placer.move(at(110, 10));
    placer.move(at(91, 10));
    placer.release(at(91, 10));
    expect(placer.nodes.at(-1)).toEqual(corner(90, 10));
  });

  it("moves a placed point with its handle, from where it was taken hold of", () => {
    const placer = clicked([10, 10]);
    drag(placer, [50, 10], [60, 10]);
    // Taken hold of 2 pixels off, and moved by 20 down.
    placer.press(at(52, 11), reach);
    placer.move(at(52, 21));
    placer.move(at(52, 31));
    expect(placer.release(at(52, 31))).toBe("placing");
    expect(placer.nodes).toEqual([
      corner(10, 10),
      { x: 50, y: 30, handle: { x: 10, y: 0 }, onGrid: false },
    ]);
  });

  it("turns a handle and its mirror together, and leaves a corner when dragged onto its point", () => {
    const placer = clicked([10, 10]);
    drag(placer, [50, 10], [60, 10]);
    // The handle's end the curve comes in by, at (40, 10), dragged up.
    placer.press(at(40, 10), reach);
    placer.move(at(45, 0));
    placer.release(at(50, 0));
    expect(placer.nodes.at(-1)).toEqual({
      x: 50,
      y: 10,
      handle: { x: 0, y: 10 },
      onGrid: false,
    });
    // The end it leaves by, now at (50, 20), dragged onto the point.
    placer.press(at(50, 20), reach);
    placer.move(at(50, 15));
    placer.release(at(50, 11));
    expect(placer.nodes.at(-1)).toEqual(corner(50, 10));
  });

  it("closes on a click on the first point once it has two, and ends on the last", () => {
    const one = clicked([10, 10]);
    expect(one.state).toBe("placing");
    one.press(at(11, 10), reach);
    // One point clicked again is a dot, as the pen's tap is.
    expect(one.release(at(11, 10))).toBe("ended");
    expect(one.state).toBe("ended");
    expect(one.nodes).toEqual([corner(10, 10)]);

    const two = clicked([10, 10], [50, 10]);
    two.press(at(11, 11), reach);
    expect(two.release(at(11, 11))).toBe("closed");
    expect(two.state).toBe("closed");
    expect(two.nodes).toHaveLength(2);

    const open = clicked([10, 10], [50, 10], [50, 50]);
    open.press(at(49, 49), reach);
    expect(open.release(at(49, 49))).toBe("ended");
    expect(open.nodes).toHaveLength(3);
  });

  it("never ends on the release of the press that started it", () => {
    const placer = new PathPlacer(at(10, 10), reach);
    expect(placer.release(at(10, 10))).toBe("placing");
  });

  it("ends open where it is at end, as Enter ends it, and only while it is placed", () => {
    const placer = clicked([10, 10], [50, 10]);
    placer.move(at(50, 50));
    placer.end();
    expect(placer.state).toBe("ended");
    // The next curve to the pointer is gone, and no corner was placed there.
    expect(placer.shown).toEqual({
      nodes: [corner(10, 10), corner(50, 10)],
      closed: false,
    });
    const closed = clicked([10, 10], [50, 10]);
    closed.press(at(10, 10), reach);
    closed.release(at(10, 10));
    closed.end();
    expect(closed.state).toBe("closed");
    expect(closed.shown.closed).toBe(true);
  });

  it("keeps what a press held as Enter ends the path placed it, as a step of its own", () => {
    // A smooth point being dragged out when Enter comes.
    const placer = clicked([10, 10]);
    placer.press(at(50, 10), reach);
    placer.move(at(55, 10));
    placer.move(at(60, 10));
    placer.end();
    expect(placer.state).toBe("ended");
    const smooth = { x: 50, y: 10, handle: { x: 10, y: 0 }, onGrid: false };
    expect(placer.nodes).toEqual([corner(10, 10), smooth]);
    // The press goes on and is let go elsewhere: it no longer drags.
    placer.move(at(80, 40));
    expect(placer.release(at(80, 40))).toBe("ended");
    expect(placer.nodes).toEqual([corner(10, 10), smooth]);
    // Undo takes back the ending, then the smooth point.
    expect(placer.undo()).toBe(true);
    expect(placer.state).toBe("placing");
    expect(placer.nodes).toEqual([corner(10, 10), smooth]);
    expect(placer.undo()).toBe(true);
    expect(placer.nodes).toEqual([corner(10, 10)]);
    // A press on a point with no drag yet, as Enter comes, keeps nothing.
    placer.press(at(10, 10), reach);
    placer.end();
    expect(placer.nodes).toEqual([corner(10, 10)]);
    expect(placer.undo()).toBe(true);
    expect(placer.state).toBe("placing");
    expect(placer.undo()).toBe(false);
  });

  it("moves its points and handles once ended or closed, as while placing it", () => {
    for (const close of [false, true]) {
      const placer = clicked([10, 10]);
      drag(placer, [50, 10], [60, 10]);
      placer.press(at(close ? 10 : 50, 10), reach);
      placer.release(at(close ? 10 : 50, 10));
      expect(placer.state).toBe(close ? "closed" : "ended");
      // The smooth point moved down, and its handle's end the curve leaves
      // by dragged up, which turns its mirror with it.
      expect(drag(placer, [50, 10], [50, 30])).toBe(placer.state);
      expect(drag(placer, [60, 30], [50, 20])).toBe(placer.state);
      expect(placer.nodes).toEqual([
        corner(10, 10),
        { x: 50, y: 30, handle: { x: 0, y: -10 }, onGrid: false },
      ]);
      // It shows as it is, whatever the pointer points at.
      placer.move(at(90, 90));
      expect(placer.shown).toEqual({ nodes: placer.nodes, closed: close });
      placer.move(at(10, 10));
      expect(placer.shown).toEqual({ nodes: placer.nodes, closed: close });
      // What a press would take hold of shows as while placing.
      expect(placer.marks.target).toEqual({ kind: "point", index: 0 });
    }
  });

  it("places nothing and ends nothing at a click once ended, and takes hold of nothing beside it", () => {
    const placer = clicked([10, 10], [50, 10], [50, 50]);
    placer.end();
    const nodes = placer.nodes;
    // Beside every point and handle: nothing to take hold of.
    expect(placer.press(at(90, 90), reach)).toBe(false);
    placer.move(at(100, 100));
    expect(placer.release(at(100, 100))).toBe("ended");
    expect(placer.nodes).toBe(nodes);
    // A click on the first, a middle, and the last point, as one that would
    // close, place a corner, or end a path being placed.
    for (const [x, y] of [
      [10, 10],
      [50, 10],
      [50, 50],
    ] as const) {
      expect(placer.press(at(x, y), reach)).toBe(true);
      expect(placer.release(at(x, y))).toBe("ended");
    }
    expect(placer.nodes).toBe(nodes);
    // None of it was a step: Undo takes back the ending itself.
    expect(placer.undo()).toBe(true);
    expect(placer.state).toBe("placing");
    expect(placer.nodes).toBe(nodes);
    // Placing again, the next curve follows the pointer once more.
    placer.move(at(90, 90));
    expect(placer.shown.nodes.at(-1)).toEqual(corner(90, 90));
  });

  it("takes back each adjustment, then the ending or closing, then the points placed", () => {
    const placer = clicked([10, 10], [50, 10]);
    placer.press(at(10, 10), reach);
    placer.release(at(10, 10));
    expect(placer.state).toBe("closed");
    drag(placer, [50, 10], [50, 40]);
    drag(placer, [10, 10], [20, 10]);
    expect(placer.nodes).toEqual([corner(20, 10), corner(50, 40)]);
    expect(placer.undo()).toBe(true);
    expect(placer.nodes).toEqual([corner(10, 10), corner(50, 40)]);
    expect(placer.state).toBe("closed");
    // A drag being held, taken back before its release, which then does
    // nothing.
    placer.press(at(50, 40), reach);
    placer.move(at(70, 70));
    expect(placer.undo()).toBe(true);
    expect(placer.release(at(70, 70))).toBe("closed");
    expect(placer.nodes).toEqual([corner(10, 10), corner(50, 40)]);
    expect(placer.undo()).toBe(true);
    expect(placer.nodes).toEqual([corner(10, 10), corner(50, 10)]);
    expect(placer.state).toBe("closed");
    // The closing, back to placing, with both points.
    expect(placer.undo()).toBe(true);
    expect(placer.state).toBe("placing");
    expect(placer.nodes).toEqual([corner(10, 10), corner(50, 10)]);
    expect(placer.undo()).toBe(true);
    expect(placer.undo()).toBe(false);
    expect(placer.nodes).toEqual([]);
  });

  it("places a corner at a click on a point between the first and last, or on a handle's end", () => {
    const placer = clicked([10, 10], [50, 10]);
    drag(placer, [90, 10], [100, 10]);
    placer.press(at(50, 10), reach);
    expect(placer.release(at(50, 10))).toBe("placing");
    expect(placer.nodes.at(-1)).toEqual(corner(50, 10));
    // The third point's handle's end, at (100, 10).
    placer.press(at(100, 10), reach);
    expect(placer.release(at(100, 10))).toBe("placing");
    expect(placer.nodes.at(-1)).toEqual(corner(100, 10));
    expect(placer.nodes).toHaveLength(5);
  });

  it("takes hold of the nearest within reach, a point before a handle's end as near", () => {
    const placer = clicked([10, 10]);
    drag(placer, [50, 10], [55, 10]);
    expect(placer.marks.nodes).toHaveLength(2);
    placer.move(at(54, 10));
    expect(placer.marks.target).toEqual({ kind: "handle", index: 1, side: 1 });
    placer.move(at(51, 10));
    expect(placer.marks.target).toEqual({ kind: "point", index: 1 });
    // Halfway between the point and its handle's end.
    placer.move(at(52.5, 10));
    expect(placer.marks.target).toEqual({ kind: "point", index: 1 });
    placer.move(at(80, 10));
    expect(placer.marks.target).toBeUndefined();
  });

  it("reaches the first and last points as near as the brush, and the others and the handles as near as their marks", () => {
    const placer = new PathPlacer(at(10, 10), { ends: 12, marks: 4 });
    placer.release(at(10, 10));
    drag(placer, [50, 10], [70, 10]);
    placer.press(at(90, 10), reach);
    placer.release(at(90, 10));
    // From here on, the reach of a brush 24 pixels wide, and of marks 4
    // pixels from their middle.
    placer.move(at(90, 10), { ends: 12, marks: 4 });
    const target = (x: number) => {
      placer.move(at(x, 10));
      return placer.marks.target;
    };
    expect(target(20)).toEqual({ kind: "point", index: 0 });
    expect(target(80)).toEqual({ kind: "point", index: 2 });
    // The handle's end the curve comes in by, at 30: beyond its mark's reach,
    // as the second point at 50 is.
    expect(target(36)).toBeUndefined();
    expect(target(33)).toEqual({ kind: "handle", index: 1, side: -1 });
    expect(target(53)).toEqual({ kind: "point", index: 1 });
    expect(target(45)).toBeUndefined();
  });

  it("ends on a click on the last point where an earlier point lies too", () => {
    // Back to a grid point it has been to, and clicked there again.
    const grid = new PathPlacer(snapped(17, 143, 16, 144), reach);
    grid.release(snapped(17, 143, 16, 144));
    for (const [x, y] of [
      [48, 144],
      [48, 96],
      [48, 144],
    ] as const) {
      grid.press(snapped(x + 1, y - 1, x, y), reach);
      expect(grid.release(snapped(x + 1, y - 1, x, y))).toBe("placing");
    }
    grid.press(snapped(47, 145, 48, 144), reach);
    expect(grid.release(snapped(47, 145, 48, 144))).toBe("ended");
    expect(grid.nodes).toHaveLength(4);
    // Off the grid, at the very same place twice.
    const free = clicked([10, 10], [50, 10], [50, 50], [50, 10]);
    free.press(at(50, 10), reach);
    expect(free.release(at(50, 10))).toBe("ended");
    expect(free.nodes).toHaveLength(4);
    // A path that comes back to its first point closes there, last or not.
    const back = clicked([10, 10], [50, 10]);
    back.press(at(50, 10), reach);
    back.move(at(30, 10));
    back.move(at(10, 10));
    back.release(at(10, 10));
    back.press(at(10, 10), reach);
    expect(back.release(at(10, 10))).toBe("closed");
  });

  it("reaches a point that Shift put on the grid where Shift snaps to it", () => {
    const placer = new PathPlacer(snapped(9, 11, 8, 8), reach);
    placer.release(snapped(9, 11, 8, 8));
    expect(placer.nodes).toEqual([{ x: 8, y: 8, onGrid: true }]);
    placer.press(snapped(40, 9, 40, 8), reach);
    placer.release(snapped(40, 9, 40, 8));
    // Within reach, but snapping to another grid point, it is not reached.
    placer.move(snapped(13, 8, 16, 8));
    expect(placer.marks.target).toBeUndefined();
    // Out of reach, but snapping to it, it is.
    placer.move(snapped(15, 14, 8, 8));
    expect(placer.marks.target).toEqual({ kind: "point", index: 0 });
    placer.press(snapped(15, 14, 8, 8), reach);
    expect(placer.release(snapped(15, 14, 8, 8))).toBe("closed");
  });

  it("puts what Shift places on the grid: a point, a handle's end, and a point moved", () => {
    const placer = new PathPlacer(snapped(9, 9, 8, 8), reach);
    placer.move(snapped(30, 12, 32, 8));
    placer.release(snapped(30, 12, 32, 8));
    expect(placer.nodes).toEqual([
      { x: 8, y: 8, handle: { x: 24, y: 0 }, onGrid: true },
    ]);
    placer.press(at(60, 60), reach);
    placer.release(at(60, 60));
    placer.press(at(60, 60), reach);
    placer.move(snapped(70, 70, 72, 72));
    placer.release(snapped(70, 70, 72, 72));
    expect(placer.nodes.at(-1)).toEqual({ x: 72, y: 72, onGrid: true });
  });

  it("shows what a click where the pointer is would leave", () => {
    const placer = clicked([10, 10], [50, 10]);
    placer.move(at(50, 50));
    expect(placer.shown).toEqual({
      nodes: [corner(10, 10), corner(50, 10), corner(50, 50)],
      closed: false,
    });
    placer.move(at(12, 12));
    expect(placer.shown).toEqual({
      nodes: [corner(10, 10), corner(50, 10)],
      closed: true,
    });
    placer.move(at(51, 9));
    expect(placer.shown).toEqual({
      nodes: [corner(10, 10), corner(50, 10)],
      closed: false,
    });
    // Pressed on the first point, before a drag, it shows the click's close;
    // dragged, the point moved.
    placer.press(at(10, 10), reach);
    expect(placer.shown.closed).toBe(true);
    placer.move(at(10, 30));
    expect(placer.shown).toEqual({
      nodes: [corner(10, 30), corner(50, 10)],
      closed: false,
    });
  });

  it("shows the next curve to the pointer once a drag is let go, and once a drag is taken back", () => {
    const placer = clicked([10, 10]);
    drag(placer, [50, 10], [60, 10]);
    placer.move(at(80, 40));
    expect(placer.shown).toEqual({
      nodes: [
        corner(10, 10),
        { x: 50, y: 10, handle: { x: 10, y: 0 }, onGrid: false },
        corner(80, 40),
      ],
      closed: false,
    });
    // And on the first point, the close a click there makes.
    placer.move(at(11, 10));
    expect(placer.shown.closed).toBe(true);
    expect(placer.shown.nodes).toHaveLength(2);
    // A point moved, and the same after it.
    drag(placer, [10, 10], [10, 30]);
    placer.move(at(30, 60));
    expect(placer.shown.nodes.at(-1)).toEqual(corner(30, 60));
    // A handle dragged out, taken back before its release.
    placer.press(at(90, 10), reach);
    placer.move(at(100, 30));
    expect(placer.undo()).toBe(true);
    placer.move(at(70, 70));
    expect(placer.shown.nodes.at(-1)).toEqual(corner(70, 70));
    expect(placer.shown.nodes).toHaveLength(3);
  });

  it("takes back each step with undo, a press being held too, and says when none is left", () => {
    const placer = clicked([10, 10]);
    drag(placer, [50, 10], [60, 10]);
    drag(placer, [50, 10], [50, 40]);
    expect(placer.nodes.at(-1)).toMatchObject({ x: 50, y: 40 });
    // The move back.
    expect(placer.undo()).toBe(true);
    expect(placer.nodes.at(-1)).toMatchObject({ x: 50, y: 10 });
    // A press dragging a handle out, taken back before its release, which
    // then does nothing.
    placer.press(at(90, 10), reach);
    placer.move(at(100, 30));
    expect(placer.undo()).toBe(true);
    expect(placer.nodes).toHaveLength(2);
    expect(placer.release(at(100, 30))).toBe("placing");
    expect(placer.nodes).toHaveLength(2);
    // The smooth point, then the first.
    expect(placer.undo()).toBe(true);
    expect(placer.nodes).toEqual([corner(10, 10)]);
    expect(placer.undo()).toBe(false);
    expect(placer.nodes).toEqual([]);
  });

  it("takes back the first point while its press is held", () => {
    const placer = new PathPlacer(at(10, 10), reach);
    placer.move(at(30, 30));
    expect(placer.undo()).toBe(false);
    expect(placer.nodes).toEqual([]);
  });

  it("moves across with everything it keeps", () => {
    const placer = clicked([10, 10]);
    drag(placer, [50, 10], [60, 10]);
    placer.press(at(90, 10), reach);
    placer.moveAcross(-8);
    placer.move(at(82, 30));
    placer.release(at(82, 30));
    expect(placer.nodes).toEqual([
      corner(2, 10),
      { x: 42, y: 10, handle: { x: 10, y: 0 }, onGrid: false },
      { x: 82, y: 10, handle: { x: 0, y: 20 }, onGrid: false },
    ]);
    placer.undo();
    placer.undo();
    expect(placer.nodes).toEqual([corner(2, 10)]);
  });
});
