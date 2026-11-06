// A drawing session: the document being edited, its undo history, the
// current brush, and the stroke being drawn. Plain state with no canvas or
// Obsidian, so that unit tests can drive it.

import {
  unitsPerPixel,
  type Cut,
  type Stroke,
  type StrokeCuts,
  type Tool,
} from "../format/record.ts";
import {
  documentMover,
  moveDocument,
  toUnits,
  type InkDocument,
} from "../ink/document.ts";
import { lineBox } from "../ink/geometry.ts";
import { History } from "../ink/history.ts";
import type { Grid } from "./guides.ts";

export interface BrushSize {
  /** The button label. */
  readonly label: string;
  /** The stroke's diameter in em, so that it scales with the text. */
  readonly em: number;
}

/**
 * The brush sizes, by how they look beside text. Sans and serif text fonts
 * have stems of about 0.09 em in their regular weight and 0.15 to 0.19 em in
 * bold, so M draws as regular text, L as bold, XL heavier, and S half as
 * thick as text, for fine detail. At a 16 px font they are 0.75, 1.5, 2.25,
 * and 3 px wide; their steps of 3/64 em keep whole document pixels.
 */
export const brushSizes: readonly BrushSize[] = [
  { label: "S", em: 3 / 64 },
  { label: "M", em: 6 / 64 },
  { label: "L", em: 9 / 64 },
  { label: "XL", em: 12 / 64 },
];

/**
 * The longest gap left between two recorded points, in document pixels. A
 * fast stroke reports few points, and perfect-freehand's streamline, which
 * pulls each point towards the one before, would then cut its corners, so
 * longer gaps are filled with points along the straight line between.
 */
export const maxGap = 2;

/** A point from the pointer, in document pixels. */
export interface InputPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The grid a session has until its editor lays one out on the note's font:
 * rows and columns 1/8 em, 16 pixels, apart, the rows from the line box's
 * top, so that the baseline, 9 spacings down, lies on it.
 */
export const plainGrid: Grid = {
  spacing: lineBox.pxPerEm / 8,
  rows: Array.from(
    { length: lineBox.height / (lineBox.pxPerEm / 8) + 1 },
    (_, row) => (row * lineBox.pxPerEm) / 8,
  ),
};

/**
 * The grid point nearest `point`, on `grid` with its columns through
 * `originX`: the nearest column, and the nearest of its rows, so that a point
 * beyond the line box snaps to the row at its edge.
 */
export function snapToGrid(
  point: InputPoint,
  grid: Grid = plainGrid,
  originX = 0,
): InputPoint {
  const { spacing, rows } = grid;
  let y = point.y;
  let nearest = Infinity;
  for (const row of rows) {
    const distance = Math.abs(row - point.y);
    if (distance < nearest) {
      nearest = distance;
      y = row;
    }
  }
  return {
    x: Math.round((point.x - originX) / spacing) * spacing + originX,
    y,
  };
}

/**
 * The way across a grid line that a stroke leaves through its end at
 * `points[at]`, from the point `from` it comes from: down or up across the
 * row through that end when the stroke runs at least as steeply as 45°, as an
 * A's legs reach the baseline, and else right or left across the column.
 */
function cutAt(points: readonly number[], at: number, from: number): Cut {
  const dx = (points[at] ?? 0) - (points[from] ?? 0);
  const dy = (points[at + 1] ?? 0) - (points[from + 1] ?? 0);
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? "down" : "up";
  return dx > 0 ? "right" : "left";
}

/**
 * The cut for the end at `at` in `points`, stepping by `step` from it along
 * the stroke: measured from the first point at least `reach` units from it,
 * or else the farthest. Undefined if every point is the end's own.
 */
function endCut(
  points: readonly number[],
  at: number,
  step: number,
  reach: number,
): Cut | undefined {
  const away = (index: number): number =>
    Math.hypot(
      (points[at] ?? 0) - (points[index] ?? 0),
      (points[at + 1] ?? 0) - (points[index + 1] ?? 0),
    );
  let farthest: number | undefined;
  let most = 0;
  for (
    let index = at + step;
    index >= 0 && index < points.length;
    index += step
  ) {
    const distance = away(index);
    if (distance >= reach) return cutAt(points, at, index);
    if (distance > most) {
      most = distance;
      farthest = index;
    }
  }
  return farthest === undefined ? undefined : cutAt(points, at, farthest);
}

