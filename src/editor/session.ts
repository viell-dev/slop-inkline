// A drawing session: the document being edited, its undo history, the
// current brush, and the stroke being drawn. Plain state with no canvas or
// Obsidian, so that unit tests can drive it.

import { unitsPerPixel, type Stroke, type Tool } from "../format/record.ts";
import {
  documentMover,
  toPressure,
  toUnits,
  type InkDocument,
} from "../ink/document.ts";
import { lineBox } from "../ink/geometry.ts";
import { History } from "../ink/history.ts";

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

/** A point from an input device, in document pixels. */
export interface InputPoint {
  readonly x: number;
  readonly y: number;
  /** From 0 to 1, for devices that report pressure; otherwise undefined. */
  readonly pressure?: number;
}

/**
 * The grid's spacing, 1/8 em: 16 pixels, so that the baseline, 9 spacings
 * down, lies on it, and a line box holds 12 spacings.
 */
export const gridSpacing = lineBox.pxPerEm / 8;

/**
 * The grid point nearest `point`, with its pressure, on a grid whose
 * columns pass through `originX`; its rows pass through the line box's top.
 */
export function snapToGrid(point: InputPoint, originX = 0): InputPoint {
  const x =
    Math.round((point.x - originX) / gridSpacing) * gridSpacing + originX;
  const y = Math.round(point.y / gridSpacing) * gridSpacing;
  return point.pressure === undefined
    ? { x, y }
    : { x, y, pressure: point.pressure };
}

/** `x`, in pixels, moved by whole spacings to within the first one. */
function withinSpacing(x: number): number {
  return ((x % gridSpacing) + gridSpacing) % gridSpacing;
}

/**
 * A best guess at where a document's grid columns pass, in pixels within one
 * spacing, from where its strokes start and end; `fallback` for a document
 * with no strokes. Each stroke's start and end, erasers' too, mark the place
 * within a spacing where they lie, a one-point stroke's once. The place
 * marked most often wins; of places marked equally often, the one that
 * reached that count first in stroke order does, so with no place marked
 * twice, it is where the first stroke starts.
 *
 * Strokes drawn on the grid start and end on its columns, and a save moves
 * the drawing by whole pixels, so a drawing made on the grid lines up with it
 * again, however a save cropped it. Where freehand ends that happen to share
 * a place outnumber the ends drawn on the grid, the guess is theirs.
 */
export function gridOriginOf(document: InkDocument, fallback = 0): number {
  const spacing = gridSpacing * unitsPerPixel;
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
  /** Where the grid's columns pass, in pixels within one spacing. */
  readonly gridOrigin: number;
}

/** A stroke being drawn: its brush and its points so far, in units. */
interface ActiveStroke {
  readonly tool: Tool;
  readonly size: number;
  readonly pressure: boolean;
  readonly points: number[];
}

/** The point `along` the way from `from` to `to`, pressure included. */
function between(from: InputPoint, to: InputPoint, along: number): InputPoint {
  const x = from.x + (to.x - from.x) * along;
  const y = from.y + (to.y - from.y) * along;
  if (to.pressure === undefined) return { x, y };
  const start = from.pressure ?? to.pressure;
  return { x, y, pressure: start + (to.pressure - start) * along };
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

  constructor(initial: InkDocument) {
    this.#history = new History({
      document: initial,
      gridOrigin: gridOriginOf(initial),
    });
    this.#saved = initial;
  }

  /**
   * Where the grid's columns pass, in document pixels within one spacing. It
   * moves with the drawing when a save moves that, and with a restored one.
   */
  get gridOrigin(): number {
    return this.#history.present.gridOrigin;
  }

  #snapped(point: InputPoint): InputPoint {
    return this.snap ? snapToGrid(point, this.gridOrigin) : point;
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

  /** The nominal diameter for a tool, including a pen's eraser end. */
  sizeFor(tool: Tool): number {
    const brush = brushSizes[this.sizes[tool]] ?? brushSizes[1];
    return toUnits((brush?.em ?? 1 / 8) * lineBox.pxPerEm);
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

  /** The stroke being drawn, as it would be committed now. */
  get activeStroke(): Stroke | undefined {
    const active = this.#active;
    return active === undefined
      ? undefined
      : {
          tool: active.tool,
          size: active.size,
          pressure: active.pressure,
          points: [...active.points],
        };
  }

  /**
   * Starts a stroke with the current brush, or with `tool` when the input
   * device decides it, such as a pen's eraser end.
   */
  begin(point: InputPoint, tool: Tool = this.tool): void {
    this.#active = {
      tool,
      size: this.sizeFor(tool),
      pressure: point.pressure !== undefined,
      points: [],
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
    const stride = active.pressure ? 3 : 2;
    const values = [toUnits(point.x), toUnits(point.y)];
    if (active.pressure) values.push(toPressure(point.pressure ?? 0.5));
    const last = active.points.slice(-stride);
    if (
      last.length === stride &&
      last.every((value, i) => value === values[i])
    ) {
      return;
    }
    active.points.push(...values);
  }
  /**
   * Commits the stroke being drawn as one undoable step, ending it at
   * `release`, where the pointer was let go, when that is known. The release
   * keeps the last pressure, since a pen reports none once lifted.
   */
  end(release?: InputPoint): void {
    const straight = this.#anchor !== undefined;
    const pressure = this.#last?.pressure;
    const at =
      release === undefined
        ? undefined
        : pressure === undefined
          ? { x: release.x, y: release.y }
          : { x: release.x, y: release.y, pressure };
    // With the grid, the stroke ends on it, at the grid point nearest the
    // release, or else the last point, recorded in the release's place.
    const end = this.snap ? (at ?? this.#last) : at;
    if (end !== undefined && this.#active !== undefined) {
      this.extend([this.#snapped(end)], straight);
    }
    const stroke = this.activeStroke;
    this.#active = undefined;
    this.#anchor = undefined;
    if (stroke === undefined || stroke.points.length === 0) return;
    this.#push({
      ...this.document,
      strokes: [...this.document.strokes, stroke],
    });
  }

  /** Drops the stroke being drawn, as when the pointer is cancelled. */
  cancel(): void {
    this.#active = undefined;
    this.#anchor = undefined;
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
    gridOrigin = gridOriginOf(document, this.gridOrigin),
  ): void {
    if (this.#active !== undefined) return;
    this.#history.push({ document, gridOrigin: withinSpacing(gridOrigin) });
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
    // moves with each, so that it stays where each was drawn on it.
    const move = documentMover(dxPixels);
    this.#history.map(({ document, gridOrigin }) => ({
      document: move(document),
      gridOrigin: withinSpacing(gridOrigin + dxPixels),
    }));
    this.#saved = move(this.#saved);
    const active = this.#active;
    if (active !== undefined) {
      const stride = active.pressure ? 3 : 2;
      const dx = toUnits(dxPixels);
      for (let index = 0; index < active.points.length; index += stride) {
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
