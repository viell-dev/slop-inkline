// What an eraser stroke drawn as the pointer goes takes away: exactly the
// area a round brush of its size sweeps along the pointer's way, saved as an
// eraser stroke of kind "fill" (#341). A smooth stroke's outline is worked
// out again from all its points as each one comes, and behind the brush it
// changes shape, so ink an eraser had taken came back beside its way. This
// area only grows as the way goes on, and what is shown while erasing is the
// stroke that is saved. Plain geometry in units, with no canvas, so that unit
// tests can check it. Files stay as they were: a "fill" is format version 1's,
// and nothing here changes how any stroke draws.

import {
  unitsPerPixel,
  type Stroke,
  type StrokeCuts,
  type Tool,
} from "../format/record.ts";
import type { Bounds } from "../ink/geometry.ts";
import { cutBoxes, uncutRest } from "../ink/outline.ts";

/** A point, in units. */
export type Point = readonly [number, number];

/**
 * The most points one straight line of the way stands for, so that finding
 * where a line ends costs as much for a long straight stroke as a short one.
 */
export const sweepRun = 64;

/**
 * How far, in units, the outline's chords may lie inside the brush's circle:
 * one, a sixteenth of a pixel, too little for an edge pixel to show.
 */
export const arcTolerance = 1;

/**
 * Whether `point` lies on the straight line from `from` to `to`, between
 * them: exactly, as all three are in whole units, well within the range in
 * which a double's products of them are exact.
 */
function onSegment(point: Point, from: Point, to: Point): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const px = point[0] - from[0];
  const py = point[1] - from[1];
  const along = px * dx + py * dy;
  const length = dx * dx + dy * dy;
  // A line back to where it started stands for no other point.
  if (length === 0) return false;
  return dx * py - dy * px === 0 && along >= 0 && along <= length;
}

/**
 * The way an eraser's brush went, from its `x, y` points in units: a point
 * repeated in a row once, and each run of points on one straight line, in
 * order along it, as the line from its first point to its last, at most
 * {@link sweepRun} points long. A round brush sweeps the same area along the
 * line as along the run's points, so this changes nothing the stroke takes
 * away, and as each point comes, only the way's last line can grow longer.
 */
export function sweepPath(points: readonly number[]): Point[] {
  const corners: Point[] = [];
  let run: Point[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const point: Point = [points[index] ?? 0, points[index + 1] ?? 0];
    const before = run.at(-1) ?? corners.at(-1);
    if (before?.[0] === point[0] && before[1] === point[1]) continue;
    const anchor = corners.at(-1);
    if (anchor === undefined) {
      corners.push(point);
      continue;
    }
    const last = run.at(-1);
    if (
      last !== undefined &&
      (run.length >= sweepRun ||
        !run.every((passed) => onSegment(passed, anchor, point)))
    ) {
      corners.push(last);
      run = [];
    }
    run.push(point);
  }
  const last = run.at(-1);
  return last === undefined ? corners : [...corners, last];
}

/**
 * The outline of what a round brush of `radius` units sweeps along `path`, a
 * way in units with no point repeated in a row, to be filled with the nonzero
 * rule: a circle for a way of one point. Its first and last points are the
 * way's last point, as a stroke's ends mark where a reopened drawing's grid
 * lies, and no other point of the outline could mark it rightly; unless
 * `marked` is false, for an end to be cut, when it starts and ends beside it.
 *
 * It goes round one side of the way from its end, round its start, and back
 * along the other side, with a half circle at each end. Where the way turns,
 * the side outside the turn goes round a circle about the corner. The side
 * inside it goes straight through where the two lines' edges meet, when both
 * lines are long enough for that, and otherwise in to the corner itself and
 * out again. Taken together, that is the sum of pieces all wound one way: a
 * rectangle along each straight line of the way, the slice of a circle outside
 * each turn, and a half circle at each end, with some of what two rectangles
 * both cover taken out once. So the nonzero rule fills every point that any of
 * them covers, however the way crosses itself or turns back, and only those:
 * ink the way goes round without covering, as inside a loop, stays. From the
 * way's last point, it goes out to the tip of the end and starts round from
 * there; it comes back round to the tip, round the half after it once more,
 * and in to that point, which covers that half twice and adds nothing more.
 * No part of the outline goes out and straight back along itself: that
 * encloses nothing, but where a renderer adds up the coverage of each edge,
 * it can leave a hairline that one edge covered and the other did not take
 * back.
 */