/**
 * Where a stroke drawn on the grid is cut flat, for its `x, y` points in
 * units: each end named in `ends`, which lies on a grid point, along the grid
 * line that crosses the stroke most squarely there, on the side away from
 * the stroke. The way the stroke runs at an end comes from the nearest point
 * at least `reach` units from it, or the farthest one; a stroke that never
 * leaves its end, as a dot, is not cut there.
 *
 * `paths` are the ways each end is measured along, if they got anywhere:
 * the stroke's own points by default; for a freehand stroke, the way the
 * pointer went, from where it was pressed to where it was let go, leaving out
 * the jumps from there to the grid points the stroke starts and ends on,
 * which say nothing of the way it ran.
 *
 * A stroke that ends on the grid point it started on has no end to cut, as a
 * closed loop has none: two ends cut there could also take a short one whole.
 */
export function gridCuts(
  points: readonly number[],
  reach: number,
  ends: { readonly start: boolean; readonly end: boolean },
  paths: {
    readonly start?: readonly number[];
    readonly end?: readonly number[];
  } = {},
): StrokeCuts | undefined {
  const last = points.length - 2;
  if (last < 2) return undefined;
  if (points[0] === points[last] && points[1] === points[last + 1]) {
    return undefined;
  }
  const { start: from = points, end: to = points } = paths;
  const start = ends.start
    ? (endCut(from, 0, 2, reach) ?? endCut(points, 0, 2, reach))
    : undefined;
  const end = ends.end
    ? (endCut(to, to.length - 2, -2, reach) ?? endCut(points, last, -2, reach))
    : undefined;
  if (start === undefined && end === undefined) return undefined;
  return {
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
  };
}

/** `x`, in pixels, moved by whole spacings to within the first one. */
function withinSpacing(x: number, spacing: number): number {
  return ((x % spacing) + spacing) % spacing;
}

/**
 * A best guess at where a document's grid columns pass, `columns` pixels
 * apart, in pixels within one spacing, from where its strokes start and end;
 * `fallback` for a document with no strokes. Each stroke's start and end,
 * erasers' too, mark the place within a spacing where they lie, a one-point
 * stroke's once. The place marked most often wins; of places marked equally
 * often, the one that reached that count first in stroke order does, so with
 * no place marked twice, it is where the first stroke starts.
 *
 * Strokes drawn on the grid start and end on its columns, and a save moves
 * the drawing by whole pixels, so a drawing made on the grid lines up with it
 * again, however a save cropped it. Where freehand ends that happen to share
 * a place outnumber the ends drawn on the grid, the guess is theirs.
 */
export function gridOriginOf(
  document: InkDocument,
  fallback = 0,
  columns = plainGrid.spacing,
): number {
  const spacing = Math.round(columns * unitsPerPixel);
  const counts = new Map<number, number>();
  let origin: number | undefined;
  let most = 0;
  for (const { points } of document.strokes) {
    const ends =
      points.length > 2 ? [points[0], points[points.length - 2]] : [points[0]];
    for (const x of ends) {
      if (x === undefined) continue;
      const phase = ((x % spacing) + spacing) % spacing;
      const count = (counts.get(phase) ?? 0) + 1;
      counts.set(phase, count);
      if (count > most) {
        most = count;
        origin = phase;
      }
    }
  }
  return origin === undefined ? fallback : origin / unitsPerPixel;
}

/** What undo and redo step through: the drawing, and where its grid lies. */
interface SessionState {
  readonly document: InkDocument;
  /**
   * An x the grid's columns pass through, in pixels, or undefined where the
   * document's strokes say, on whatever grid the session has, as for the
   * drawing it opened with.
   */
  readonly gridOrigin: number | undefined;
}

/**
 * A stroke being drawn: its brush and its points so far, in units, `x, y`
 * each.
 */
