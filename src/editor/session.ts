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
import { documentMover, toUnits, type InkDocument } from "../ink/document.ts";
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
 * Where a stroke drawn on the grid is cut flat, for its `x, y` points in
 * units: each end named in `ends`, which lies on a grid point, along the grid
 * line that crosses the stroke most squarely there, on the side away from
 * the stroke. The way the stroke runs at an end comes from the nearest point
 * at least `reach` units from it, or the farthest one; a stroke that never
 * leaves its end, as a dot, is not cut there.
 */
export function gridCuts(
  points: readonly number[],
  reach: number,
  ends: { readonly start: boolean; readonly end: boolean },
): StrokeCuts | undefined {
  const last = points.length - 2;
  if (last < 2) return undefined;
  const distance = (at: number, from: number): number =>
    Math.hypot(
      (points[at] ?? 0) - (points[from] ?? 0),
      (points[at + 1] ?? 0) - (points[from + 1] ?? 0),
    );
  /**
   * The point the way the end at `at` runs is measured from, stepping by
   * `step` from it: the first at least `reach` away, or else the farthest,
   * or undefined if every point is the end's own.
   */
  const from = (at: number, step: number): number | undefined => {
    let farthest: number | undefined;
    let most = 0;
    for (let index = at + step; index >= 0 && index <= last; index += step) {
      const away = distance(at, index);
      if (away >= reach) return index;
      if (away > most) {
        most = away;
        farthest = index;
      }
    }
    return farthest;
  };
  const after = ends.start ? from(0, 2) : undefined;
  const before = ends.end ? from(last, -2) : undefined;
  const start = after === undefined ? undefined : cutAt(points, 0, after);
  const end = before === undefined ? undefined : cutAt(points, last, before);
  if (start === undefined && end === undefined) return undefined;
  return {
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
  };
}

/**
 * The least distance, in units, that the way a stroke runs at a cut end is
 * measured over: two pixels, or the brush's width if it is wider.
 */