export function sweepOutline(
  path: readonly Point[],
  radius: number,
  marked = true,
): Point[] {
  const moves = path
    .slice(1)
    .map((to, index): Point => [
      to[0] - (path[index] ?? to)[0],
      to[1] - (path[index] ?? to)[1],
    ]);
  const steps = moves.map(([dx, dy]): Point => {
    const length = Math.hypot(dx, dy);
    return [dx / length, dy / length];
  });
  const first = path[0];
  const last = path.at(-1);
  if (first === undefined || last === undefined) return [];
  // The circle's corners lie at whole steps of one turn about its centre,
  // each step no larger than arcTolerance allows, whichever part of the
  // circle an arc follows. So where the way goes on from what was its end,
  // the corners its half circle had that stay on the outline stay exactly
  // where they were, rounded alike: the edge does not move.
  const largest = 2 * Math.acos(Math.max(-1, 1 - arcTolerance / radius));
  const turnStep = (2 * Math.PI) / Math.ceil((2 * Math.PI) / largest);
  const outline: Point[] = [];
  const push = (point: Point): void => {
    outline.push(point);
  };
  /**
   * The circle's corners between the ends of an arc about `centre`, from
   * `centre + start` turning `angle` back, the way the ends' half circles go.
   */
  const arc = (centre: Point, start: Point, angle: number): void => {
    const from = Math.atan2(start[1], start[0]);
    const to = from - angle;
    // Not at the arc's own ends, which the sides put there.
    const margin = 1e-9;
    for (
      let step = Math.ceil((from - margin) / turnStep) - 1;
      step * turnStep > to + margin;
      step--
    ) {
      push([
        centre[0] + radius * Math.cos(step * turnStep),
        centre[1] + radius * Math.sin(step * turnStep),
      ]);
    }
  };
  const firstStep = steps[0];
  const lastStep = steps.at(-1);
  if (firstStep === undefined || lastStep === undefined) {
    push([first[0] + radius, first[1]]);
    arc(first, [radius, 0], 2 * Math.PI);
    return outline;
  }
  /** The side of the way that a step's normal points to, `radius` out. */
  const side = ([dx, dy]: Point): Point => [-dy * radius, dx * radius];
  const along = (point: Point, offset: Point, sign: number): Point => [
    point[0] + sign * offset[0],
    point[1] + sign * offset[1],
  ];
  // At each corner: how far the way turns there, and whether the normal's
  // side is outside the turn, from the moves in whole units, so that a way
  // that goes straight on turns by exactly nothing. A way that turns straight
  // back has its turn outside the normal's side. Inside the turn, where both
  // lines are long enough that the part of their rectangles between the
  // corner and where their edges meet lies in both, the outline goes straight
  // through that meeting point; otherwise through the corner itself, which
  // the pieces always add up to.
  const corners = moves.slice(1).map((move, index) => {
    const before = moves[index] ?? move;
    const cross = before[0] * move[1] - before[1] * move[0];
    const dot = before[0] * move[0] + before[1] * move[1];
    const angle = Math.atan2(Math.abs(cross), dot);
    const normalOutside = cross < 0 || (cross === 0 && dot < 0);
    const shortest = Math.min(
      Math.hypot(before[0], before[1]),
      Math.hypot(move[0], move[1]),
    );
    const reach =
      radius * Math.max(Math.sin(angle), Math.tan(Math.min(angle, 3) / 2));
    let meet: Point | undefined;
    if (angle > 0 && angle < 3 && shortest >= reach) {
      // The inside edges, `radius` from each line, meet on the bisector.
      const sign = normalOutside ? -1 : 1;
      const a = side(steps[index] ?? firstStep);
      const b = side(steps[index + 1] ?? lastStep);
      const scale = sign / (1 + Math.cos(angle));
      const corner = path[index + 1] ?? last;
      meet = [
        corner[0] + (a[0] + b[0]) * scale,
        corner[1] + (a[1] + b[1]) * scale,
      ];
    }
    return { angle, normalOutside, meet };
  });
  const lastSide = side(lastStep);
  // From the way's last point out to the tip of its end, and round.
  const ahead: Point = [lastStep[0] * radius, lastStep[1] * radius];
  if (marked) {
    push(last);
    push(along(last, ahead, 1));
    arc(last, ahead, Math.PI / 2);
  } else {
    push(along(last, lastSide, 1));
    arc(last, lastSide, Math.PI);
  }
  // Back along the side away from the normal, inside the turns the normal's
  // side is outside of.
  for (let index = steps.length - 1; index >= 0; index--) {
    const offset = side(steps[index] ?? lastStep);
    const corner = path[index] ?? first;
    const entered = corners[index];
    if (entered?.normalOutside !== true || entered.meet === undefined) {
      push(along(path[index + 1] ?? last, offset, -1));
    }
    const turn = corners[index - 1];
    if (turn?.normalOutside === true && turn.meet !== undefined) {
      push(turn.meet);
      continue;
    }
    push(along(corner, offset, -1));
    // Where a long line goes straight on, there is no corner to go round.
    if (turn === undefined || turn.angle === 0) continue;
    if (turn.normalOutside) push(corner);
    else arc(corner, along([0, 0], offset, -1), turn.angle);
  }
  const firstSide = side(firstStep);
  arc(first, along([0, 0], firstSide, -1), Math.PI);
  // And forward along the normal's side.
  steps.forEach((step, index) => {
    const offset = side(step);
    const corner = path[index + 1] ?? last;
    const entered = corners[index - 1];
    if (entered?.normalOutside !== false || entered.meet === undefined) {
      push(along(path[index] ?? first, offset, 1));
    }
    const turn = corners[index];
    if (turn?.normalOutside === false && turn.meet !== undefined) {
      push(turn.meet);
      return;
    }
    push(along(corner, offset, 1));
    if (turn === undefined || turn.angle === 0) return;
    if (turn.normalOutside) arc(corner, offset, turn.angle);
    else push(corner);
  });
  if (!marked) return outline;
  // Round the end to its tip, round the half after the tip once more, and
  // back in to the way's last point.
  arc(last, lastSide, Math.PI / 2);
  push(along(last, ahead, 1));
  arc(last, ahead, Math.PI / 2);
  push(along(last, lastSide, -1));
  push(last);
  return outline;
}

