// The Path tool: a curve placed by its points, each a corner or a smooth point
// with a handle, and the points along it that it is saved as. Plain state with
// no canvas or Obsidian, so that unit tests can drive it; session.ts places a
// path through it, and saves the finished curve as an ordinary smooth stroke.

import { toUnits } from "../ink/document.ts";

/** A place in the drawing, in document pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A point of a path, in document pixels: a corner, where the curve can turn
 * sharply, or a smooth point, which the curve passes through without a turn.
 */
export interface PathNode {
  readonly x: number;
  readonly y: number;
  /**
   * A smooth point's handle: the way from the point to the end of the handle
   * the curve leaves by, towards the next point. The curve comes in from the
   * point before along the same handle reversed, so the two are always mirror
   * images. A corner has none.
   */
  readonly handle?: Point;
  /** Whether Shift put the point on the grid, with the grid on. */
  readonly onGrid: boolean;
}

/**
 * How far the pointer must go from where it was pressed, in document
 * pixels, before the press drags: pulls a new point's handles out, or moves
 * the point or handle it took hold of. A handle shorter than this is none, so
 * a click makes a corner however a hand wobbles.
 */
export const dragMin = 4;

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A point with no handle, where `at` is. */
function corner(at: Point, onGrid: boolean): PathNode {
  return { x: at.x, y: at.y, onGrid };
}

/** `node` with `handle`, or as a corner if that is shorter than a drag. */
function withHandle(node: PathNode, handle: Point): PathNode {
  const { x, y, onGrid } = node;
  return Math.hypot(handle.x, handle.y) < dragMin
    ? { x, y, onGrid }
    : { x, y, onGrid, handle };
}

/** Where the end of `node`'s handle on `side` is: 1 out, -1 in. */
export function handleEnd(node: PathNode, side: 1 | -1): Point | undefined {
  const { handle } = node;
  if (handle === undefined) return undefined;
  return { x: node.x + side * handle.x, y: node.y + side * handle.y };
}

/**
 * The cubic Bézier curve from `from` to `to`, as its four control points: the
 * two points, and the ends of the handles between them, or the points
 * themselves for corners. Between two corners it is the straight line.
 */
export function controls(
  from: PathNode,
  to: PathNode,
): readonly [Point, Point, Point, Point] {
  return [from, handleEnd(from, 1) ?? from, handleEnd(to, -1) ?? to, to];
}

/** The point at `t`, from 0 to 1, along the curve through `c`. */
export function cubicAt(
  c: readonly [Point, Point, Point, Point],
  t: number,
): Point {
  const [p0, p1, p2, p3] = c;
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const d = 3 * s * t * t;
  const e = t * t * t;
  return {
    x: a * p0.x + b * p1.x + d * p2.x + e * p3.x,
    y: a * p0.y + b * p1.y + d * p2.y + e * p3.y,
  };
}

/**
 * Points along the curve from `from` to `to`, after `from` and ending on `to`
 * exactly, evenly spaced along the curve and no more than `spacing` apart.
 * Nothing for a curve that never leaves its point.
 */
export function segmentPoints(
  from: PathNode,
  to: PathNode,
  spacing: number,
): Point[] {
  const c = controls(from, to);
  const [p0, p1, p2, p3] = c;
  const leg = Math.max(distance(p0, p1), distance(p1, p2), distance(p2, p3));
  if (leg === 0) return [];
  // The curve goes at most three times its longest leg for each unit of t,
  // so these steps are each at most half the spacing long, and the line
  // through them lies within a fraction of a pixel of the curve.
  const steps = Math.ceil((6 * leg) / spacing);
  const dense: Point[] = [p0];
  const runs: number[] = [0];
  let run = 0;
  for (let step = 1; step <= steps; step++) {
    const point = step === steps ? p3 : cubicAt(c, step / steps);
    run += distance(dense[step - 1] ?? p0, point);
    dense.push(point);
    runs.push(run);
  }
  // Even steps along that line, as many as keep them within the spacing.
  const count = Math.max(1, Math.ceil(run / spacing));
  const points: Point[] = [];
  let at = 1;
  for (let step = 1; step < count; step++) {
    const target = (run * step) / count;
    while (at < steps && (runs[at] ?? run) < target) at++;
    const before = runs[at - 1] ?? 0;
    const after = runs[at] ?? run;
    points.push(
      lerp(
        dense[at - 1] ?? p0,
        dense[at] ?? p3,
        after === before ? 0 : (target - before) / (after - before),
      ),
    );
  }
  points.push({ x: p3.x, y: p3.y });
  return points;
}