const cutReach = 2 * unitsPerPixel;

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
  for (const { points, pressure } of document.strokes) {
    const stride = pressure ? 3 : 2;
    const ends =
      points.length > stride
        ? [points[0], points[points.length - stride]]
        : [points[0]];
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
 * each, as new strokes carry no pressure.
 */
interface ActiveStroke {
  readonly tool: Tool;
  readonly size: number;
  readonly points: number[];
  /** Whether it started on the grid, and so is cut flat at its start. */
  readonly onGrid: boolean;
}

/** The point `along` the way from `from` to `to`. */
function between(from: InputPoint, to: InputPoint, along: number): InputPoint {
  return {
    x: from.x + (to.x - from.x) * along,
    y: from.y + (to.y - from.y) * along,
  };
}

export class DrawingSession {
  readonly #history: History<SessionState>;
  #saved: InkDocument;
  #active: ActiveStroke | undefined;
  /** The last input point of the stroke being drawn, before rounding. */
  #last: InputPoint | undefined;
  /**
   * Where a straight segment of the stroke being drawn starts, and how many
   * values of its points lead up to there, the start included.
   */
  #anchor: { point: InputPoint; length: number } | undefined;
  tool: Tool = "pen";
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
  #grid: Grid = plainGrid;
  /** A grid laid out while a stroke was being drawn, for when it ends. */
  #nextGrid: Grid | undefined;
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
   * Where the grid's columns pass, in document pixels within one spacing. It
   * moves with the drawing when a save moves that, and with a restored one.
   */
  get gridOrigin(): number {
    const { document, gridOrigin } = this.#history.present;
    const { spacing } = this.grid;
    if (gridOrigin !== undefined) return withinSpacing(gridOrigin, spacing);
    const guessed = this.#guessed;
    if (guessed?.document === document && guessed.spacing === spacing) {
      return guessed.origin;
    }
    const origin = gridOriginOf(document, 0, spacing);
    this.#guessed = { document, spacing, origin };
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

  /** The captured brush diameter, without copying the active stroke's points. */
  get activeSize(): number | undefined {
    return this.#active?.size;
  }

  /**
   * The stroke being drawn, as it would be committed now, before its end
   * comes to the grid: cut at its start if that is on the grid.
   */
  get activeStroke(): Stroke | undefined {
    const active = this.#active;
    return active === undefined
      ? undefined
      : this.#stroke(active, { start: active.onGrid, end: false });
  }

  /** `active` as a stroke, cut flat at the ends named, which are on the grid. */
  #stroke(
    active: ActiveStroke,
    ends: { readonly start: boolean; readonly end: boolean },
  ): Stroke {
    const stroke: Stroke = {
      tool: active.tool,
      size: active.size,
      pressure: false,
      points: [...active.points],
    };
    const cut = gridCuts(active.points, Math.max(active.size, cutReach), ends);
    return cut === undefined ? stroke : { ...stroke, cut };
  }

  /** Starts a stroke with the current brush. */
  begin(point: InputPoint): void {
    this.#active = {
      tool: this.tool,
      size: this.size,
      points: [],
      onGrid: this.snap,
    };
    this.#last = undefined;
    this.#anchor = undefined;
    this.extend([this.#snapped(point)]);
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
    for (const point of points) {
      if (!straight) {
        this.#anchor = undefined;
        this.#append(active, point);
        continue;
      }
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
   * `release`, where the pointer was let go, when that is known.
   */
  end(release?: InputPoint): void {
    const straight = this.#anchor !== undefined;
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
        : this.#stroke(active, { start: active.onGrid, end: this.snap });
    this.#active = undefined;
    this.#anchor = undefined;
    if (stroke !== undefined && stroke.points.length > 0) {
      // On the grid it was drawn on, which a waiting one then replaces.
      this.#push({
        ...this.document,
        strokes: [...this.document.strokes, stroke],
      });
    }
    this.#takeNextGrid();
  }

  /** Drops the stroke being drawn, as when the pointer is cancelled. */
  cancel(): void {
    this.#active = undefined;
    this.#anchor = undefined;
    this.#takeNextGrid();
  }

  undo(): boolean {
    return this.#active === undefined && this.#history.undo();
  }

  redo(): boolean {
    return this.#active === undefined && this.#history.redo();
  }

  /** Removes every stroke and the base layer, as one undoable step. */
  clear(): void {
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
   * Replaces the document as one undoable step, as when restoring a draft,
   * with the grid's columns through `gridOrigin`, or by default where the
   * document's strokes suggest. Undoing the step puts the grid back too.
   */
  replace(
    document: InkDocument,
    gridOrigin = gridOriginOf(document, this.gridOrigin, this.grid.spacing),
  ): void {
    if (this.#active !== undefined) return;
    this.#history.push({ document, gridOrigin });
  }

  /**
   * Moves everything by a whole number of pixels: every state to undo or
   * redo, the saved one, and the stroke being drawn. After a save, this puts
   * the session in the saved file's coordinates, so that what it keeps lines
   * up with the file.
   */
  rebase(dxPixels: number): void {
    if (dxPixels === 0) return;
    // States share most of their strokes; they still do once moved. The grid
    // moves with each, so that it stays where each was drawn on it, the grid
    // the strokes say too, which may have no strokes to say it after this.
    const move = documentMover(dxPixels);
    const { spacing } = this.grid;
    this.#history.map(({ document, gridOrigin }) => ({
      document: move(document),
      gridOrigin: (gridOrigin ?? gridOriginOf(document, 0, spacing)) + dxPixels,
    }));
    this.#saved = move(this.#saved);
    const active = this.#active;
    if (active !== undefined) {
      const dx = toUnits(dxPixels);
      for (let index = 0; index < active.points.length; index += 2) {
        active.points[index] = (active.points[index] ?? 0) + dx;
      }
    }
    if (this.#last !== undefined) {
      this.#last = { ...this.#last, x: this.#last.x + dxPixels };
    }
    if (this.#anchor !== undefined) {
      const { point } = this.#anchor;
      this.#anchor.point = { ...point, x: point.x + dxPixels };
    }
  }

  /** Records `document` as saved, so that it is no longer dirty. */
  markSaved(document: InkDocument): void {
    this.#saved = document;
  }

  /** Records `document` as one undoable step, keeping the grid. */
  #push(document: InkDocument): void {
    this.#history.push({ document, gridOrigin: this.gridOrigin });
  }
}
