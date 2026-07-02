import type { EditorHistory } from "./create-history";
import type { InkTool } from "./ink-tool";
import { surfaceLineWidth } from "./surface-line-width";

interface Point {
  x: number;
  y: number;
}

export interface StrokeHandlerDeps {
  canvasEl: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  history: EditorHistory;
  getTool(): InkTool;
  getBrushInlinePx(): number;
  /** Called when a stroke starts mutating the drawing. */
  onInkChanged(): void;
  /** Called when a stroke finishes, to re-detect the width step. */
  onStrokeEnd(): void;
}

/** Wire pen/eraser pointer drawing onto the canvas. */
export function attachStrokeHandlers(deps: StrokeHandlerDeps): void {
  const { canvasEl, ctx, history } = deps;
  let drawing = false;
  let lastPoint: Point | null = null;

  const startStroke = (event: PointerEvent): void => {
    // Ignore strokes while an undo/redo restore is still decoding: the
    // pending restore would immediately overwrite whatever gets drawn, and
    // the undo snapshot pushed here would capture the pre-restore bitmap.
    // Restores take a few milliseconds, so this is imperceptible.
    if (history.isBusy()) {
      return;
    }

    event.preventDefault();
    canvasEl.setPointerCapture(event.pointerId);
    history.record();
    deps.onInkChanged();
    drawing = true;
    lastPoint = getCanvasPoint(event);
    drawLine(lastPoint, lastPoint);
  };

  const continueStroke = (event: PointerEvent): void => {
    if (!drawing || !lastPoint) {
      return;
    }

    event.preventDefault();
    const point = getCanvasPoint(event);
    drawLine(lastPoint, point);
    lastPoint = point;
  };

  const endStroke = (event: PointerEvent): void => {
    if (!drawing) {
      return;
    }

    event.preventDefault();
    drawing = false;
    lastPoint = null;

    if (canvasEl.hasPointerCapture(event.pointerId)) {
      canvasEl.releasePointerCapture(event.pointerId);
    }

    deps.onStrokeEnd();
  };

  const drawLine = (from: Point, to: Point): void => {
    ctx.save();
    ctx.strokeStyle = deps.getTool() === "pen" ? "#000000" : "#ffffff";
    ctx.lineWidth = surfaceLineWidth(deps.getBrushInlinePx());
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  const getCanvasPoint = (event: PointerEvent): Point => {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvasEl.width,
      y: ((event.clientY - rect.top) / rect.height) * canvasEl.height,
    };
  };

  canvasEl.addEventListener("pointerdown", startStroke);
  canvasEl.addEventListener("pointermove", continueStroke);
  canvasEl.addEventListener("pointerup", endStroke);
  canvasEl.addEventListener("pointercancel", endStroke);
}