/** `polygon` cut down to what lies in `box`, its sides on the box's edges. */
export function clipToBox(polygon: readonly Point[], box: Bounds): Point[] {
  const edges: [axis: 0 | 1, limit: number, keepBelow: boolean][] = [
    [0, box.left, false],
    [0, box.right, true],
    [1, box.top, false],
    [1, box.bottom, true],
  ];
  let clipped: Point[] = [...polygon];
  for (const [axis, limit, keepBelow] of edges) {
    if (!Number.isFinite(limit) || clipped.length === 0) continue;
    const inside = (point: Point): boolean =>
      keepBelow ? point[axis] <= limit : point[axis] >= limit;
    const crossing = (from: Point, to: Point): Point => {
      const along = (limit - from[axis]) / (to[axis] - from[axis]);
      const other = axis === 0 ? 1 : 0;
      const value = from[other] + along * (to[other] - from[other]);
      return axis === 0 ? [limit, value] : [value, limit];
    };
    const input = clipped;
    clipped = [];
    input.forEach((point, index) => {
      const previous = input[(index + input.length - 1) % input.length];
      if (previous === undefined) return;
      if (inside(point)) {
        if (!inside(previous)) clipped.push(crossing(previous, point));
        clipped.push(point);
      } else if (inside(previous)) {
        clipped.push(crossing(previous, point));
      }
    });
  }
  return clipped;
}

/** A box in units, from one in pixels. */
function inUnits(box: Bounds): Bounds {
  return {
    left: box.left * unitsPerPixel,
    top: box.top * unitsPerPixel,
    right: box.right * unitsPerPixel,
    bottom: box.bottom * unitsPerPixel,
  };
}

/**
 * The area `polygon` encloses, twice over, counting each part as often as it
 * winds round it: when all its pieces wind one way, it is more than nothing
 * where any of them covers anything.
 */
function windingArea(polygon: readonly Point[]): number {
  let area = 0;
  polygon.forEach(([x0, y0], index) => {
    const [x1, y1] = polygon[(index + 1) % polygon.length] ?? [x0, y0];
    area += x0 * y1 - x1 * y0;
  });
  return Math.abs(area);
}

/**
 * The area of a sweep with cut ends, as one outline, as the format cuts a
 * smooth stroke's: everything outside its cut boxes, and inside them only the
 * sweep of the rest of the way without its cut ends, `rest`. When none of the
 * sweep lies past a cut end's row but in its box, and none of the rest's in a
 * box, as for a stroke that comes to a row and stops, that is the sweep with
 * all past the rows cut off. Undefined otherwise, as the area then takes
 * pieces that one outline could join only by going out and back.
 */
function cutOutline(
  outline: readonly Point[],
  rest: readonly Point[] | undefined,
  ends: readonly { readonly box: Bounds; readonly down: boolean }[],
): Point[] | undefined {
  // Clipping keeps the winding of every point it keeps, so the area left in
  // a part of the plane is what the outline covers there.
  const covers = (polygon: readonly Point[], part: Bounds): boolean =>
    windingArea(clipToBox(polygon, part)) > 1;
  let kept: Bounds = {
    left: -Infinity,
    right: Infinity,
    top: -Infinity,
    bottom: Infinity,
  };
  for (const { box, down } of ends) {
    // Past the row through the end, beside its box or beyond it.
    const row = down ? box.top : box.bottom;
    const past = down
      ? { top: row, bottom: Infinity }
      : { top: -Infinity, bottom: row };
    const beyond = down
      ? { top: box.bottom, bottom: Infinity }
      : { top: -Infinity, bottom: box.top };
    const strays: Bounds[] = [
      { ...past, left: -Infinity, right: box.left },
      { ...past, left: box.right, right: Infinity },
      { ...beyond, left: -Infinity, right: Infinity },
    ];
    if (strays.some((part) => covers(outline, part))) return undefined;
    if (rest !== undefined && covers(rest, box)) return undefined;
    kept = down
      ? { ...kept, bottom: Math.min(kept.bottom, row) }
      : { ...kept, top: Math.max(kept.top, row) };
  }
  return clipToBox(outline, kept);
}