interface ActiveStroke {
  readonly tool: Tool;
  readonly size: number;
  readonly points: number[];
  /** Whether its ends are cut flat where they lie on the grid. */
  readonly flat: boolean;
  /** Whether it started on the grid, and so is cut flat at its start. */
  readonly onGrid: boolean;
  /** Whether it is a polygon, whose points are the corners placed so far. */
  readonly polygon: boolean;
}

/** The point `along` the way from `from` to `to`. */
function between(from: InputPoint, to: InputPoint, along: number): InputPoint {
  return {
    x: from.x + (to.x - from.x) * along,
    y: from.y + (to.y - from.y) * along,
  };
}

/**
 * The points of an ellipse drawn across the box from `from` to `to`, in
 * document pixels: a closed loop, clockwise, no more than {@link maxGap}
 * apart, from the side of the box `from` is on and back to it. That side's x
 * is `from`'s, a grid column's when the drag started on the grid, so that the
 * grid a drawing's stroke ends suggest, as when it is opened again, stays
 * where it was. With `circle`, the box is made square towards `to`, as wide
 * and as tall as its longer side. A box with no width or no height gives the
 * line or the point it is.
 */
export function ellipsePoints(
  from: InputPoint,
  to: InputPoint,
  circle: boolean,
): InputPoint[] {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (circle) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -side : side;
    dy = dy < 0 ? -side : side;
  }
  const rx = Math.abs(dx) / 2;
  const ry = Math.abs(dy) / 2;
  if (rx === 0 && ry === 0) return [from];
  if (rx === 0 || ry === 0) return [from, { x: from.x + dx, y: from.y + dy }];
  const cx = from.x + dx / 2;
  const cy = from.y + dy / 2;
  // Ramanujan's approximation of the perimeter. Points at even angles lie at
  // most π/2 times the mean distance apart, so half the gap leaves room. A
  // count in fours puts points on the box's four sides, so that an ellipse
  // drawn on the grid touches its lines.
  const h = ((rx - ry) / (rx + ry)) ** 2;
  const perimeter =
    Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const count = 4 * Math.max(4, Math.ceil(perimeter / (maxGap / 2) / 4));
  const start = dx < 0 ? 0 : Math.PI;
  return Array.from({ length: count + 1 }, (_, step) => {
    const angle = start + (2 * Math.PI * step) / count;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

/** Neither end of a stroke is cut, as for a polygon. */
const uncut = { start: false, end: false } as const;

/**
 * What the pointer draws on the drawing area: a stroke as it goes, an
 * ellipse across the box dragged, or a polygon with a corner at each click.
 */
export type Shape = "free" | "ellipse" | "polygon";

/**
 * How near a release must be to a polygon's first or last corner, in
 * document pixels, to close or end it there, when it is not on the grid: the
 * brush's radius, or this if that is smaller.
 */
const cornerReachMin = 4;

export class DrawingSession {
  readonly #history: History<SessionState>;
  #saved: InkDocument;
  #active: ActiveStroke | undefined;
  /**
   * The way the pointer went for the stroke being drawn, in units: where it
   * was pressed and each point it reported, before any went to the grid, with
   * a straight segment as where the pointer is at its end now.
   */
  #pointer: number[] = [];
  /** Whether the last of {@link #pointer} is a straight segment's end. */
  #pointerStraight = false;
  /**
   * Whether the stroke being drawn went straight from its first move, from
   * the grid point it starts on, whose start then goes by its ink.
   */
  #straightStart = false;
  /** The last input point of the stroke being drawn, before rounding. */
  #last: InputPoint | undefined;
  /**
   * Where a straight segment of the stroke being drawn starts, and how many
   * values of its points lead up to there, the start included.
   */
  #anchor: { point: InputPoint; length: number } | undefined;
  /** Where an ellipse being drawn started: one corner of its box. */
  #corner: InputPoint | undefined;
  /** Whether the ellipse being drawn is a circle, as Shift makes it. */
  #circle = false;
  /**
   * Where the pointer is for the polygon being placed, before snapping: its
   * next corner goes there, or to the grid point nearest it.
   */
  #next: InputPoint | undefined;
  /** Whether the press that started the polygon being placed is still down. */
  #starting = false;
  /**
   * Whether each corner of the polygon being placed was put on the grid, as
   * the grid was when it was placed, for clicks on it.
   */
  #snaps: boolean[] = [];
  tool: Tool = "pen";
  /** What dragging draws, with the pen or the eraser. */
  shape: Shape = "free";
  /**
   * Whether an ellipse, or a polygon closed on its first corner, is drawn
   * filled, with its edges through its points, as it is drawn and placed.
   */
  fill = false;
  /** Each tool keeps its own selected size for the life of the session. */
  readonly sizes: Record<Tool, number> = { pen: 1, eraser: 1 };

  get sizeIndex(): number {
    return this.sizes[this.tool];
  }

  set sizeIndex(index: number) {
    this.sizes[this.tool] = index;
  }
  /** Whether strokes start and end on the grid. */
  snap = false;
  /**
   * Whether strokes drawn as the pointer goes from now on stop flush with the
   * grid line at an end on the grid, rather than rounding past it. Shapes
   * never do: an ellipse has no ends, and a polygon keeps its square ones.
   */
  flatEnds = false;
  #grid: Grid = plainGrid;
  /** A grid laid out while a stroke was being drawn, for when it ends. */
  #nextGrid: Grid | undefined;
  /**
   * What the last {@link moveDrawing} made, as moves in a row are one step,
   * until anything else happens to the history or the saved drawing.
   */
  #moved: InkDocument | undefined;
  /** The last guess at a document's grid, for {@link gridOrigin}. */
  #guessed:
    { document: InkDocument; spacing: number; origin: number } | undefined;

  constructor(initial: InkDocument) {
    this.#history = new History({ document: initial, gridOrigin: undefined });
    this.#saved = initial;
  }

  /** The grid strokes' ends snap to, which the editor lays out on its font. */
  get grid(): Grid {
    return this.#grid;
  }

  /**
   * Lays out another grid, as when the font is measured again. While a
   * stroke is being drawn, it waits until the stroke ends, so that a stroke
   * starts and ends on one grid, and the grid shown is the one it snaps to.
   */
  set grid(grid: Grid) {
    if (this.#active === undefined) {
      this.#grid = grid;
      this.#nextGrid = undefined;
    } else {
      this.#nextGrid = grid;
    }
  }

  /** Takes up a grid laid out while the stroke just ended was drawn. */
  #takeNextGrid(): void {
    if (this.#nextGrid === undefined) return;
    this.#grid = this.#nextGrid;
    this.#nextGrid = undefined;
  }

  /**
   * How far apart the usual grid's columns are, on a finer grid too: the
   * spacing that {@link gridOrigin} is kept within, so that it means the same
   * in either view, and strokes on a finer grid leave the usual one in place.
   */
  get #period(): number {
    return this.grid.period ?? this.grid.spacing;
  }

  /**
   * Where the grid's columns pass, in document pixels within one spacing of
   * the usual grid, as columns of a finer one pass there too. It moves with
   * the drawing when a save moves that, and with a restored one.
   */
  get gridOrigin(): number {
    const { document, gridOrigin } = this.#history.present;
    const period = this.#period;
    if (gridOrigin !== undefined) return withinSpacing(gridOrigin, period);
    const guessed = this.#guessed;
    if (guessed?.document === document && guessed.spacing === period) {
      return guessed.origin;
    }
    const origin = gridOriginOf(document, 0, period);
    this.#guessed = { document, spacing: period, origin };
    return origin;
  }

  #snapped(point: InputPoint): InputPoint {
    return this.snap ? snapToGrid(point, this.grid, this.gridOrigin) : point;
  }

  get document(): InkDocument {
    return this.#history.present.document;
  }

  /** The document as last saved, or as opened. */
  get saved(): InkDocument {
    return this.#saved;
  }

  /** The stroke size for the current brush, in units. */
  get size(): number {
    return this.sizeFor(this.tool);
  }

  /** The nominal diameter for a tool's selected size. */
  sizeFor(tool: Tool): number {
    const brush = brushSizes[this.sizes[tool]] ?? brushSizes[1];
    return toUnits((brush?.em ?? 6 / 64) * lineBox.pxPerEm);
  }

  get canUndo(): boolean {
    return this.#active === undefined && this.#history.canUndo;
  }

  get canRedo(): boolean {
    return this.#active === undefined && this.#history.canRedo;
  }

  /** Whether the document differs from the last saved one. */
  get dirty(): boolean {
    return (
      this.#history.present.document !== this.#saved ||
      this.#active !== undefined
    );
  }

  get drawing(): boolean {
    return this.#active !== undefined;
  }

  /** Whether a polygon is being placed, a corner at a time. */
  get placing(): boolean {
    return this.#active?.polygon === true;
  }

  /** The captured brush diameter, without copying the active stroke's points. */
  get activeSize(): number | undefined {
    return this.#active?.size;
  }

  /**
   * The stroke being drawn, as it would be committed now, before its end
   * comes to the grid: cut at its start if that is on the grid. A polygon
   * being placed is shown as a click where the pointer is would leave it.
   */
  get activeStroke(): Stroke | undefined {
    const active = this.#active;
    if (active === undefined) return undefined;
    const next = this.#next;
    if (!active.polygon || next === undefined) {
      return this.#stroke(
        active,
        { start: active.onGrid, end: false },
        this.#corner !== undefined && this.fill,
        { start: this.#straightStart ? undefined : this.#path() },
      );
    }
    // A polygon shows what a click where the pointer is would make: a side
    // to its next corner; or closed, on its first corner; or ended, on its
    // last.
    if (this.#closes(active, next)) {
      const closed = { ...active, points: [...active.points] };
      closed.points.push(active.points[0] ?? 0, active.points[1] ?? 0);
      return this.#stroke(closed, uncut, this.fill);
    }
    if (this.#near(active, next, active.points.length - 2)) {
      return this.#stroke(active, uncut);
    }
    const shown = { ...active, points: [...active.points] };
    this.#record(shown, this.#snapped(next));
    return this.#stroke(shown, uncut);
  }

  /**
   * The way the pointer went, in units, as {@link gridCuts} takes it: from
   * the press to `release`, or as far as it has gone; undefined if it
   * reported nowhere but the press, as for a tap, which then has only its
   * points to go by.
   */
  #path(release?: InputPoint): readonly number[] | undefined {
    if (this.#pointer.length <= 2) return undefined;
    // A copy, as the stroke's end goes on to change the pointer's own.
    return release === undefined
      ? [...this.#pointer]
      : [...this.#pointer, toUnits(release.x), toUnits(release.y)];
  }

  /**
   * `active` as a stroke, cut flat at the ends named, which are on the grid,
   * and with `fill`, filled inside, if it has three points to enclose any.
   * The way a cut end runs is measured over at least a cell of the grid and
   * twice the brush's width, so that the small turns near an end that a hand
   * makes, and the jump to a grid point at its start, don't decide it;
   * `paths` are the ways each end is measured along, as for {@link gridCuts}.
   */
  #stroke(
    active: ActiveStroke,
    ends: { readonly start: boolean; readonly end: boolean },
    fill = false,
    paths: {
      readonly start?: readonly number[] | undefined;
      readonly end?: readonly number[] | undefined;
    } = {},
  ): Stroke {
    const { tool, size } = active;
    const points = [...active.points];
    if (fill && points.length >= 6) return { tool, points, kind: "fill" };
    if (active.polygon) return { tool, size, points, kind: "polygon" };
    const stroke = { tool, size, points };
    const reach = Math.max(2 * active.size, toUnits(this.grid.spacing));
    const cut = gridCuts(active.points, reach, ends, {
      ...(paths.start === undefined ? {} : { start: paths.start }),
      ...(paths.end === undefined ? {} : { end: paths.end }),
    });
    return cut === undefined ? stroke : { ...stroke, cut };
  }

  /**
   * Starts a stroke with the current brush, an ellipse with one corner of its
   * box here, or a polygon with its first corner here. An ellipse is a closed
   * loop, with no ends to cut. While a polygon is being placed, a press only
   * moves where its next corner would go, which its release places.
   */
  begin(point: InputPoint): void {
    if (this.#active?.polygon === true) {
      this.#next = point;
      return;
    }
    const ellipse = this.shape === "ellipse";
    const polygon = this.shape === "polygon";
    const flat = this.flatEnds && this.shape === "free";
    this.#active = {
      tool: this.tool,
      size: this.size,
      points: [],
      flat,
      onGrid: this.snap && flat,
      polygon,
    };
    this.#last = undefined;
    this.#anchor = undefined;
    this.#corner = ellipse ? this.#snapped(point) : undefined;
    this.#circle = false;
    this.#starting = polygon;
    this.#snaps = polygon ? [this.snap] : [];
    this.extend([this.#snapped(point)]);
    // After the grid point the stroke starts on, which the pointer never was.
    this.#pointer = [toUnits(point.x), toUnits(point.y)];
    this.#pointerStraight = false;
    this.#straightStart = false;
    if (polygon) this.#record(this.#active, this.#snapped(point));
  }

  /**
   * Adds points to the stroke being drawn, filling gaps longer than
   * {@link maxGap} and skipping exact repeats. While `straight`, as with
   * Shift held, the stroke runs straight from where it was when that began
   * to the latest point, which snaps to the grid when the grid is on.
   */
  extend(points: readonly InputPoint[], straight = false): void {
    const active = this.#active;
    if (active === undefined) return;
    if (active.polygon) {
      const latest = points.at(-1);
      if (latest !== undefined) this.#next = latest;
      return;
    }
    const corner = this.#corner;
    if (corner !== undefined) {
      // An ellipse is drawn again across its box for its latest corner, a
      // circle while `straight`, with the corner on the grid when it is on.
      const latest = points.at(-1);
      if (latest === undefined) return;
      this.#circle = straight;
      active.points.length = 0;
      for (const point of ellipsePoints(
        corner,
        this.#snapped(latest),
        straight,
      )) {
        this.#record(active, point);
      }
      this.#last = latest;
      return;
    }
    for (const point of points) {
      if (!straight) {
        this.#anchor = undefined;
        this.#pointer.push(toUnits(point.x), toUnits(point.y));
        this.#pointerStraight = false;
        this.#append(active, point);
        continue;
      }
      if (this.#pointer.length <= 2) this.#straightStart = true;
      if (this.#pointerStraight) this.#pointer.length -= 2;
      this.#pointer.push(toUnits(point.x), toUnits(point.y));
      this.#pointerStraight = true;
      const anchor = (this.#anchor ??= {
        point: this.#last ?? point,
        length: active.points.length,
      });
      // The segment is drawn again from its start for each new point.
      active.points.length = anchor.length;
      this.#last = anchor.point;
      this.#append(active, this.#snapped(point));
    }
  }

  /** Records a point, and points along the gap since the last one. */
  #append(active: ActiveStroke, point: InputPoint): void {
    const previous = this.#last;
    if (previous !== undefined) {
      const gap = Math.hypot(point.x - previous.x, point.y - previous.y);
      const steps = Math.ceil(gap / maxGap);
      for (let step = 1; step < steps; step++) {
        this.#record(active, between(previous, point, step / steps));
      }
    }
    this.#record(active, point);
    this.#last = point;
  }

  #record(active: ActiveStroke, point: InputPoint): void {
    const x = toUnits(point.x);
    const y = toUnits(point.y);
    const { points } = active;
    if (points.length >= 2 && points.at(-2) === x && points.at(-1) === y) {
      return;
    }
    points.push(x, y);
  }
  /**
   * Commits the stroke being drawn as one undoable step, ending it at
   * `release`, where the pointer was let go, when that is known. A polygon
   * being placed takes a release as a corner, and commits only when that
   * closes or ends it; without a release, it commits with the corners it
   * has, as when saving.
   */
  end(release?: InputPoint): void {
    const placed = this.#active;
    if (placed?.polygon === true) {
      if (release === undefined) this.#commit(placed);
      else this.#place(placed, release);
      return;
    }
    const ellipse = this.#corner !== undefined;
    const straight = ellipse ? this.#circle : this.#anchor !== undefined;
    // The start goes by the way the pointer went, and so does the end, but
    // for a straight segment, which runs as it does right to its end.
    const pointer = this.#path(straight ? undefined : release);
    const path = {
      start: this.#straightStart ? undefined : pointer,
      end: straight ? undefined : pointer,
    };
    // With the grid, the stroke ends on it, at the grid point nearest the
    // release, or else the last point, recorded in the release's place.
    const end = this.snap ? (release ?? this.#last) : release;
    if (end !== undefined && this.#active !== undefined) {
      this.extend([this.#snapped(end)], straight);
    }
    const active = this.#active;
    const stroke =
      active === undefined
        ? undefined
        : this.#stroke(
            active,
            { start: active.onGrid, end: this.snap && active.flat },
            ellipse && this.fill,
            path,
          );
    this.#active = undefined;
    this.#anchor = undefined;
    this.#corner = undefined;
    this.#next = undefined;
    this.#starting = false;
    if (stroke !== undefined && stroke.points.length > 0) {
      // On the grid it was drawn on, which a waiting one then replaces.
      this.#push({
        ...this.document,
        strokes: [...this.document.strokes, stroke],
      });
    }
    this.#takeNextGrid();
  }

  /**
   * Places a polygon's corner where a press is released: on its first
   * corner, once it has three, closing it; on its last, ending it there, but
   * for the press that started it; anywhere else, adding a corner there.
   */
  #place(active: ActiveStroke, release: InputPoint): void {
    const starting = this.#starting;
    this.#starting = false;
    this.#next = release;
    if (this.#closes(active, release)) {
      active.points.push(active.points[0] ?? 0, active.points[1] ?? 0);
      this.#commit(active, this.fill);
      return;
    }
    const count = active.points.length;
    if (this.#near(active, release, count - 2)) {
      if (!starting) this.#commit(active);
      return;
    }
    this.#record(active, this.#snapped(release));
    if (active.points.length > count) this.#snaps.push(this.snap);
  }

  /**
   * Whether a polygon with corners `active` closes at `pointer`, on its first
   * corner.
   */
  #closes(active: ActiveStroke, pointer: InputPoint): boolean {
    return active.points.length >= 6 && this.#near(active, pointer, 0);
  }

  /**
   * Whether `pointer` is on a polygon's corner whose `x` is at `index` in its
   * points: snapping to that point, for a corner on the grid while the grid
   * is on, or else within the brush's radius of it.
   */
  #near(active: ActiveStroke, pointer: InputPoint, index: number): boolean {
    const x = active.points[index];
    const y = active.points[index + 1];
    if (x === undefined || y === undefined) return false;
    if (this.snap && this.#snaps[index / 2] === true) {
      const at = this.#snapped(pointer);
      return toUnits(at.x) === x && toUnits(at.y) === y;
    }
    const reach = Math.max(active.size / unitsPerPixel / 2, cornerReachMin);
    return (
      Math.hypot(
        pointer.x - x / unitsPerPixel,
        pointer.y - y / unitsPerPixel,
      ) <= reach
    );
  }

  /** Commits a polygon as one undoable step, with `fill`, filled inside. */
  #commit(active: ActiveStroke, fill = false): void {
    const stroke = this.#stroke(active, uncut, fill);
    this.#active = undefined;
    this.#next = undefined;
    this.#starting = false;
    this.#snaps = [];
    this.#push({
      ...this.document,
      strokes: [...this.document.strokes, stroke],
    });
    this.#takeNextGrid();
  }

  /**
   * Gives a polygon being placed the tool and brush size chosen now, as when
   * they change while it is placed; a stroke being dragged keeps its own.
   */
  rebrush(): void {
    const active = this.#active;
    if (active?.polygon !== true) return;
    this.#active = { ...active, tool: this.tool, size: this.size };
  }

  /**
   * Takes back the last corner of the polygon being placed, and the polygon
   * with its first. Returns whether there was one.
   */
  undoCorner(): boolean {
    const active = this.#active;
    if (active?.polygon !== true) return false;
    active.points.length -= 2;
    this.#snaps.pop();
    if (active.points.length === 0) this.cancel();
    return true;
  }

  /** Drops the stroke being drawn, as when the pointer is cancelled. */
  cancel(): void {
    this.#active = undefined;
    this.#anchor = undefined;
    this.#corner = undefined;
    this.#next = undefined;
    this.#starting = false;
    this.#snaps = [];
    this.#takeNextGrid();
  }

  undo(): boolean {
    this.#moved = undefined;
    return this.#active === undefined && this.#history.undo();
  }

  redo(): boolean {
    this.#moved = undefined;
    return this.#active === undefined && this.#history.redo();
  }

  /**
   * Removes every stroke and the base layer, as one undoable step, and drops
   * a polygon being placed. A stroke being dragged keeps everything.
   */
  clear(): void {
    if (this.placing) this.cancel();
    if (this.#active !== undefined) return;
    if (
      this.document.strokes.length === 0 &&
      this.document.base === undefined
    ) {
      return;
    }
    this.#push({ strokes: [] });
  }

  /**
   * Moves the whole drawing up or down by `dyUnits`, as one undoable step
   * with the moves just before it, so that one undo takes back a key held
   * down. Returns whether there was a drawing to move: a stroke being drawn
   * keeps everything.
   */
  moveDrawing(dyUnits: number): boolean {
    const { document } = this;
    if (
      this.#active !== undefined ||
      (document.strokes.length === 0 && document.base === undefined)
    ) {
      return false;
    }
    const moved = moveDocument(document, 0, dyUnits);
    const state = { document: moved, gridOrigin: this.gridOrigin };
    if (document === this.#moved) this.#history.amend(state);
    else this.#history.push(state);
    this.#moved = moved;
    return true;
  }

  /**
   * Replaces the document as one undoable step, as when restoring a draft,
   * with the grid's columns through `gridOrigin`, or by default where the
   * document's strokes suggest. Undoing the step puts the grid back too.
   */
  replace(
    document: InkDocument,
    gridOrigin = gridOriginOf(document, this.gridOrigin, this.#period),
  ): void {
    if (this.#active !== undefined) return;
    this.#moved = undefined;
    this.#history.push({ document, gridOrigin });
  }

  /**
   * Moves everything by a whole number of pixels: every state to undo or
   * redo, the saved one, and the stroke being drawn. After a save, this puts
   * the session in the saved file's coordinates, so that what it keeps lines
   * up with the file.
   */
  rebase(dxPixels: number): void {
    this.#moved = undefined;
    if (dxPixels === 0) return;
    // States share most of their strokes; they still do once moved. The grid
    // moves with each, so that it stays where each was drawn on it, the grid
    // the strokes say too, which may have no strokes to say it after this.
    const move = documentMover(dxPixels);
    const period = this.#period;
    this.#history.map(({ document, gridOrigin }) => ({
      document: move(document),
      gridOrigin: (gridOrigin ?? gridOriginOf(document, 0, period)) + dxPixels,
    }));
    this.#saved = move(this.#saved);
    const active = this.#active;
    if (active !== undefined) {
      const dx = toUnits(dxPixels);
      for (let index = 0; index < active.points.length; index += 2) {
        active.points[index] = (active.points[index] ?? 0) + dx;
      }
    }
    for (let index = 0; index < this.#pointer.length; index += 2) {
      this.#pointer[index] = (this.#pointer[index] ?? 0) + toUnits(dxPixels);
    }
    if (this.#last !== undefined) {
      this.#last = { ...this.#last, x: this.#last.x + dxPixels };
    }
    if (this.#anchor !== undefined) {
      const { point } = this.#anchor;
      this.#anchor.point = { ...point, x: point.x + dxPixels };
    }
    if (this.#corner !== undefined) {
      this.#corner = { ...this.#corner, x: this.#corner.x + dxPixels };
    }
    if (this.#next !== undefined) {
      this.#next = { ...this.#next, x: this.#next.x + dxPixels };
    }
  }

  /** Records `document` as saved, so that it is no longer dirty. */
  markSaved(document: InkDocument): void {
    this.#saved = document;
    this.#moved = undefined;
  }

  /** Records `document` as one undoable step, keeping the grid. */
  #push(document: InkDocument): void {
    this.#history.push({ document, gridOrigin: this.gridOrigin });
  }
}
