// The drawing surface: shows the line box with its guides, the document, and
// the stroke being drawn, in the text colour, and maps pointer positions to
// the document. It also draws the preview of the symbol at its size in text.

import type { Stroke } from "../format/record.ts";
import type { InkDocument } from "../ink/document.ts";
import { display, lineBox } from "../ink/geometry.ts";
import { drawInk, type DrawableBase } from "../ink/render.ts";
import type { FontMetrics, Guide } from "./guides.ts";

/** A font as CSS describes it, for {@link measureFont}. */
export interface FontStyle {
  readonly style: string;
  readonly weight: string;
  readonly family: string;
}

/** A font's vertical metrics, measured from its glyphs at the line box's size. */
export function measureFont(font: FontStyle): FontMetrics {
  const context = new OffscreenCanvas(1, 1).getContext("2d");
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

/** What the surface shows behind the ink: the font's lines and the image's ends. */
export interface Guides {
  readonly lines: readonly Guide[];
  /** Where the saved image would start and end, in document pixels. */
  readonly image: { readonly left: number; readonly right: number };
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
): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  return context;
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
  /** The guides to draw, or undefined to draw none. */
  guides: Guides | undefined;

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
   * Draws the line box and the document, with `active`, the stroke being
   * drawn, on top: erasing it cuts the ink below as it will when committed.
   */
  render(
    document: InkDocument,
    base: DrawableBase | undefined,
    active: Stroke | undefined,
  ): void {
    const { width, height } = this.canvas;
    if (this.#shown?.document !== document || this.#shown.base !== base) {
      const committed = offscreen2d(this.#committed);
      committed.resetTransform();
      committed.clearRect(0, 0, width, height);
      this.#transform(committed);
      drawInk(
        committed,
        document.strokes,
        document.base === undefined ? undefined : base,
      );
      this.#shown = { document, base };
    }
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
    const { guides } = this;
    if (guides === undefined) return;
    const factor = this.#scale * this.#ratio;
    const { width, height } = this.canvas;
    const at = (value: number): number => Math.round(value * factor) + 0.5;
    context.strokeStyle =
      style.getPropertyValue("--inkline-guide").trim() || "gray";
    context.lineWidth = 1;
    for (const line of guides.lines) {
      context.setLineDash(line.name === "baseline" ? [] : [4, 4]);
      context.beginPath();
      context.moveTo(0, at(line.y));
      context.lineTo(width, at(line.y));
      context.stroke();
    }
    context.setLineDash([2, 4]);
    for (const x of [guides.image.left, guides.image.right]) {
      context.beginPath();
      context.moveTo(at(x - this.#originX), 0);
      context.lineTo(at(x - this.#originX), height);
      context.stroke();
    }
    context.setLineDash([]);
  }

  /**
   * Draws the symbol into `target` as it would show in text of
   * `fontSize` CSS pixels: the image from `left` to `right` in document
   * pixels, from what the surface last rendered, in the text colour.
   */
  drawPreview(
    target: HTMLCanvasElement,
    left: number,
    right: number,
    fontSize: number,
  ): void {
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