/**
 * Points in units as a stroke's, whole, with no point repeated in a row, and
 * no corner where the outline turns straight back along the line it came by,
 * as rounding can make the corner inside a turn by a hair, and as clipping
 * along a row can: the step back encloses nothing, and a renderer can leave a
 * hairline of it.
 */
function flattened(points: readonly Point[]): number[] {
  const flat: number[] = [];
  for (const [x, y] of points) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (flat.at(-2) === rx && flat.at(-1) === ry) continue;
    // In whole units, these products are exact.
    for (;;) {
      const ax = flat.at(-4);
      const ay = flat.at(-3);
      const bx = flat.at(-2);
      const by = flat.at(-1);
      if (
        ax === undefined ||
        ay === undefined ||
        bx === undefined ||
        by === undefined
      ) {
        break;
      }
      const cross = (bx - ax) * (ry - by) - (by - ay) * (rx - bx);
      const dot = (bx - ax) * (rx - bx) + (by - ay) * (ry - by);
      if (cross !== 0 || dot >= 0) break;
      flat.length -= 2;
    }
    if (flat.at(-2) === rx && flat.at(-1) === ry) continue;
    flat.push(rx, ry);
  }
  return flat;
}

/**
 * `polygon`, clipped along the row through a cut end at `end`, put to start
 * and end there: on the row's edge that the end lies on, or undefined when it
 * lies on none.
 */
function throughEnd(
  polygon: readonly Point[],
  end: Point,
): Point[] | undefined {
  for (let index = 0; index < polygon.length; index++) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    if (from === undefined || to === undefined) continue;
    const onRow = from[1] === end[1] && to[1] === end[1];
    const within =
      Math.min(from[0], to[0]) <= end[0] && end[0] <= Math.max(from[0], to[0]);
    if (!onRow || !within) continue;
    return [
      end,
      ...polygon.slice(index + 1),
      ...polygon.slice(0, index + 1),
      end,
    ];
  }
  return undefined;
}

/**
 * The stroke an eraser's brush of `size` units leaves along `way`, its `x, y`
 * points in units, with its ends cut as `cut` says: a stroke of kind "fill"
 * whose points go round the area the brush swept, starting and ending at the
 * way's last point. A way that never left its first point is the round dot a
 * smooth stroke draws exactly; so is a cut stroke whose area would take more
 * than one outline, as when the rest of the way comes back into a cut end's
 * box, which Flat ends rarely meets, and the format's own cut then draws. Such
 * a smooth stroke goes through `points`, the way with the points that fill
 * its gaps, as a smooth stroke needs them.
 */
export function sweptStroke(
  tool: Tool,
  size: number,
  way: readonly number[],
  cut?: StrokeCuts,
  points: readonly number[] = way,
): Stroke {
  const smooth = {
    tool,
    size,
    points: [...points],
    ...(cut === undefined ? {} : { cut }),
  };
  const path = sweepPath(way);
  const last = path.at(-1);
  if (path.length < 2 || last === undefined) return smooth;
  const radius = size / 2;
  if (cut === undefined) {
    return {
      tool,
      kind: "fill",
      points: flattened(sweepOutline(path, radius)),
    };
  }
  // A cut end's row is the outline's edge there, which the end lies on.
  const endCut = cut.end !== undefined;
  const rest = uncutRest(smooth);
  const restPath = rest === undefined ? [] : sweepPath(rest.points);
  const directions = [cut.start, cut.end].filter(
    (direction) => direction !== undefined,
  );
  const ends = cutBoxes(smooth).map((box, index) => ({
    box: inUnits(box),
    down: directions[index] === "down",
  }));
  const clipped = cutOutline(
    sweepOutline(path, radius, !endCut),
    restPath.length > 0 ? sweepOutline(restPath, radius) : undefined,
    ends,
  );
  const marked =
    clipped === undefined || !endCut ? clipped : throughEnd(clipped, last);
  if (marked === undefined) return smooth;
  // The outline starts and ends at the way's last point, unless the cut took
  // it, when it could mark the grid where it is not.
  const flat = flattened(marked);
  const marks = [flat[0], flat[1], flat.at(-2), flat.at(-1)];
  return flat.length >= 6 && marks.every((value, at) => value === last[at % 2])
    ? { tool, kind: "fill", points: flat }
    : smooth;
}
