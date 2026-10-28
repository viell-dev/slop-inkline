// The drawing surface: shows the line box with its guides, the document, and
// the stroke being drawn, in the text colour, and maps pointer positions to
// the document. It also draws the preview of the symbol at its size in text.

import type { Stroke } from "../format/record.ts";
import { documentSpan, type InkDocument } from "../ink/document.ts";
import { display, lineBox } from "../ink/geometry.ts";
import { findInk } from "../ink/canvas.ts";
import { drawInk, type DrawableBase } from "../ink/render.ts";
import {
  cropSpan,
  guideColourProperty,
  joinSpans,
  type FontMetrics,
  type Grid,
  type Guide,
  type Span,
} from "./guides.ts";
import type { Placement } from "./reference.ts";

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
 * How much a magnified view enlarges the drawing: it shows half the width of
 * the usual view, so the surface is twice as tall, as far as the window has
 * room for.
 */
export const magnification = 2;

/**
 * The widest image the preview shows whole, in document pixels: 32 em, far
 * wider than any symbol; of a wider one it shows this much about the middle
 * of the surface, so that it never needs a huge canvas.
 */
const maxPreview = 32 * lineBox.pxPerEm;

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

function element2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  return context;
}

/** How opaque a picture to trace over is drawn: faint, under the ink. */
const referenceAlpha = 0.35;

export class InkView {
  readonly canvas: HTMLCanvasElement;
  /** How much of the document the surface shows across, in pixels. */
  #across: number;
  /** What the surface shows across when not magnified, in pixels. */
  #fitted: number;
  /** Whether the surface shows the drawing magnified, taller and narrower. */
  #magnified = false;
  /**
   * The tallest the surface may grow when magnified, in CSS pixels, as the
   * window has room for; it then shows more width rather than grow.
   */
  heightLimit = Number.POSITIVE_INFINITY;
  /** CSS pixels per document pixel. */
  #scale = 1;
  /** The document x at the surface's left edge, in whole pixels. */
  #originX = 0;
  /**
   * The document x in the middle of the surface, kept exactly, so that
   * zooming in and out, or resizing, never moves it by rounding.
   */
  #center: number;
  #ratio = 1;
  /** The document and base layer that `#committed` shows. */
  #shown: { document: InkDocument; base: DrawableBase | undefined } | undefined;
  #committed = new OffscreenCanvas(1, 1);
  #work = new OffscreenCanvas(1, 1);
  /** The stroke being drawn, and the text colour, as last rendered. */
  #active: Stroke | undefined;
  #colour = "black";
  /** The document and base layer whose ink `#inked` measures. */
  #measured:
    { document: InkDocument; base: DrawableBase | undefined } | undefined;
  /**
   * The committed ink drawn for the preview, for the document, span and size
   * it was drawn at, kept while the stroke being drawn is added each frame.
   */
  #previewInk:
    | {
        readonly document: InkDocument;
        readonly base: DrawableBase | undefined;
        readonly left: number;
        readonly right: number;
        readonly canvas: OffscreenCanvas;
      }
    | undefined;
  /** The font's lines, or undefined to draw no guides. */
  lines: readonly Guide[] | undefined;
  /**
   * The grid, and an x its columns pass through, in document pixels, or
   * undefined to draw no grid.
   */
  grid: (Grid & { readonly originX: number }) | undefined;
  /**
   * A picture to trace over, drawn faintly under the ink where `placement`
   * puts it, or undefined for none. It is not part of the drawing.
   */
  reference:
    | {
        readonly image: CanvasImageSource;
        readonly placement: Placement;
        readonly width: number;
        readonly height: number;
      }
    | undefined;
  /** How far the committed ink reaches, from its pixels, in document pixels. */
  #inked: Span | undefined;
  /** Where the saved image would start and end, as of the last render. */
  #image: Span = cropSpan(undefined);

  constructor(canvas: HTMLCanvasElement, across = visibleWidth) {
    this.canvas = canvas;
    this.#across = across;
    this.#fitted = across;
    this.#center = across / 2;
  }