/**
 * The points along the path through `nodes`, and with `closed` back from the
 * last to the first, in document pixels: each point of the path exactly, and
 * between them points along each curve no more than `spacing` apart, so that
 * the saved stroke follows the curve and keeps its corners.
 */
export function pathPoints(
  nodes: readonly PathNode[],
  closed: boolean,
  spacing: number,
): Point[] {
  const [first] = nodes;
  if (first === undefined) return [];
  const points: Point[] = [{ x: first.x, y: first.y }];
  for (let index = 1; index < nodes.length; index++) {
    const from = nodes[index - 1];
    const to = nodes[index];
    if (from !== undefined && to !== undefined) {
      points.push(...segmentPoints(from, to, spacing));
    }
  }
  const last = nodes.at(-1);
  if (closed && nodes.length > 1 && last !== undefined) {
    points.push(...segmentPoints(last, first, spacing));
  }
  return points;
}

/** Where the pointer is, for a path being placed. */
export interface PathPointer {
  /** Where it is, in document pixels. */
  readonly at: Point;
  /**
   * Where it places a point or a handle's end: the grid point nearest it
   * with Shift held and the grid on, or else where it is.
   */
  readonly placed: Point;
  /** Whether Shift is held with the grid on, so that `placed` is on the grid. */
  readonly onGrid: boolean;
}

/** What a press on a path being placed takes hold of. */
export type PathTarget =
  | { readonly kind: "point"; readonly index: number }
  | {
      readonly kind: "handle";
      readonly index: number;
      /** The handle's end the curve leaves by, 1, or comes in by, -1. */
      readonly side: 1 | -1;
    };

/** What the pointer holds while it is pressed. */
type Grip =
  /** A point the press placed, whose handle a drag pulls out. */
  | { readonly kind: "new"; readonly index: number }
  /**
   * A point or a handle's end it took hold of, and the way from the pointer
   * to it, so that it does not jump to the pointer.
   */
  | (PathTarget & { readonly offset: Point });

/** What a release leaves a path being placed: still placing, or done. */
export type PathRelease = "placing" | "closed" | "ended";

/**
 * A path as it shows while it is placed: its points, and whether it is
 * closed, as releasing the pointer now, or a click where it is, leaves it.
 */
export interface PathShown {
  readonly nodes: readonly PathNode[];
  readonly closed: boolean;
}

/**
 * The controls of a path being placed, for the drawing area to show over the
 * ink: its points and their handles, and what a press would take hold of, or
 * has.
 */
export interface PathMarks {
  readonly nodes: readonly PathNode[];
  readonly target: PathTarget | undefined;
}

/**
 * A path being placed, a point at a time, as the pointer presses, moves, and
 * lets go:
 *
 * - A click places a corner where it is pressed; a press dragged places a
 *   smooth point there, its handle following the pointer, mirrored on the
 *   other side.
 * - A press on a point, or on a handle's end, takes hold of it, and a drag
 *   moves it. A point moves with its handle; a handle turns its mirror with
 *   it, and dragged back onto its point leaves a corner.
 * - A click on the first point closes the path, once it has two; a click on
 *   the last point ends it open. A click on any other point or handle's end
 *   places a corner, as a click elsewhere does.
 *
 * Each point placed and each drag is a step that {@link undo} takes back.
 * Shift, with the grid on, puts what the pointer places on the grid, as
 * {@link PathPointer} says, and a press with Shift held takes hold of a point
 * that Shift put on the grid only where it snaps to it.
 */
