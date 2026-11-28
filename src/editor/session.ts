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
import { finerGrid, type Grid } from "./guides.ts";
import {
  PathPlacer,
  pathPoints,
  type PathMarks,
  type PathNode,
  type PathPointer,
  type PathReach,
  type PathState,
} from "./path.ts";
import { sweptStroke } from "./sweep.ts";

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
 * longer gaps are filled with points along the straight line between. An
 * eraser's sweep, which follows straight lines between its points exactly,
 * needs none.
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

/** The way a stroke runs out through one of its ends, in units. */
interface EndRun {
  readonly dx: number;
  readonly dy: number;
}

/** The way from the point at `from` in `points` to the end at `at`. */
function runTo(points: readonly number[], at: number, from: number): EndRun {
  return {
    dx: (points[at] ?? 0) - (points[from] ?? 0),
    dy: (points[at + 1] ?? 0) - (points[from + 1] ?? 0),
  };
}

/**
 * The cut for an end that runs out by `run`: down or up across the row
 * through it when it runs at least as steeply as 45°, as an A's legs reach the
 * baseline. An end running more along the row than across it has none, as
 * Flat ends only ever cuts along a row: a line drawn along the baseline stays
 * whole, with its round ends.
 */
function cutOf({ dx, dy }: EndRun): Cut | undefined {
  if (Math.abs(dy) < Math.abs(dx)) return undefined;
  return dy > 0 ? "down" : "up";
}

/**
 * The way the stroke runs out through its end at `at` in `points`, stepping
 * by `step` from it along the stroke: measured from the first point at least
 * `reach` units from it, or else the farthest. Undefined if every point is
 * the end's own.
 */
function endRun(
  points: readonly number[],
  at: number,
  step: number,
  reach: number,
): EndRun | undefined {
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
    if (distance >= reach) return runTo(points, at, index);
    if (distance > most) {
      most = distance;
      farthest = index;
    }
  }
  return farthest === undefined ? undefined : runTo(points, at, farthest);
}

/**
 * Where a stroke is cut flat, for its `x, y` points in units: each end named
 * in `ends`, which lies on a grid point, along the row through it, on the side
 * away from the stroke, if it crosses that row at 45° or steeper. The way the
 * stroke runs at an end comes from the nearest point at least `reach` units
 * from it, or the farthest one; a stroke that never leaves its end, as a dot,
 * is not cut there.
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
  const startRun = ends.start
    ? (endRun(from, 0, 2, reach) ?? endRun(points, 0, 2, reach))
    : undefined;
  const lastRun = ends.end
    ? (endRun(to, to.length - 2, -2, reach) ?? endRun(points, last, -2, reach))
    : undefined;
  const start = startRun === undefined ? undefined : cutOf(startRun);
  const end = lastRun === undefined ? undefined : cutOf(lastRun);
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
 * Whether `stroke` is the fill of a filled shape whose sides `next` draws:
 * a stroke of the same tool through the very same points, as a filled
 * ellipse or closed polygon is recorded.
 */
function filledInside(stroke: Stroke, next: Stroke | undefined): boolean {
  if (stroke.kind !== "fill" || next === undefined || next.kind === "fill") {
    return false;
  }
  const { points } = stroke;
  return (
    next.tool === stroke.tool &&
    next.points.length === points.length &&
    points.every((value, index) => value === next.points[index])
  );
}

/**
 * A best guess at where a document's grid columns pass, `columns` pixels
 * apart, in pixels within one spacing, from where its strokes start and end;
 * `fallback` for a document with no strokes. Each stroke's start and end,
 * erasers' too, mark the place within a spacing where they lie, a one-point
 * stroke's once, and a filled shape's on its sides alone, so that it counts
 * as the same shape unfilled does. An eraser's area drawn freehand starts and
 * ends at its way's end, and marks that place twice, as a stroke that started
 * and ended there would. The place marked most often wins; of places marked
 * equally often, the one that reached that count first in stroke order does,
 * so with no place marked twice, it is where the first stroke starts.
 *
 * Ends that Shift put on the grid lie on its columns, and a save moves the
 * drawing by whole pixels, so a drawing made on the grid lines up with it
 * again, however a save cropped it. They lie on the rows of `grid` too, or
 * of its finer grid, where Zoom may have put them, which a freehand end almost
 * never does. So only such ends mark places, and a drawing with none has all
 * its ends mark them: freehand ends would otherwise outvote a few on the grid
 * by chance.
 */