  /** Puts the surface's left edge where its middle and width say. */
  #place(): void {
    this.#originX = Math.round(this.#center - this.#across / 2);
    this.#shown = undefined;
  }

  /**
   * Shows a drawing that reaches from document x `left` to `right` in the
   * middle of the surface: whole, or magnified about its middle. Call
   * {@link resize} after, as the scale changes.
   */
  fit(left: number, right: number): void {
    this.#fitted = surfaceWidth(right - left);
    if (!this.#magnified) this.#across = this.#fitted;
    this.centerOn((left + right) / 2);
  }

  /** Whether the surface shows the drawing magnified. */
  get magnified(): boolean {
    return this.#magnified;
  }

  /**
   * Magnifies the drawing, or shows it as usual again, about the middle of
   * the surface. Call {@link resize} after, as the scale changes.
   */
  set magnified(magnified: boolean) {
    if (magnified === this.#magnified) return;
    this.#magnified = magnified;
    this.#across = magnified ? visibleWidth / magnification : this.#fitted;
    this.#place();
  }

  /** Moves the view along the drawing by `dx` document pixels. */
  pan(dx: number): void {
    if (dx === 0) return;
    this.#center += dx;
    this.#place();
  }

  /** The document x in the middle of the surface, in pixels. */
  get center(): number {
    return this.#center;
  }

  /** The document's x from the surface's left edge to its right, in pixels. */
  get visible(): Span {
    return { left: this.#originX, right: this.#originX + this.#across };
  }

  /** Puts document x `center` in the middle of the surface. */
  centerOn(center: number): void {
    this.#center = center;
    this.#place();
  }

  /** Moves the view with a document moved by `dx` pixels, so it stays put. */
  shift(dx: number): void {
    this.#center += dx;
    this.#place();
  }

  /** Fits the surface to `cssWidth` CSS pixels across. */
  resize(cssWidth: number, devicePixelRatio: number): void {
    const width = Math.max(1, cssWidth);
    if (this.#magnified) {
      // As tall as magnifying makes it, or the window allows, and never
      // smaller than the usual view; the middle stays where it was.
      const usual = width / this.#fitted;
      const scale = Math.max(
        usual,
        Math.min(
          (width * magnification) / visibleWidth,
          this.heightLimit / lineBox.height,
        ),
      );
      this.#across = width / scale;
      this.#place();
    }
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
   * Draws any picture to trace over, the line box, and the document, with
   * `active`, the stroke being drawn, on top: erasing it cuts the ink below
   * as it will when committed, never the picture.
   * The image's ends come from the committed ink's pixels inside the line
   * box, as a save crops to them, read back from the whole drawing each time
   * the ink changes, however much of it the surface shows, and from a pen
   * stroke being drawn.
   */
  render(
    document: InkDocument,
    base: DrawableBase | undefined,
    active: Stroke | undefined,
  ): void {
    const { width, height } = this.canvas;
    if (this.#measured?.document !== document || this.#measured.base !== base) {
      this.#measure(document, base);
      this.#measured = { document, base };
    }
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
      committed.resetTransform();
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
    this.#active = active;
    this.#colour = style.color;
    // The ink is shown in the text colour, as it will be in the note.
    work.globalCompositeOperation = "source-in";
    work.fillStyle = style.color;
    work.fillRect(0, 0, width, height);

    const visible = element2d(this.canvas);
    visible.resetTransform();
    visible.clearRect(0, 0, width, height);
    // A picture to trace over goes below the guides, which line it up.
    const { reference } = this;
    if (reference !== undefined) {
      const { x, y, scale } = reference.placement;
      this.#transform(visible);
      visible.globalAlpha = referenceAlpha;
      visible.drawImage(
        reference.image,
        x,
        y,
        reference.width * scale,
        reference.height * scale,
      );
      visible.globalAlpha = 1;
      visible.resetTransform();
    }
    this.#drawLineBox(visible, style);
    visible.drawImage(this.#work, 0, 0);
  }

  /**
   * Draws the grid, as dots where its lines cross, and the guides: the
   * baseline solid, the font's other lines and the image's ends dashed, each
   * on a whole device pixel, and each font line in its own colour.
   */
  #drawLineBox(
    context: CanvasRenderingContext2D,
    style: CSSStyleDeclaration,
  ): void {
    const factor = this.#scale * this.#ratio;
    const { width, height } = this.canvas;
    const colour = style.getPropertyValue("--inkline-guide").trim() || "gray";
    const { grid, lines } = this;
    if (grid !== undefined) {
      context.fillStyle = colour;
      const dot = Math.max(2, Math.round(this.#ratio * 2));
      const { spacing, rows, originX } = grid;
      const first =
        originX + Math.ceil((this.#originX - originX) / spacing) * spacing;
      for (let x = first; x <= this.#originX + this.#across; x += spacing) {
        for (const y of rows) {
          context.fillRect(
            Math.round((x - this.#originX) * factor) - dot / 2,
            Math.round(y * factor) - dot / 2,
            dot,
            dot,
          );
        }
      }
    }
    if (lines === undefined) return;
    const at = (value: number): number => Math.round(value * factor) + 0.5;
    context.strokeStyle = colour;
    context.lineWidth = 1;
    for (const line of lines) {
      // A value the canvas cannot read leaves the faint guide colour.
      context.strokeStyle = colour;
      context.strokeStyle =
        style.getPropertyValue(guideColourProperty(line.name)).trim() || colour;
      context.setLineDash(line.name === "baseline" ? [] : [4, 4]);
      context.beginPath();
      context.moveTo(0, at(line.y));
      context.lineTo(width, at(line.y));
      context.stroke();
    }
    context.strokeStyle = colour;
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
   * CSS pixels, in the text colour, as last rendered: the whole image, with
   * the stroke being drawn, however much of it the surface shows, up to
   * {@link maxPreview} across about the middle of the surface.
   */
  drawPreview(target: HTMLCanvasElement, fontSize: number): void {
    let { left, right } = this.#image;
    right = Math.max(left + 1, right);
    if (right - left > maxPreview) {
      const middle = Math.min(
        Math.max(this.#center, left + maxPreview / 2),
        right - maxPreview / 2,
      );
      left = middle - maxPreview / 2;
      right = middle + maxPreview / 2;
    }
    const scale = fontSize / lineBox.pxPerEm;
    const shape = display({ ...lineBox, width: right - left });
    const cssWidth = (right - left) * scale;
    const cssHeight = shape.heightEm * fontSize;
    target.style.width = `${String(cssWidth)}px`;
    target.style.height = `${String(cssHeight)}px`;
    target.style.verticalAlign = `${String(shape.verticalAlignEm)}em`;
    target.width = Math.max(1, Math.round(cssWidth * this.#ratio));
    target.height = Math.max(1, Math.round(cssHeight * this.#ratio));
    // Device pixels per document pixel, across and down, each from the
    // target's own rounded size, so that both ends of the image show.
    const across = target.width / (right - left);
    const down = target.height / lineBox.height;
    const place = (context: {
      setTransform(
        a: number,
        b: number,
        c: number,
        d: number,
        e: number,
        f: number,
      ): void;
    }): void => {
      context.setTransform(across, 0, 0, down, -left * across, 0);
    };
    const measured = this.#measured;
    let ink = this.#previewInk;
    if (
      ink === undefined ||
      ink.document !== measured?.document ||
      ink.base !== measured.base ||
      ink.left !== left ||
      ink.right !== right ||
      ink.canvas.width !== target.width ||
      ink.canvas.height !== target.height
    ) {
      const canvas = new OffscreenCanvas(target.width, target.height);
      const drawn = offscreen2d(canvas);
      if (measured !== undefined) {
        place(drawn);
        drawInk(
          drawn,
          measured.document.strokes,
          measured.document.base === undefined ? undefined : measured.base,
        );
      }
      ink = {
        document: measured?.document ?? { strokes: [] },
        base: measured?.base,
        left,
        right,
        canvas,
      };
      this.#previewInk = ink;
    }
    const context = element2d(target);
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(ink.canvas, 0, 0);
    const active = this.#active;
    if (active !== undefined) {
      place(context);
      drawInk(context, [active], undefined);
      context.resetTransform();
    }
    context.globalCompositeOperation = "source-in";
    context.fillStyle = this.#colour;
    context.fillRect(0, 0, target.width, target.height);
    context.globalCompositeOperation = "source-over";
  }

  /**
   * Finds how far the drawing's ink reaches inside the line box, as a save
   * crops to it, whatever the surface shows: in tiles, so that geometry far
   * away or erased costs time but never a huge canvas.
   */
  #measure(document: InkDocument, base: DrawableBase | undefined): void {
    const found = findInk(
      document,
      document.base === undefined ? undefined : base,
    );
    this.#inked =
      found === undefined
        ? undefined
        : { left: found.left, right: found.right };
  }
}
