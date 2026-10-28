// Drawing a symbol: its base layer, then its strokes in order, pens adding
// ink and erasers removing it, all in one grey whose alpha is the ink.

import { unitsPerPixel, type Stroke } from "../format/record.ts";
import type { Bounds } from "./geometry.ts";
import {
  cutBoxes,
  strokeOutline,
  traceOutline,
  uncutRest,
  type PathSink,
} from "./outline.ts";

/**
 * The grey ink is stored in: 126 on 0–255, which balances its contrast
 * against white (4.06:1) and against the dark backgrounds of Obsidian,
 * #1e1e1e (4.11:1), and GitHub, #0d1117 (4.66:1), so a symbol stays legible
 * where the plugin cannot colour it. With the plugin, only the alpha counts.
 */
export const inkGrey = 126;

/** The CSS colour of {@link inkGrey}. */
export const inkColor = "#7e7e7e";

/** Farther than any drawing reaches, in pixels, for a clip around a cut. */
const everywhere = 2 ** 24;

/** A base layer decoded for drawing: where it goes and its pixels. */
export interface DrawableBase {
  /** In units, like the record's base layer. */
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

/** The subset of a 2D canvas context that drawing uses. */
export interface DrawingContext extends PathSink {
  globalCompositeOperation: GlobalCompositeOperation;
  fillStyle: string | CanvasGradient | CanvasPattern;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  beginPath(): void;
  fill(): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(fillRule: CanvasFillRule): void;
}

/**
 * Draws a symbol on a cleared canvas, shifted right by `offsetX` pixels. A
 * base layer is drawn first, scaled with smoothing; each stroke then fills
 * its outline, a pen over what is there and an eraser cutting it away.
 */
export function drawInk(
  context: DrawingContext,
  strokes: readonly Stroke[],
  base: DrawableBase | undefined,
  offsetX = 0,
): void {
  context.save();
  context.translate(offsetX, 0);
  context.fillStyle = inkColor;
  if (base !== undefined) {
    context.globalCompositeOperation = "source-over";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      base.image,
      base.x / unitsPerPixel,
      base.y / unitsPerPixel,
      base.width * base.scale,
      base.height * base.scale,
    );
  }
  for (const stroke of strokes) {
    context.globalCompositeOperation =
      stroke.tool === "pen" ? "source-over" : "destination-out";
    const boxes = cutBoxes(stroke);
    if (boxes.length === 0) {
      context.beginPath();
      traceOutline(strokeOutline(stroke), context);
      context.fill();
      continue;
    }
    // The whole stroke, everywhere but its cut boxes...
    context.save();
    for (const box of boxes) {
      context.beginPath();
      context.rect(-everywhere, -everywhere, 2 * everywhere, 2 * everywhere);
      addBox(context, box);
      context.clip("evenodd");
    }
    context.beginPath();
    traceOutline(strokeOutline(stroke), context);
    context.fill();
    context.restore();
    // ...and in them, the rest of it, without the ends cut there.
    const rest = uncutRest(stroke);
    if (rest === undefined) continue;
    context.save();
    context.beginPath();
    for (const box of boxes) addBox(context, box);
    context.clip("nonzero");
    context.beginPath();
    traceOutline(strokeOutline(rest), context);
    context.fill();
    context.restore();
  }
  context.restore();
}

/** Adds a box to the path being built. */
function addBox(context: DrawingContext, box: Bounds): void {
  context.rect(box.left, box.top, box.right - box.left, box.bottom - box.top);
}