export function gridOriginOf(
  document: InkDocument,
  fallback = 0,
  columns = plainGrid.spacing,
  grid: Grid = plainGrid,
): number {
  const spacing = Math.round(columns * unitsPerPixel);
  const { rows } = grid.period === undefined ? finerGrid(grid) : grid;
  const onRows = new Set(rows.map(toUnits));
  const ends: { readonly x: number; readonly y: number }[] = [];
  const { strokes } = document;
  for (const [index, stroke] of strokes.entries()) {
    if (filledInside(stroke, strokes[index + 1])) continue;
    const { points } = stroke;
    const last = points.length - 2;
    for (const at of last > 0 ? [0, last] : [0]) {
      const x = points[at];
      const y = points[at + 1];
      if (x !== undefined && y !== undefined) ends.push({ x, y });
    }
  }
  const placed = ends.filter(({ y }) => onRows.has(y));
  const counts = new Map<number, number>();
  let origin: number | undefined;
  let most = 0;
  for (const { x } of placed.length > 0 ? placed : ends) {
    const phase = ((x % spacing) + spacing) % spacing;
    const count = (counts.get(phase) ?? 0) + 1;
    counts.set(phase, count);
    if (count > most) {
      most = count;
      origin = phase;
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
  /** Whether its ends are cut flat where Shift put them on the grid. */
  readonly flat: boolean;
  /** Whether Shift started it on the grid, so that its start is cut flat. */
  readonly onGrid: boolean;
  /** Whether it is a polygon, whose points are the corners placed so far. */
  readonly polygon: boolean;
  /**
   * For a path, its points and handles as they are placed; its points here
   * stay empty, as its stroke is made from the curve through them.
   */
  readonly path: PathPlacer | undefined;
  /**
   * Whether it is an eraser's stroke drawn as the pointer goes, started
   * without Flat ends and the grid both on, which takes away exactly what its
   * brush sweeps, and is saved as that area, never cut. One started with both
   * on is a smooth stroke, as in 1.0.1, which they can cut.
   */
  readonly sweep: boolean;
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
 * ellipse across the box dragged, a polygon with a corner at each click, or a
 * path, a curve placed by its points.
 */
export type Shape = "free" | "ellipse" | "polygon" | "path";

/**
 * How far apart the points along a path's curve are saved, at most, in
 * document pixels: as an ellipse's are, close enough that the smoothing of
 * {@link Stroke}s without a kind keeps to the curve.
 */
export const curveSpacing = maxGap / 2;

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
   * a straight segment as where the pointer is at its end now. Empty for an
   * eraser's sweep, whose ends are not cut.
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
   * Whether the pointer has moved since the press: an eraser's sweep that has
   * not is the brush's circle at the point the press placed, however Shift
   * and the grid change before it does.
   */
  #left = false;
  /**
   * Whether Shift was down at the last press or move, which decides whether
   * the point that reported goes on the grid while the grid is on. Each
   * pointer event says for itself, so nothing can be left stuck down.
   */
  #shift = false;
  /**
   * Whether Shift is down now, as the last pointer event or {@link holdShift}
   * said, which decides with {@link #shift} how the stroke being drawn ends.
   */
  #shiftNow = false;
  /**
   * Where the pointer last was for the stroke being drawn, before it went to
   * the grid: where it was pressed, last moved to, or let go.
   */
  #at: InputPoint | undefined;
  /**
   * Where the pointer is for the polygon being placed, before snapping: its
   * next corner goes there, or with Shift to the grid point nearest it.
   */
  #next: InputPoint | undefined;
  /** Whether the press that started the polygon being placed is still down. */
  #starting = false;
  /**
   * Whether Shift put each corner of the polygon being placed on the grid, for
   * clicks on it.
   */
  #snaps: boolean[] = [];
  /**
   * The polygon or path that {@link drop} dropped, with its corners' snaps,
   * for {@link undo} to bring back, until anything else is drawn, the
   * drawing or its history changes, or another shape is chosen.
   */
  #dropped:
    | { readonly active: ActiveStroke; readonly snaps: readonly boolean[] }
    | undefined;
  tool: Tool = "pen";
  #shape: Shape = "free";
  /**
   * Whether an ellipse, or a polygon closed on its first corner, is drawn
   * filled, as it is drawn and placed: its line at the brush's width, as
   * without fill, and everything inside it.
   */
  fill = false;
  /** Each tool keeps its own selected size for the life of the session. */
  readonly sizes: Record<Tool, number> = { pen: 1, eraser: 1 };

  /** What dragging draws, with the pen or the eraser. */
  get shape(): Shape {
    return this.#shape;
  }

  /**
   * Chooses what dragging draws. Another shape forgets one that {@link drop}
   * dropped, as {@link undo} would otherwise bring back a shape not chosen.
   */
  set shape(shape: Shape) {
    if (shape !== this.#shape) this.#dropped = undefined;
    this.#shape = shape;
  }

  get sizeIndex(): number {
    return this.sizes[this.tool];
  }

  set sizeIndex(index: number) {
    this.sizes[this.tool] = index;
  }
  /**
   * How near a press must be to the mark of a path's point, other than its
   * first or last, or of a handle's end, to take hold of it, in document
   * pixels: about as near as the mark is drawn, which the editor sets as the
   * drawing area's scale changes, since the marks keep their size on the
   * screen.
   */
  markReach = cornerReachMin;
  /**
   * Whether the grid is on: a guide, which points go to only with Shift down.
   * With it, Shift puts a point on the grid rather than making a circle.
   */
  snap = false;
  /**
   * Whether strokes drawn as the pointer goes from now on stop flush with the
   * row through an end that Shift put on the grid, rather than rounding past
   * it. Shapes never do: an ellipse has no ends, and a polygon keeps its
   * square ones.
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
    | {
        document: InkDocument;
        spacing: number;
        readonly rows: readonly number[];
        origin: number;
      }
    | undefined;

  constructor(initial: InkDocument) {
    this.#history = new History({ document: initial, gridOrigin: undefined });
    this.#saved = initial;
  }

  /** The grid that Shift snaps to, which the editor lays out on its font. */
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
    const { grid } = this;
    const guessed = this.#guessed;
    // The editor lays out an equal grid afresh for every frame it renders.
    if (
      guessed?.document === document &&
      guessed.spacing === period &&
      guessed.rows.length === grid.rows.length &&
      guessed.rows.every((row, index) => row === grid.rows[index])
    ) {
      return guessed.origin;
    }
    const origin = gridOriginOf(document, 0, period, grid);
    this.#guessed = { document, spacing: period, rows: grid.rows, origin };
    return origin;
  }

  #snapped(point: InputPoint): InputPoint {
    return this.snap ? snapToGrid(point, this.grid, this.gridOrigin) : point;
  }

  /** Where `point` goes: on the grid with Shift down, and else where it is. */
  #placed(point: InputPoint): InputPoint {
    return this.#shift ? this.#snapped(point) : point;
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
    return (
      this.#active === undefined &&
      (this.#dropped !== undefined || this.#history.canUndo)
    );
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

  /**
   * Whether a polygon or a path is being placed, a point at a time, a path
   * that has ended and waits to be made ink too.
   */
  get placing(): boolean {
    return this.#active?.polygon === true || this.placingPath;
  }

  /** Whether a path is being placed, or has ended and waits to be made ink. */
  get placingPath(): boolean {
    return this.#active?.path !== undefined;
  }

  /**
   * Where a path stands before it is made ink, as {@link PathState} says, or
   * undefined while there is none.
   */
  get pathState(): PathState | undefined {
    return this.#active?.path?.state;
  }

  /**
   * Whether a path has ended or closed, and waits for its points and handles
   * to be adjusted until it is made ink.
   */
  get adjustingPath(): boolean {
    const state = this.pathState;
    return state !== undefined && state !== "placing";
  }

  /**
   * The points and handles of a path being placed or adjusted, and what a
   * press would take hold of, for the drawing area to show; undefined for
   * anything else.
   */
  get pathMarks(): PathMarks | undefined {
    return this.#active?.path?.marks;
  }

  /** The captured brush diameter, without copying the active stroke's points. */
  get activeSize(): number | undefined {
    return this.#active?.size;
  }

  /**
   * A polygon or a path being placed, or a path waiting to be made ink, as
   * the ink it would be now: just what {@link end} commits without a release,
   * as when saving, with the points it has, open, or closed if it closed. So
   * a draft keeps it as a finished stroke is kept. None while there is none,
   * and for a stroke being dragged, which the pointer has yet to finish.
   */
  get placedStrokes(): readonly Stroke[] {
    const active = this.#active;
    return active === undefined ? [] : this.#placedInk(active);
  }

  /**
   * What `active` commits when it ends without a release, if it is a polygon
   * or a path being placed: the corners or points it has, open, or closed for
   * a path that closed. None for anything else.
   */
  #placedInk(active: ActiveStroke): Stroke[] {
    if (active.polygon) return this.#strokes(active, uncut, false);
    const { path } = active;
    if (path === undefined) return [];
    return this.#pathStrokes(active, path.nodes, path.state === "closed");
  }

  /**
   * The strokes being drawn, as they would be committed now: one, or a
   * filled shape's two. None while nothing is being drawn. A stroke is cut at
   * its start if that is on the grid, and its end comes to the grid only as
   * it is let go; but an eraser's sweep is just what {@link end} commits,
   * with the pointer where it is and Shift as the editor last knew it. A
   * polygon or a path being placed is shown as a click where the pointer is
   * would leave it, and a path that has ended as it is.
   */
  get activeStrokes(): readonly Stroke[] {
    const active = this.#active;
    if (active === undefined) return [];
    if (active.path !== undefined) {
      const { nodes, closed } = active.path.shown;
      return this.#pathStrokes(active, nodes, closed);
    }
    const next = this.#next;
    if (!active.polygon || next === undefined) {
      if (active.sweep) {
        return this.#ending(active, this.#at, this.#shiftNow);
      }
      return this.#strokes(
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
      return this.#strokes(closed, uncut, this.fill);
    }
    if (this.#near(active, next, active.points.length - 2)) {
      return [this.#stroke(active, uncut)];
    }
    const shown = { ...active, points: [...active.points] };
    this.#record(shown, this.#placed(next));
    return [this.#stroke(shown, uncut)];
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
    const way = [...this.#pointer];
    if (release === undefined) return way;
    const x = toUnits(release.x);
    const y = toUnits(release.y);
    // A release where the pointer last was adds nothing to measure.
    if (way.at(-2) !== x || way.at(-1) !== y) way.push(x, y);
    return way;
  }

  /**
   * The strokes that ending `active` now would commit, let go at `release`
   * if that is known, with Shift down now as `now` says: made afresh without
   * changing anything, for {@link end} to push and an eraser's preview to
   * show. They follow from these alone:
   *
   * - the points drawn so far, the straight segment Shift is drawing, and
   *   the way the pointer went, which measures a cut end;
   * - `release`, and the last point the pointer moved to;
   * - Shift, held if it was down at the pointer's last event or `now` says it
   *   is down;
   * - the grid: whether it is on, and the grid point it puts the end on, from
   *   a grid that one laid out while drawing replaces only at the end;
   * - Flat ends, and whether the start is on the grid, as the stroke began;
   * - for an ellipse, its first corner, whether Shift made it a circle, and
   *   Fill.
   *
   * With Shift held on the grid, the end goes to the grid point nearest the
   * release, or where it was last shown if Shift is up now, as a hand
   * letting go of the key an instant before the button should not knock it
   * off the grid, or without a release to the grid point nearest the last
   * point; a straight segment runs to it, and the end is cut with Flat ends.
   * Otherwise it goes to the release. As in 1.0.1, which made them by
   * drawing the end on.
   */
  #ending(
    active: ActiveStroke,
    release: InputPoint | undefined,
    now: boolean,
  ): Stroke[] {
    if (active.points.length === 0) return [];
    const held = this.#shift || now;
    const remembered = held && !now && this.snap;
    const onGrid = held && this.snap;
    const corner = this.#corner;
    const anchor = this.#anchor;
    const straight = corner === undefined ? anchor !== undefined : this.#circle;
    const shown = remembered ? this.#last : undefined;
    const end = shown ?? (onGrid ? (release ?? this.#last) : release);
    const ended = { ...active, points: [...active.points] };
    // A sweep is the circle where the press put it until the pointer moves.
    const still = active.sweep && !this.#left;
    if (end !== undefined && !still) {
      const placed = onGrid ? this.#snapped(end) : end;
      if (corner !== undefined) {
        ended.points.length = 0;
        for (const point of ellipsePoints(
          corner,
          placed,
          straight && !this.snap,
        )) {
          this.#record(ended, point);
        }
      } else if (anchor === undefined) {
        this.#append(ended, this.#last, placed);
      } else {
        // The straight segment runs again from its start to the end.
        ended.points.length = anchor.length;
        this.#append(ended, anchor.point, this.#snapped(placed));
      }
    }
    // The start goes by the way the pointer went, and so does the end, but
    // for a straight segment, which runs as it does right to its end. A
    // sweep's ends are not cut.
    const pointer =
      active.sweep || (this.#straightStart && straight)
        ? undefined
        : this.#path(straight ? undefined : release);
    return this.#strokes(
      ended,
      { start: active.onGrid, end: onGrid && active.flat },
      corner !== undefined && this.fill,
      {
        start: this.#straightStart ? undefined : pointer,
        end: straight ? undefined : pointer,
      },
    );
  }

  /**
   * What `active` leaves, as {@link #stroke} makes it, with `fill`, if it has
   * three points to enclose any, filled inside: the fill and then the line
   * round it, which keeps the brush's width, so that a filled shape has the
   * outer edge of the same shape unfilled. They are a single step of Undo.
   */
  #strokes(
    active: ActiveStroke,
    ends: { readonly start: boolean; readonly end: boolean },
    fill: boolean,
    paths?: {
      readonly start?: readonly number[] | undefined;
      readonly end?: readonly number[] | undefined;
    },
  ): Stroke[] {
    const line = this.#stroke(active, ends, paths);
    if (!fill || active.points.length < 6) return [line];
    const { tool } = active;
    return [{ tool, points: [...active.points], kind: "fill" }, line];
  }

  /**
   * What a path through `nodes` leaves, `closed` or not, as {@link #strokes}
   * makes it: a stroke without a kind, as an ellipse is, through points along
   * the curve, so that it draws as the pen would along it, with round ends.
   * Closed, it is filled with Fill on; open, its ends that Shift put on the
   * grid are cut with Flat ends and the grid on, as a freehand stroke's are.
   */
  #pathStrokes(
    active: ActiveStroke,
    nodes: readonly PathNode[],
    closed: boolean,
  ): Stroke[] {
    if (nodes.length === 0) return [];
    const curve: ActiveStroke = { ...active, points: [], path: undefined };
    for (const point of pathPoints(nodes, closed, curveSpacing)) {
      this.#record(curve, point);
    }
    const flat = this.flatEnds && this.snap && !closed;
    const ends = {
      start: flat && nodes[0]?.onGrid === true,
      end: flat && nodes.at(-1)?.onGrid === true,
    };
    return this.#strokes(curve, ends, closed && this.fill);
  }

  /** Where the pointer is, for a path: on the grid with Shift held. */
  #pathPointer(point: InputPoint): PathPointer {
    return {
      at: point,
      placed: this.#placed(point),
      onGrid: this.#shift && this.snap,
    };
  }

  /**
   * How near a release must be to a polygon's first or last corner to close
   * or end it there, in document pixels: within the brush's circle, or
   * {@link cornerReachMin} for a smaller brush. A press on a path's first or
   * last point is as near.
   */
  #cornerReach(active: ActiveStroke): number {
    return Math.max(active.size / unitsPerPixel / 2, cornerReachMin);
  }

  /**
   * How near a press must be to a point or handle of the path being placed
   * to take hold of it, as {@link PathReach} says: to the first and last
   * points, as to a polygon's; to the others, and to the handles' ends, as
   * {@link markReach} says.
   */
  #reach(active: ActiveStroke): PathReach {
    return { ends: this.#cornerReach(active), marks: this.markReach };
  }

  /**
   * `active` as a stroke, cut flat at the ends named, which are on the grid.
   * The way a cut end runs is measured over at least a cell of the grid and
   * twice the brush's width, so that the small turns near an end that a hand
   * makes, and the jump to a grid point at its start, don't decide it;
   * `paths` are the ways each end is measured along, as for {@link gridCuts}.
   * An eraser's sweep is the area its brush swept, as {@link sweptStroke}
   * makes it, and never cut.
   */
  #stroke(
    active: ActiveStroke,
    ends: { readonly start: boolean; readonly end: boolean },
    paths: {
      readonly start?: readonly number[] | undefined;
      readonly end?: readonly number[] | undefined;
    } = {},
  ): Stroke {
    const { tool, size } = active;
    if (active.polygon) {
      return { tool, size, points: [...active.points], kind: "polygon" };
    }
    if (active.sweep) return sweptStroke(tool, size, active.points);
    const reach = Math.max(2 * active.size, toUnits(this.grid.spacing));
    const cut = gridCuts(active.points, reach, ends, {
      ...(paths.start === undefined ? {} : { start: paths.start }),
      ...(paths.end === undefined ? {} : { end: paths.end }),
    });
    const stroke = { tool, size, points: [...active.points] };
    return cut === undefined ? stroke : { ...stroke, cut };
  }

  /**
   * Starts a stroke with the current brush, an ellipse with one corner of its
   * box here, a polygon with its first corner here, or a path with its first
   * point here, on the grid if `shift` says Shift is down. An ellipse is a
   * closed loop, with no ends to cut. While a polygon is being placed, a press
   * only moves where its next corner would go, which its release places;
   * while a path is, a press takes hold of a point or a handle's end, or
   * places a point, as {@link PathPlacer} says. Returns whether the press
   * does anything: not for one that takes hold of nothing on a path that has
   * ended and waits to be made ink.
   */
  begin(point: InputPoint, shift = false): boolean {
    this.#shiftNow = shift;
    const placing = this.#active;
    if (placing?.polygon === true) {
      this.#next = point;
      this.#shift = shift;
      return true;
    }
    if (placing?.path !== undefined) {
      this.#next = point;
      this.#shift = shift;
      return placing.path.press(this.#pathPointer(point), this.#reach(placing));
    }
    // Something else is drawn now, which a shape that Esc dropped would not
    // come back over.
    this.#dropped = undefined;
    if (this.shape === "path") {
      this.#beginPath(point, shift);
      return true;
    }
    const ellipse = this.shape === "ellipse";
    const polygon = this.shape === "polygon";
    const flat = this.flatEnds && this.shape === "free";
    const onGrid = this.snap && shift;
    this.#shift = shift;
    const start = this.#placed(point);
    this.#active = {
      tool: this.tool,
      size: this.size,
      points: [],
      flat,
      onGrid: onGrid && flat,
      polygon,
      path: undefined,
      sweep:
        this.tool === "eraser" &&
        this.shape === "free" &&
        !(this.flatEnds && this.snap),
    };
    this.#last = undefined;
    this.#anchor = undefined;
    this.#corner = ellipse ? start : undefined;
    this.#circle = false;
    this.#starting = polygon;
    this.#snaps = polygon ? [onGrid] : [];
    // No place yet, so that the stroke's first point is never taken for a
    // report at the place the pointer already was.
    this.#at = undefined;
    this.extend([start]);
    this.#shift = shift;
    this.#shiftNow = shift;
    this.#left = false;
    // After the grid point the stroke starts on, which the pointer never was.
    this.#pointer = this.#active.sweep
      ? []
      : [toUnits(point.x), toUnits(point.y)];
    this.#at = point;
    this.#pointerStraight = false;
    this.#straightStart = false;
    if (polygon) this.#record(this.#active, start);
    return true;
  }

  /**
   * Starts a path with its first point at a press here, with the current
   * brush, which it takes again as the brush changes while it is placed.
   */
  #beginPath(point: InputPoint, shift: boolean): void {
    this.#shift = shift;
    this.#next = point;
    this.#last = undefined;
    this.#anchor = undefined;
    this.#corner = undefined;
    this.#pointer = [];
    this.#at = point;
    const active: ActiveStroke = {
      tool: this.tool,
      size: this.size,
      points: [],
      flat: false,
      onGrid: false,
      polygon: false,
      path: undefined,
      sweep: false,
    };
    this.#active = {
      ...active,
      path: new PathPlacer(this.#pathPointer(point), this.#reach(active)),
    };
  }

  /**
   * Adds points to the stroke being drawn, filling gaps longer than
   * {@link maxGap} and skipping exact repeats. While `shift` says Shift is
   * down, the stroke runs straight from where it was when that began to the
   * latest point, which snaps to the grid when the grid is on; what it drew
   * before stays as it is, and so does the segment once Shift is up.
   */
  extend(points: readonly InputPoint[], shift = false): void {
    const active = this.#active;
    if (active === undefined) return;
    this.#shift = shift;
    this.#shiftNow = shift;
    if (active.polygon) {
      const latest = points.at(-1);
      if (latest !== undefined) this.#next = latest;
      return;
    }
    if (active.path !== undefined) {
      const latest = points.at(-1);
      if (latest === undefined) return;
      this.#next = latest;
      active.path.move(this.#pathPointer(latest), this.#reach(active));
      return;
    }
    const corner = this.#corner;
    if (corner !== undefined) {
      // An ellipse is drawn again across its box for its latest corner. Shift
      // puts that corner on the grid, or with the grid off makes a circle.
      const latest = points.at(-1);
      if (latest === undefined) return;
      this.#circle = shift && !this.snap;
      active.points.length = 0;
      for (const point of ellipsePoints(
        corner,
        this.#placed(latest),
        this.#circle,
      )) {
        this.#record(active, point);
      }
      this.#last = latest;
      this.#at = latest;
      return;
    }
    // The way the pointer went measures cut ends, which a sweep has none of.
    const measured = !active.sweep;
    for (const point of points) {
      // Until the pointer first moves, a sweep is its tap's circle: a report
      // at the very place it was, as a browser can send, is not a move.
      if (
        active.sweep &&
        !this.#left &&
        point.x === this.#at?.x &&
        point.y === this.#at.y
      ) {
        continue;
      }
      this.#at = point;
      this.#left = true;
      if (!shift) {
        this.#anchor = undefined;
        if (measured) this.#pointer.push(toUnits(point.x), toUnits(point.y));
        this.#pointerStraight = false;
        this.#append(active, this.#last, point);
        this.#last = point;
        continue;
      }
      if (measured) {
        if (this.#pointer.length <= 2) this.#straightStart = true;
        if (this.#pointerStraight) this.#pointer.length -= 2;
        this.#pointer.push(toUnits(point.x), toUnits(point.y));
      }
      this.#pointerStraight = true;
      const anchor = (this.#anchor ??= {
        point: this.#last ?? point,
        length: active.points.length,
      });
      // The segment is drawn again from its start for each new point.
      active.points.length = anchor.length;
      const end = this.#snapped(point);
      this.#append(active, anchor.point, end);
      this.#last = end;
    }
  }

  /**
   * Takes the pointer as having moved to `point`, with Shift as last known,
   * as when the drawing moves under a pointer that stays still: as
   * {@link extend} does for a move there.
   */
  follow(point: InputPoint): void {
    this.extend([point], this.#shiftNow);
  }

  /**
   * Records a point among `active`'s, and points along the gap to it from
   * `previous`, the last point recorded before rounding, if there is one,
   * but for an eraser's sweep, which a straight line between them draws
   * exactly.
   */
  #append(
    active: ActiveStroke,
    previous: InputPoint | undefined,
    point: InputPoint,
  ): void {
    if (previous !== undefined && !active.sweep) {
      const gap = Math.hypot(point.x - previous.x, point.y - previous.y);
      const steps = Math.ceil(gap / maxGap);
      for (let step = 1; step < steps; step++) {
        this.#record(active, between(previous, point, step / steps));
      }
    }
    this.#record(active, point);
  }

  /** Records a point among `active`'s, but not where the last one is. */
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
   * Commits the stroke being drawn, or a filled shape's two, as one undoable
   * step, ending it at `release`, where the pointer was let go, when that is
   * known. A polygon being placed takes a release as a corner, and commits
   * only when that closes or ends it; without a release, it commits with the
   * corners it has, as when saving. A path takes a release as its point, its
   * move, or its ending or closing, as {@link PathPlacer} says, and so never
   * commits at a release; without one, it commits with the points it has,
   * open, or closed if it closed, whether it is being placed or adjusted.
   *
   * Shift counts as held for the release if `shift` says it is down, or if it
   * was at the last press or move: with no move since, what is drawn is what
   * Shift drew, and a hand letting go of the key an instant before the button
   * should not knock it off the grid, so on the grid it ends where it was last
   * shown, a polygon's corner too. A move without Shift ends that, so a stroke
   * carried on past a Shift let go ends where the pointer does.
   *
   * A stroke dragged commits just what {@link #ending} makes, as 1.0.1's
   * did. An eraser's sweep commits just what it shows: a release where the
   * pointer moved counts as its last move, and Shift is as the editor last
   * knew it, from the pointer and the keys, whatever the release says, so
   * that a key it missed can change nothing it showed.
   */
  end(release?: InputPoint, shift?: boolean): void {
    const placed = this.#active;
    if (placed?.polygon === true) {
      const now = shift ?? false;
      this.#shift ||= now;
      const remembered = this.#shift && !now && this.snap;
      if (release === undefined) {
        this.#commit(this.#placedInk(placed));
      } else {
        this.#place(placed, remembered ? (this.#next ?? release) : release);
      }
      return;
    }
    const path = placed?.path;
    if (placed !== undefined && path !== undefined) {
      if (release === undefined) {
        this.#commit(this.#placedInk(placed));
        return;
      }
      const now = shift ?? false;
      this.#shift ||= now;
      // Shift let go an instant before the button leaves the point or the
      // handle's end on the grid where it was last shown.
      const remembered = this.#shift && !now && this.snap;
      const at = remembered ? (this.#next ?? release) : release;
      this.#next = at;
      path.release(this.#pathPointer(at), this.#reach(placed));
      return;
    }
    if (placed?.sweep === true && release !== undefined) {
      // As the point itself, which the grid places, not as it is saved.
      const at = this.#at;
      const moved = at?.x !== release.x || at.y !== release.y;
      if (moved) this.extend([release], this.#shiftNow);
    }
    const strokes =
      placed === undefined
        ? []
        : placed.sweep
          ? this.#ending(placed, this.#at, this.#shiftNow)
          : this.#ending(placed, release, shift ?? false);
    this.#active = undefined;
    this.#at = undefined;
    this.#anchor = undefined;
    this.#corner = undefined;
    this.#next = undefined;
    this.#starting = false;
    if (strokes.length > 0) {
      // On the grid it was drawn on, which a waiting one then replaces.
      this.#push({
        ...this.document,
        strokes: [...this.document.strokes, ...strokes],
      });
    }
    this.#takeNextGrid();
  }

  /**
   * Ends a path being placed where it is, open, as Enter does: it then waits
   * for its points and handles to be adjusted until {@link end} makes it ink.
   * Returns whether there was one being placed.
   */
  endPath(): boolean {
    const path = this.#active?.path;
    if (path?.state !== "placing") return false;
    path.end();
    return true;
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
      this.#commit(this.#strokes(active, uncut, this.fill));
      return;
    }
    const count = active.points.length;
    if (this.#near(active, release, count - 2)) {
      if (!starting) this.#commit(this.#strokes(active, uncut, false));
      return;
    }
    this.#record(active, this.#placed(release));
    if (active.points.length > count) {
      this.#snaps.push(this.#shift && this.snap);
    }
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
   * points: snapping to that point, with Shift down, for a corner that Shift
   * put on the grid while the grid is on, or else within the brush's radius of
   * it.
   */
  #near(active: ActiveStroke, pointer: InputPoint, index: number): boolean {
    const x = active.points[index];
    const y = active.points[index + 1];
    if (x === undefined || y === undefined) return false;
    if (this.#shift && this.snap && this.#snaps[index / 2] === true) {
      const at = this.#snapped(pointer);
      return toUnits(at.x) === x && toUnits(at.y) === y;
    }
    return (
      Math.hypot(
        pointer.x - x / unitsPerPixel,
        pointer.y - y / unitsPerPixel,
      ) <= this.#cornerReach(active)
    );
  }

  /** Commits a polygon or a path being placed as one undoable step. */
  #commit(strokes: readonly Stroke[]): void {
    this.#active = undefined;
    this.#next = undefined;
    this.#starting = false;
    this.#snaps = [];
    this.#push({
      ...this.document,
      strokes: [...this.document.strokes, ...strokes],
    });
    this.#takeNextGrid();
  }

  /**
   * Gives a polygon or a path being placed, or a path being adjusted, the
   * tool and brush size chosen now, as when they change meanwhile; a stroke
   * being dragged keeps its own.
   */
  rebrush(): void {
    const active = this.#active;
    if (active === undefined || !this.placing) return;
    this.#active = { ...active, tool: this.tool, size: this.size };
  }

  /**
   * Takes back the last corner of the polygon being placed, and the polygon
   * with its first; or the last step of the path being placed or adjusted,
   * a point placed, a drag, or its ending or closing, or the press being held
   * on it, and the path with its first point. Returns whether there was one.
   */
  undoCorner(): boolean {
    const active = this.#active;
    if (active?.path !== undefined) {
      if (!active.path.undo()) this.cancel();
      return true;
    }
    if (active?.polygon !== true) return false;
    active.points.length -= 2;
    this.#snaps.pop();
    if (active.points.length === 0) this.cancel();
    return true;
  }

  /**
   * Drops a polygon or a path being placed, or a path waiting to be made ink,
   * as Esc does, keeping it for {@link undo} to bring back as it was, until
   * anything else is drawn or changed. A press being held on a path is let go
   * as it shows first, as Enter lets go of one. Returns whether there was one.
   */
  drop(): boolean {
    const active = this.#active;
    if (active === undefined || !this.placing) return false;
    active.path?.letGoAsShown();
    const snaps = this.#snaps;
    this.cancel();
    this.#dropped = { active, snaps };
    return true;
  }

  /**
   * Takes back what the press being held did, as when the pointer is
   * cancelled: a stroke being dragged goes, but a polygon or a path being
   * placed keeps everything placed and adjusted before the press, and loses
   * only a point it placed or what it moved, as Undo would take back, so that
   * nothing goes that the person did not ask to drop. A polygon's first press
   * is all of it, and so is a path's.
   */
  cancelPress(): void {
    const active = this.#active;
    const path = active?.path;
    if (path !== undefined) {
      if (path.held && !path.undo()) this.cancel();
      return;
    }
    if (active?.polygon === true && !this.#starting) return;
    this.cancel();
  }

  /** Drops the stroke being drawn, as when the pointer is cancelled. */
  cancel(): void {
    this.#active = undefined;
    this.#at = undefined;
    this.#anchor = undefined;
    this.#corner = undefined;
    this.#next = undefined;
    this.#starting = false;
    this.#snaps = [];
    this.#takeNextGrid();
  }

  /**
   * Takes Shift as pressed or let go, with the pointer still, as a key event
   * says, for how an eraser's stroke being drawn would end. Returns whether
   * that can change what it shows.
   */
  holdShift(down: boolean): boolean {
    const changed = down !== this.#shiftNow;
    this.#shiftNow = down;
    return changed && this.#active?.sweep === true;
  }

  /**
   * Takes back the last change, while nothing is being drawn: first a shape
   * that {@link drop} dropped, which comes back as it was, with the tool and
   * size chosen now, as a shape being placed takes them; else the last step
   * of the history. Returns whether there was one.
   */
  undo(): boolean {
    this.#moved = undefined;
    if (this.#active !== undefined) return false;
    const dropped = this.#dropped;
    if (dropped === undefined) return this.#history.undo();
    this.#dropped = undefined;
    this.#active = { ...dropped.active, tool: this.tool, size: this.size };
    this.#snaps = [...dropped.snaps];
    // Where the pointer is goes back to it at its next move.
    this.#next = undefined;
    return true;
  }

  redo(): boolean {
    this.#moved = undefined;
    if (this.#active !== undefined) return false;
    const redone = this.#history.redo();
    if (redone) this.#dropped = undefined;
    return redone;
  }

  /**
   * Removes every stroke and the base layer, as one undoable step, and drops
   * a polygon or a path being placed, or a path being adjusted, and one that
   * {@link drop} dropped. A stroke being dragged keeps everything.
   */
  clear(): void {
    if (this.placing) this.cancel();
    if (this.#active !== undefined) return;
    this.#dropped = undefined;
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
    this.#dropped = undefined;
    return true;
  }

  /**
   * Replaces the document as one undoable step, as when restoring a draft,
   * with the grid's columns through `gridOrigin`, or by default where the
   * document's strokes suggest. Undoing the step puts the grid back too.
   */
  replace(
    document: InkDocument,
    gridOrigin = gridOriginOf(
      document,
      this.gridOrigin,
      this.#period,
      this.grid,
    ),
  ): void {
    if (this.#active !== undefined) return;
    this.#moved = undefined;
    this.#dropped = undefined;
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
    const { grid } = this;
    this.#history.map(({ document, gridOrigin }) => ({
      document: move(document),
      gridOrigin:
        (gridOrigin ?? gridOriginOf(document, 0, period, grid)) + dxPixels,
    }));
    this.#saved = move(this.#saved);
    // A shape that Esc dropped comes back where it was over the drawing.
    for (const active of [this.#active, this.#dropped?.active]) {
      if (active === undefined) continue;
      const dx = toUnits(dxPixels);
      for (let index = 0; index < active.points.length; index += 2) {
        active.points[index] = (active.points[index] ?? 0) + dx;
      }
      active.path?.moveAcross(dxPixels);
    }
    for (let index = 0; index < this.#pointer.length; index += 2) {
      this.#pointer[index] = (this.#pointer[index] ?? 0) + toUnits(dxPixels);
    }
    if (this.#last !== undefined) {
      this.#last = { ...this.#last, x: this.#last.x + dxPixels };
    }
    if (this.#at !== undefined) {
      this.#at = { ...this.#at, x: this.#at.x + dxPixels };
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
    this.#dropped = undefined;
    this.#history.push({ document, gridOrigin: this.gridOrigin });
  }
}
