// A drawing session: the document being edited, its undo history, the
// current brush, and the stroke being drawn. Plain state with no canvas or
// Obsidian, so that unit tests can drive it.

import type { Stroke, Tool } from "../format/record.ts";
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
  /** The stroke's diameter in em, matched to text weights at any size. */
  readonly em: number;
}

/**
 * The brush sizes, by how they look in text: at a 16 px font, 1, 2, 3, and
 * 4 px wide, from a hairline to a bold stroke.
 */
export const brushSizes: readonly BrushSize[] = [
  { label: "S", em: 1 / 16 },
  { label: "M", em: 2 / 16 },
  { label: "L", em: 3 / 16 },
  { label: "XL", em: 4 / 16 },
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
  readonly #history: History<InkDocument>;
  #saved: InkDocument;
  #active: ActiveStroke | undefined;
  /** The last input point of the stroke being drawn, before rounding. */
  #last: InputPoint | undefined;
  tool: Tool = "pen";
  sizeIndex = 1;

  constructor(initial: InkDocument) {
    this.#history = new History(initial);
    this.#saved = initial;
  }

  get document(): InkDocument {
    return this.#history.present;
  }

  /** The document as last saved, or as opened. */
  get saved(): InkDocument {
    return this.#saved;
  }

  /** The stroke size for the current brush, in units. */
  get size(): number {
    const brush = brushSizes[this.sizeIndex] ?? brushSizes[1];
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
    return this.#history.present !== this.#saved || this.#active !== undefined;
  }

  get drawing(): boolean {
    return this.#active !== undefined;
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
      size: this.size,
      pressure: point.pressure !== undefined,
      points: [],
    };
    this.#last = undefined;
    this.extend([point]);
  }

  /**
   * Adds points to the stroke being drawn, filling gaps longer than
   * {@link maxGap} and skipping exact repeats.
   */
  extend(points: readonly InputPoint[]): void {
    const active = this.#active;
    if (active === undefined) return;
    for (const point of points) {
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
  /** Commits the stroke being drawn as one undoable step. */
  end(): void {
    const stroke = this.activeStroke;
    this.#active = undefined;
    if (stroke === undefined || stroke.points.length === 0) return;
    this.#push({
      ...this.document,
      strokes: [...this.document.strokes, stroke],
    });
  }

  /** Drops the stroke being drawn, as when the pointer is cancelled. */
  cancel(): void {
    this.#active = undefined;
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

  /** Replaces the document as one undoable step, as when restoring a draft. */
  replace(document: InkDocument): void {
    if (this.#active !== undefined) return;
    this.#push(document);
  }

  /**
   * Moves everything by a whole number of pixels: every state to undo or
   * redo, the saved one, and the stroke being drawn. After a save, this puts
   * the session in the saved file's coordinates, so that what it keeps lines
   * up with the file.
   */
  rebase(dxPixels: number): void {
    if (dxPixels === 0) return;
    // States share most of their strokes; they still do once moved.
    const move = documentMover(dxPixels);
    this.#history.map(move);
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
  }

  /** Records `document` as saved, so that it is no longer dirty. */
  markSaved(document: InkDocument): void {
    this.#saved = document;
  }

  #push(document: InkDocument): void {
    this.#history.push(document);
  }
}
