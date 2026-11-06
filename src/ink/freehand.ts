// The outline of a stroke drawn as the pointer went: the polygon its ink fills.
// It is part of the file format, as reopening a file draws its strokes again,
// so docs/file-format.md specifies it step by step, and a change here changes
// how saved symbols look, which test/unit/ink/outline.test.ts pins.
//
// Adapted from `getStroke` of perfect-freehand 1.2.3, by Steve Ruiz, under the
// MIT licence in freehand.LICENSE.txt, for the one set of options the format
// uses: a constant width, round ends, and no tapers. It lives here so that no
// package update can change what a saved symbol looks like. It differs from
// that version in one way: a stroke that never leaves its first point is a
// round dot on that point.

/** A point, in pixels. */
export type Point = readonly [number, number];

/** How far each point moves towards the next one. */
const pull = 0.575;

/** Half a turn, and a little more, as the outline has always turned. */
const halfTurn = Math.PI + 0.0001;

/** How near the stroke's end, in pixels, points are left out as noise. */
const endNoise = 3;

/** Steps in the half circle of a stroke's start, and of a sharp corner. */
const roundSteps = 13;

/** Steps in the turn and a half that draws the stroke's end. */
const endSteps = 29;

/** Corners of the polygon that stands for a dot's circle. */
const dotCorners = 16;

function add([ax, ay]: Point, [bx, by]: Point): Point {
  return [ax + bx, ay + by];
}

function subtract([ax, ay]: Point, [bx, by]: Point): Point {
  return [ax - bx, ay - by];
}

function times([x, y]: Point, factor: number): Point {
  return [x * factor, y * factor];
}

function dot([ax, ay]: Point, [bx, by]: Point): number {
  return ax * bx + ay * by;
}

/** The vector turned a quarter turn. */
function perpendicular([x, y]: Point): Point {
  return [y, -x];
}

/** The point `along` the way from `from` to `to`. */
function between(from: Point, to: Point, along: number): Point {
  return add(from, times(subtract(to, from), along));
}

function squaredDistance(a: Point, b: Point): number {
  const [x, y] = subtract(a, b);
  return x * x + y * y;
}

/** `point` turned about `center` by `angle` radians. */
function rotated(point: Point, center: Point, angle: number): Point {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const [x, y] = subtract(point, center);
  return add([x * cos - y * sin, x * sin + y * cos], center);
}

/** A point on the smoothed path, with what the outline needs of it. */
interface Sample {
  readonly point: Point;
  /** The unit vector from this point back to the one before it. */
  readonly vector: Point;
  /** How far along the path it is. */
  readonly running: number;
}

/**
 * The stroke's points smoothed into the path its outline follows. Each point
 * but the last is pulled from the one before it towards its own place, and
 * points within `size` of the start are left out, other than the last, to
 * steady the stroke's direction.
 */
function smoothedPath(input: readonly Point[], size: number): Sample[] {
  const [start, second] = input;
  if (start === undefined) return [];
  // Two points get three more between them, so that the path has a middle.
  const points =
    input.length === 2 && second !== undefined
      ? [0, 1, 2, 3, 4].map((step) => between(start, second, step / 4))
      : input;
  const path: Sample[] = [{ point: start, vector: [0, 0], running: 0 }];
  let previous = start;
  let running = 0;
  let steady = false;
  const last = points.length - 1;
  for (let index = 1; index <= last; index++) {
    const target = points[index] ?? start;
    const point = index === last ? target : between(previous, target, pull);
    if (point[0] === previous[0] && point[1] === previous[1]) continue;
    const away = subtract(previous, point);
    const distance = Math.hypot(away[1], away[0]);
    running += distance;
    if (index < last && !steady) {
      if (running < size) continue;
      steady = true;
    }
    path.push({ point, vector: times(away, 1 / distance), running });
    previous = point;
  }
  // The first point has no point before it: it goes the way the second does.
  const next = path[1];
  return next === undefined
    ? path
    : [{ point: start, vector: next.vector, running: 0 }, ...path.slice(1)];
}

/**
 * The circle a stroke that stays on one point draws. Its corners lie just
 * outside the circle, so that the curve through its sides' midpoints lies on
 * it.
 */
function circle(center: Point, radius: number): Point[] {
  const reach = radius / Math.cos(Math.PI / dotCorners);
  return Array.from({ length: dotCorners }, (_, index) => {
    const angle = (2 * Math.PI * index) / dotCorners;
    return add(center, [reach * Math.cos(angle), reach * Math.sin(angle)]);
  });
}

/**
 * The polygon a stroke `size` pixels wide fills along `points`, in pixels, to
 * be traced as a closed curve through its sides' midpoints, and filled with
 * the nonzero rule, since an outline crosses itself wherever its stroke does.
 * Empty without points.
 */
export function freehandOutline(
  points: readonly Point[],
  size: number,
): Point[] {
  const path = smoothedPath(points, size);
  const start = path[0];
  const end = path.at(-1);
  if (start === undefined || end === undefined) return [];
  const radius = size / 2;
  if (path.length === 1) return circle(start.point, radius);
  const nearest = radius ** 2;
  const left: Point[] = [];
  const right: Point[] = [];
  let previousVector = start.vector;
  let previousLeft = start.point;
  let previousRight = start.point;
  let afterCorner = false;
  path.forEach(({ point, vector, running }, index) => {
    const last = index === path.length - 1;
    if (!last && end.running - running < endNoise) return;
    const nextVector = (path[index + 1] ?? end).vector;
    const nextTurn = last ? 1 : dot(vector, nextVector);
    const corner = dot(vector, previousVector) < 0 && !afterCorner;
    const nextCorner = nextTurn < 0;
    if (corner || nextCorner) {
      // A sharp corner: a half circle round it on each side.
      const offset = times(perpendicular(previousVector), radius);
      for (let step = 0; step <= roundSteps; step++) {
        const angle = (halfTurn * step) / roundSteps;
        previousLeft = rotated(subtract(point, offset), point, angle);
        previousRight = rotated(add(point, offset), point, -angle);
        left.push(previousLeft);
        right.push(previousRight);
      }
      if (nextCorner) afterCorner = true;
      return;
    }
    afterCorner = false;
    if (last) {
      const offset = times(perpendicular(vector), radius);
      left.push(subtract(point, offset));
      right.push(add(point, offset));
      return;
    }
    const offset = times(
      perpendicular(between(nextVector, vector, nextTurn)),
      radius,
    );
    const onLeft = subtract(point, offset);
    if (index <= 1 || squaredDistance(previousLeft, onLeft) > nearest) {
      left.push(onLeft);
      previousLeft = onLeft;
    }
    const onRight = add(point, offset);
    if (index <= 1 || squaredDistance(previousRight, onRight) > nearest) {
      right.push(onRight);
      previousRight = onRight;
    }
    previousVector = vector;
  });
  const firstRight = right[0] ?? start.point;
  const startCap = Array.from({ length: roundSteps }, (_, step) =>
    rotated(firstRight, start.point, (halfTurn * (step + 1)) / roundSteps),
  );
  const tip = add(
    end.point,
    times(perpendicular(times(end.vector, -1)), radius),
  );
  const endCap = Array.from({ length: endSteps }, (_, step) =>
    rotated(tip, end.point, (3 * halfTurn * (step + 1)) / endSteps),
  );
  return [...left, ...endCap, ...right.reverse(), ...startCap];
}
