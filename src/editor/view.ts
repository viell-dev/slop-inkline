// The drawing surface: shows the line box with its guides, the document, and
// the stroke being drawn, in the text colour, and maps pointer positions to
// the document. It also draws the preview of the symbol at its size in text.

import type { Stroke } from "../format/record.ts";
import { documentSpan, type InkDocument } from "../ink/document.ts";
import { display, lineBox } from "../ink/geometry.ts";
import { drawInk, type DrawableBase } from "../ink/render.ts";
import {
  cropSpan,
  joinSpans,
  type FontMetrics,
  type Guide,
  type Span,
} from "./guides.ts";

/** A font as CSS describes it, for {@link measureFont}. */
export interface FontStyle {
  readonly style: string;
  readonly weight: string;
  readonly family: string;
}

/**
 * A font's vertical metrics, measured from its glyphs at the line box's
 * size, in `doc`, whose fonts a canvas uses: a popout window has its own.
 */
export function measureFont(font: FontStyle, doc: Document): FontMetrics {
  // That window's own canvas, which uses that document's fonts.
  const view = doc.defaultView;
  if (view === null) throw new Error("the document has no window");
  const context = new view.OffscreenCanvas(1, 1).getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  const em = lineBox.pxPerEm;
  context.font = `${font.style} ${font.weight} ${String(em)}px ${font.family}`;
  const capital = context.measureText("H");
  const lowercase = context.measureText("x");
  return {
    ascent: capital.fontBoundingBoxAscent / em,
    descent: capital.fontBoundingBoxDescent / em,
    capHeight: capital.actualBoundingBoxAscent / em,
    xHeight: lowercase.actualBoundingBoxAscent / em,
  };
}

/** How much of the line box the surface shows across at least, in pixels. */
export const visibleWidth = 4.5 * lineBox.pxPerEm;

/**
 * How much the surface shows across for a drawing `width` pixels wide: all
 * of it, with half an em to spare on each side, and never less than
 * {@link visibleWidth}.
 */
export function surfaceWidth(width: number): number {
  return Math.max(visibleWidth, width + lineBox.pxPerEm);
}

function offscreen2d(
  canvas: OffscreenCanvas,
  options?: CanvasRenderingContext2DSettings,
): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d", options);
  if (context === null) throw new Error("no 2D canvas context");
  return context;
}

/**
 * The columns that hold any ink, from the alpha of `pixels`, as the first
 * and the one past the last, or undefined when none does.
 */
function inkedColumns(
  pixels: ImageData,
): { first: number; end: number } | undefined {
  const { width, height, data } = pixels;
  let first = width;
  let last = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < first; x++) {
      if ((data[(row + x) * 4 + 3] ?? 0) > 0) {
        first = x;
        break;
      }
    }
    for (let x = width - 1; x > last; x--) {
      if ((data[(row + x) * 4 + 3] ?? 0) > 0) {
        last = x;
        break;
      }
    }
  }
  return last < first ? undefined : { first, end: last + 1 };
}

function element2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  return context;
}

export class InkView {
  readonly canvas: HTMLCanvasElement;
  /** How much of the document the surface shows across, in pixels. */
  #across: number;
  /** CSS pixels per document pixel. */
  #scale = 1;
  /** The document x at the surface's left edge, in pixels. */
  #originX = 0;
  #ratio = 1;
  /** The document and base layer that `#committed` shows. */
  #shown: { document: InkDocument; base: DrawableBase | undefined } | undefined;
  #committed = new OffscreenCanvas(1, 1);
  #work = new OffscreenCanvas(1, 1);
  /** The font's lines, or undefined to draw no guides. */
  lines: readonly Guide[] | undefined;
  /** How far the committed ink reaches, from its pixels, in document pixels. */
  #inked: Span | undefined;
  /** Where the saved image would start and end, as of the last render. */
  #image: Span = cropSpan(undefined);

  constructor(canvas: HTMLCanvasElement, across = visibleWidth) {
    this.canvas = canvas;
    this.#across = across;
  }

  /**
   * Shows a drawing that reaches from document x `left` to `right` whole,
   * in the middle of the surface. Call {@link resize} after, as the scale
   * changes.
   */
  fit(left: number, right: number): void {
    this.#across = surfaceWidth(right - left);
    this.centerOn((left + right) / 2);
  }

  /** Puts document x `center` in the middle of the surface. */
  centerOn(center: number): void {
    this.#originX = Math.round(center - this.#across / 2);
    this.#shown = undefined;
  }

  /** Moves the view with a document moved by `dx` pixels, so it stays put. */
  shift(dx: number): void {
    this.#originX += dx;
    this.#shown = undefined;
  }