export class PathPlacer {
  #nodes: readonly PathNode[];
  /** The points before each step, for {@link undo}. */
  #steps: (readonly PathNode[])[] = [];
  #grip: Grip | undefined;
  /** The points before the press that holds {@link #grip}. */
  #before: readonly PathNode[] = [];
  /** Where the press that holds {@link #grip} was. */
  #pressed: Point | undefined;
  /** Whether that press has gone far enough to drag. */
  #dragging = false;
  /** Where the pointer last was, and how near counts as on a point. */
  #pointer: PathPointer | undefined;
  #reach = 0;

  /** Starts a path with its first point, at a press. */
  constructor(pointer: PathPointer, reach: number) {
    this.#nodes = [];
    this.press(pointer, reach);
  }

  /** The points placed, with any drag applied as it shows. */
  get nodes(): readonly PathNode[] {
    return this.#nodes;
  }

  /** Where the pointer last was. */
  get pointer(): PathPointer | undefined {
    return this.#pointer;
  }

  /**
   * A press: on a point or a handle's end within `reach` document pixels,
   * taking hold of it; anywhere else, placing a point there.
   */
  press(pointer: PathPointer, reach: number): void {
    this.#pointer = pointer;
    this.#reach = reach;
    this.#pressed = pointer.at;
    this.#dragging = false;
    this.#before = this.#nodes;
    const target = this.#target(pointer);
    if (target === undefined) {
      this.#nodes = [...this.#nodes, corner(pointer.placed, pointer.onGrid)];
      this.#grip = { kind: "new", index: this.#nodes.length - 1 };
      return;
    }
    const node = this.#nodes[target.index];
    const held =
      node === undefined
        ? undefined
        : target.kind === "point"
          ? node
          : handleEnd(node, target.side);
    this.#grip = {
      ...target,
      offset: held === undefined ? { x: 0, y: 0 } : subtract(held, pointer.at),
    };
  }

  /** The pointer moved, pressed or not. */
  move(pointer: PathPointer, reach = this.#reach): void {
    this.#pointer = pointer;
    this.#reach = reach;
    const grip = this.#grip;
    const pressed = this.#pressed;
    if (grip === undefined || pressed === undefined) return;
    if (!this.#dragging) {
      if (distance(pointer.at, pressed) < dragMin) return;
      this.#dragging = true;
    }
    // From the points before the press, or with the point it placed, so that
    // a drag never builds on itself.
    const before = grip.kind === "new" ? this.#nodes : this.#before;
    const node = before[grip.index];
    if (node === undefined) return;
    let moved: PathNode;
    if (grip.kind === "new") {
      moved = withHandle(node, subtract(pointer.placed, node));
    } else {
      const to = pointer.onGrid ? pointer.placed : add(pointer.at, grip.offset);
      if (grip.kind === "point") {
        moved = {
          ...node,
          x: to.x,
          y: to.y,
          onGrid: pointer.onGrid,
        };
      } else {
        // The handle runs from the point to its end the curve leaves by.
        moved = withHandle(
          node,
          grip.side === 1 ? subtract(to, node) : subtract(node, to),
        );
      }
    }
    this.#nodes = before.map((each, index) =>
      index === grip.index ? moved : each,
    );
  }

  /**
   * The press let go here: placing, moving, or, for a click on the first or
   * last point, closing or ending the path.
   */
  release(pointer: PathPointer, reach = this.#reach): PathRelease {
    this.move(pointer, reach);
    const grip = this.#grip;
    const before = this.#before;
    this.#grip = undefined;
    this.#pressed = undefined;
    if (grip === undefined) return "placing";
    if (grip.kind === "new" || this.#dragging) {
      this.#steps.push(before);
      return "placing";
    }
    if (grip.kind === "point") {
      if (grip.index === 0 && this.#nodes.length >= 2) return "closed";
      if (grip.index === this.#nodes.length - 1) return "ended";
    }
    this.#steps.push(before);
    this.#nodes = [...this.#nodes, corner(pointer.placed, pointer.onGrid)];
    return "placing";
  }

  /**
   * Takes back the last step, or a press being held; returns whether the
   * path still has a point.
   */
  undo(): boolean {
    if (this.#grip !== undefined) {
      this.#nodes = this.#before;
      this.#grip = undefined;
      this.#pressed = undefined;
      return this.#nodes.length > 0;
    }
    const before = this.#steps.pop();
    if (before === undefined) return false;
    this.#nodes = before;
    return before.length > 0;
  }

  /** Moves everything across by `dx` document pixels. */
  moveAcross(dx: number): void {
    const across = (nodes: readonly PathNode[]): readonly PathNode[] =>
      nodes.map((node) => ({ ...node, x: node.x + dx }));
    const point = (at: Point): Point => ({ x: at.x + dx, y: at.y });
    this.#nodes = across(this.#nodes);
    this.#before = across(this.#before);
    this.#steps = this.#steps.map(across);
    if (this.#pressed !== undefined) this.#pressed = point(this.#pressed);
    const pointer = this.#pointer;
    if (pointer !== undefined) {
      this.#pointer = {
        ...pointer,
        at: point(pointer.at),
        placed: point(pointer.placed),
      };
    }
  }

  /**
   * The path as releasing the pointer now would leave it, or as a click
   * where the pointer is would: closed on the first point, ended on the
   * last, or with a corner where the pointer is.
   */
  get shown(): PathShown {
    const nodes = this.#nodes;
    const pointer = this.#pointer;
    const grip = this.#grip;
    if (grip?.kind === "new" || this.#dragging || pointer === undefined) {
      return { nodes, closed: false };
    }
    const target = grip ?? this.#target(pointer);
    if (target?.kind === "point") {
      if (target.index === 0 && nodes.length >= 2) {
        return { nodes, closed: true };
      }
      if (target.index === nodes.length - 1) return { nodes, closed: false };
    }
    return {
      nodes: [...nodes, corner(pointer.placed, pointer.onGrid)],
      closed: false,
    };
  }

  /** The path's points and handles, and what a press would take hold of. */
  get marks(): PathMarks {
    const grip = this.#grip;
    const pointer = this.#pointer;
    let target: PathTarget | undefined;
    if (grip !== undefined) {
      target =
        grip.kind === "new"
          ? undefined
          : grip.kind === "point"
            ? { kind: "point", index: grip.index }
            : { kind: "handle", index: grip.index, side: grip.side };
    } else if (pointer !== undefined) {
      target = this.#target(pointer);
    }
    return { nodes: this.#nodes, target };
  }

  /**
   * The point or handle's end that a press at `pointer` takes hold of: the
   * nearest within reach, a point before a handle as near. A point that Shift
   * put on the grid, with Shift held and the grid on, is reached where the
   * pointer snaps to it, as a polygon's corner is.
   */
  #target(pointer: PathPointer): PathTarget | undefined {
    let best: { target: PathTarget; distance: number } | undefined;
    const consider = (target: PathTarget, away: number | undefined): void => {
      if (away === undefined || away > this.#reach) return;
      if (best === undefined || away < best.distance) {
        best = { target, distance: away };
      }
    };
    for (const [index, node] of this.#nodes.entries()) {
      consider({ kind: "point", index }, this.#pointAway(node, pointer));
    }
    for (const [index, node] of this.#nodes.entries()) {
      for (const side of [1, -1] as const) {
        const end = handleEnd(node, side);
        if (end !== undefined) {
          consider({ kind: "handle", index, side }, distance(pointer.at, end));
        }
      }
    }
    return best?.target;
  }

  /**
   * How far `pointer` is from `node`, or undefined if it cannot reach it:
   * with Shift held and the grid on, a point on the grid is reached only
   * where the pointer snaps, in whole units, to it.
   */
  #pointAway(node: PathNode, pointer: PathPointer): number | undefined {
    if (pointer.onGrid && node.onGrid) {
      return toUnits(pointer.placed.x) === toUnits(node.x) &&
        toUnits(pointer.placed.y) === toUnits(node.y)
        ? 0
        : undefined;
    }
    return distance(pointer.at, node);
  }
}
