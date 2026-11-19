// What an eraser stroke drawn as the pointer goes takes away: exactly the
// area a round brush of its size sweeps along the pointer's way, saved as an
// eraser stroke of kind "fill" (#341). A smooth stroke's outline is worked
// out again from all its points as each one comes, and behind the brush it
// changes shape, so ink an eraser had taken came back beside its way. This
// area only grows as the way goes on, and what is shown while erasing is the
// stroke that is saved. Its ends are never cut: an eraser stroke that Flat
// ends could cut is a smooth stroke, as before. Plain geometry in units, with
// no canvas, so that unit tests can check it. Files stay as they were: a
// "fill" is format version 1's, and nothing here changes how any stroke
// draws.

import type { Stroke, Tool } from "../format/record.ts";

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
 * lies, and no other point of the outline could mark it rightly.
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
export function sweepOutline(path: readonly Point[], radius: number): Point[] {
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
    // Out from the centre, round the whole circle and a quarter more, and
    // back in square to the way out, as a way's end is marked.
    const right: Point = [radius, 0];
    push(first);
    push([first[0] + radius, first[1]]);
    arc(first, right, 2 * Math.PI);
    push([first[0] + radius, first[1]]);
    arc(first, right, Math.PI / 2);
    push([first[0], first[1] - radius]);
    push(first);
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
  push(last);
  push(along(last, ahead, 1));
  arc(last, ahead, Math.PI / 2);
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
  // Round the end to its tip, round the half after the tip once more, and
  // back in to the way's last point.
  arc(last, lastSide, Math.PI / 2);
  push(along(last, ahead, 1));
  arc(last, ahead, Math.PI / 2);
  push(along(last, lastSide, -1));
  push(last);
  return outline;
}

/**
 * Points in units as a stroke's, whole, with no point repeated in a row, and
 * no corner where the outline turns straight back along the line it came by,
 * as rounding can make the corner inside a turn by a hair: the step back
 * encloses nothing, and a renderer can leave a hairline of it.
 */
function flattened(points: readonly Point[]): number[] {
  const flat: number[] = [];
  // Read by index rather than with `at`, which in V8 made the eraser's
  // preview about a tenth slower, as measured on #381.
  let length = 0;
  for (const [x, y] of points) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    // In whole units, these products are exact.
    while (length >= 4) {
      const ax = flat[length - 4] ?? 0;
      const ay = flat[length - 3] ?? 0;
      const bx = flat[length - 2] ?? 0;
      const by = flat[length - 1] ?? 0;
      const cross = (bx - ax) * (ry - by) - (by - ay) * (rx - bx);
      const dot = (bx - ax) * (rx - bx) + (by - ay) * (ry - by);
      if (cross !== 0 || dot >= 0) break;
      length -= 2;
    }
    if (length >= 2 && flat[length - 2] === rx && flat[length - 1] === ry) {
      continue;
    }
    flat[length++] = rx;
    flat[length++] = ry;
  }
  flat.length = length;
  return flat;
}

/**
 * The stroke an eraser's brush of `size` units leaves along `way`, its `x, y`
 * points in units: a stroke of kind "fill", whose points go round the area
 * the brush swept, starting and ending at the way's last point. A way that
 * never left its first point is the brush's circle.
 */
export function sweptStroke(
  tool: Tool,
  size: number,
  way: readonly number[],
): Stroke {
  return {
    tool,
    kind: "fill",
    points: flattened(sweepOutline(sweepPath(way), size / 2)),
  };
}