  /** Fits the surface to `cssWidth` CSS pixels across. */
  resize(cssWidth: number, devicePixelRatio: number): void {
    const width = Math.max(1, cssWidth);
    this.#scale = width / this.#across;
    this.#ratio = devicePixelRatio;
    const cssHeight = lineBox.height * this.#scale;
    this.canvas.style.setProperty(
      "--inkline-surface-height",
      `${String(cssHeight)}px`,
    );
    const pixelWidth = Math.max(1, Math.round(width * devicePixelRatio));
    const pixelHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
    for (const surface of [this.canvas, this.#committed, this.#work]) {
      surface.width = pixelWidth;
      surface.height = pixelHeight;
    }
    this.#shown = undefined;
  }

  /**
   * The document position under a point on the screen, in pixels. The
   * drawing starts inside the surface's border, as its size does.
   */
  toDocument(clientX: number, clientY: number): { x: number; y: number } {
    const { canvas } = this;
    const rect = canvas.getBoundingClientRect();
    return {
      x:
        (clientX - rect.left - canvas.clientLeft) / this.#scale + this.#originX,
      y: (clientY - rect.top - canvas.clientTop) / this.#scale,
    };
  }

  #transform(context: Pick<CanvasTransform, "setTransform">): void {
    const factor = this.#scale * this.#ratio;
    context.setTransform(factor, 0, 0, factor, -this.#originX * factor, 0);
  }

  /**
   * Where the saved image would start and end, in document pixels: the ink
   * the surface shows, plus a pen stroke being drawn, with side bearings.
   */
  get image(): Span {
    return this.#image;
  }

  /**
   * Draws the line box and the document, with `active`, the stroke being
   * drawn, on top: erasing it cuts the ink below as it will when committed.
   * The image's ends come from the committed ink's pixels inside the line
   * box, as a save crops to them, read back each time the ink changes, and
   * from a pen stroke being drawn.
   */
  render(
    document: InkDocument,
    base: DrawableBase | undefined,
    active: Stroke | undefined,
  ): void {
    const { width, height } = this.canvas;
    const factor = this.#scale * this.#ratio;
    if (this.#shown?.document !== document || this.#shown.base !== base) {
      const committed = offscreen2d(this.#committed, {
        willReadFrequently: true,
      });
      committed.resetTransform();
      committed.clearRect(0, 0, width, height);
      this.#transform(committed);
      drawInk(
        committed,
        document.strokes,
        document.base === undefined ? undefined : base,
      );
      committed.resetTransform();
      const columns = inkedColumns(committed.getImageData(0, 0, width, height));
      this.#inked =
        columns === undefined
          ? undefined
          : {
              left: columns.first / factor + this.#originX,
              right: columns.end / factor + this.#originX,
            };
      this.#shown = { document, base };
    }
    this.#image = cropSpan(
      joinSpans(
        this.#inked,
        active?.tool === "pen"
          ? documentSpan({ strokes: [active] })
          : undefined,
      ),
    );
    const work = offscreen2d(this.#work);
    work.resetTransform();
    work.globalCompositeOperation = "copy";
    work.drawImage(this.#committed, 0, 0);
    work.globalCompositeOperation = "source-over";
    if (active !== undefined) {
      this.#transform(work);
      drawInk(work, [active], undefined);
      work.resetTransform();
    }
    const style = getComputedStyle(this.canvas);
    // The ink is shown in the text colour, as it will be in the note.
    work.globalCompositeOperation = "source-in";
    work.fillStyle = style.color;
    work.fillRect(0, 0, width, height);

    const visible = element2d(this.canvas);
    visible.resetTransform();
    visible.clearRect(0, 0, width, height);
    this.#drawLineBox(visible, style);
    visible.drawImage(this.#work, 0, 0);
  }

  /**
   * Draws the guides: the baseline solid, the font's other lines and the
   * image's ends dashed, each on a whole device pixel.
   */
  #drawLineBox(
    context: CanvasRenderingContext2D,
    style: CSSStyleDeclaration,
  ): void {
    const { lines } = this;
    if (lines === undefined) return;
    const factor = this.#scale * this.#ratio;
    const { width, height } = this.canvas;
    const at = (value: number): number => Math.round(value * factor) + 0.5;
    context.strokeStyle =
      style.getPropertyValue("--inkline-guide").trim() || "gray";
    context.lineWidth = 1;
    for (const line of lines) {
      context.setLineDash(line.name === "baseline" ? [] : [4, 4]);
      context.beginPath();
      context.moveTo(0, at(line.y));
      context.lineTo(width, at(line.y));
      context.stroke();
    }
    context.setLineDash([2, 4]);
    for (const x of [this.#image.left, this.#image.right]) {
      context.beginPath();
      context.moveTo(at(x - this.#originX), 0);
      context.lineTo(at(x - this.#originX), height);
      context.stroke();
    }
    context.setLineDash([]);
  }

  /**
   * Draws the symbol into `target` as it would show in text of `fontSize`
   * CSS pixels, from what the surface last rendered, in the text colour: the
   * image, as far as the surface shows it, so that the preview is never wider
   * than the surface's own rendering.
   */
  drawPreview(target: HTMLCanvasElement, fontSize: number): void {
    const left = Math.max(this.#image.left, this.#originX);
    const right = Math.max(
      left + 1,
      Math.min(this.#image.right, this.#originX + this.#across),
    );
    const scale = fontSize / lineBox.pxPerEm;
    const heightEm = display({ ...lineBox, width: right - left }).heightEm;
    const cssWidth = (right - left) * scale;
    const cssHeight = heightEm * fontSize;
    target.style.width = `${String(cssWidth)}px`;
    target.style.height = `${String(cssHeight)}px`;
    target.style.verticalAlign = `${String(
      display({ ...lineBox, width: right - left }).verticalAlignEm,
    )}em`;
    target.width = Math.max(1, Math.round(cssWidth * this.#ratio));
    target.height = Math.max(1, Math.round(cssHeight * this.#ratio));
    const context = element2d(target);
    context.clearRect(0, 0, target.width, target.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const factor = this.#scale * this.#ratio;
    context.drawImage(
      this.#work,
      (left - this.#originX) * factor,
      0,
      (right - left) * factor,
      lineBox.height * factor,
      0,
      0,
      target.width,
      target.height,
    );
  }
}
