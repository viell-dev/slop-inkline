import { App, ButtonComponent, Modal, Notice, TFile } from "obsidian";
import { canvasToPngArrayBuffer, loadImage } from "./canvas";
import {
  clampImageSize,
  IMAGE_SIZE,
  InkFileService,
  snapAspectToWidthStep,
  snapWidthStep,
  WidthStep,
  WIDTH_STEPS,
} from "./ink-file";
import { computeInkLineLayout, InkLineLayout, parseDisplayHeightEm } from "./layout";

type InkTool = "pen" | "eraser";

interface Point {
  x: number;
  y: number;
}

interface BrushSize {
  label: string;
  // How many CSS pixels the stroke occupies inline at the reference height.
  inlinePx: number;
}

// Fixed backing resolution the editor draws on, independent of any file's
// stored size. Strokes are downsampled to the file's export size on save, so
// this must be >= the largest export size (kept in sync with MAX_IMAGE_SIZE in
// ink-file.ts) for exporting to always be a downsample, never an upscale.
// DISPLAY_WIDTH is only the on-screen size and is independent of the backing.
const SURFACE_SIZE = 576;
const DISPLAY_WIDTH = 512;

// Brushes are sized by how many CSS pixels they occupy inline at the reference
// display height (1.5em on a 16px font, i.e. the whole square shown at 24px).
// The fixed surface plus downsample-on-export makes a stroke render at the same
// inline px whatever the file's export resolution, so no hard-coded pixels.
const REFERENCE_INLINE_PX = 24;
const BRUSH_SIZES: BrushSize[] = [
  { label: "S", inlinePx: 1 },
  { label: "M", inlinePx: 2 },
  { label: "L", inlinePx: 3 },
  { label: "XL", inlinePx: 4 },
];
const DEFAULT_BRUSH = BRUSH_SIZES[1]; // M
const MAX_UNDO_STEPS = 50;

// Pixels darker than this (grayscale, composited on white) count as ink for
// width-step detection. Must match how forceGrayscaleOpaque flattens pixels so
// live detection and post-flatten detection agree.
const INK_THRESHOLD = 250;

// Surface-pixel line width for a brush from its inline appearance. Independent
// of the file's stored size: the fixed surface plus downsample-on-export makes
// a stroke render at the same inline px whatever the export resolution.
function surfaceLineWidth(inlinePx: number): number {
  return (inlinePx * SURFACE_SIZE) / REFERENCE_INLINE_PX;
}

// The export resolution for a loaded ink: keep the file's own size (so inks are
// never shrunk or grown on save), clamped to the shared valid range. The
// configured image size only applies to newly created inks (see
// InkFileService.createBlankInkFile), which then load at that size here.
function resolveExportSize(loadedHeight: number): number {
  if (!Number.isFinite(loadedHeight) || loadedHeight <= 0) {
    return IMAGE_SIZE;
  }

  return clampImageSize(loadedHeight);
}

interface InkEditorModalOptions {
  isNew?: boolean;
  displayHeight?: string;
  onSave?: (file: TFile) => void;
  onDiscard?: (file: TFile) => void | Promise<void>;
}

export class InkEditorModal extends Modal {
  private nameInputEl!: HTMLInputElement;
  private canvasEl!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private file: TFile;
  private tool: InkTool = "pen";
  private brushInlinePx = DEFAULT_BRUSH.inlinePx;
  private exportSize = IMAGE_SIZE;
  private loadedStep: WidthStep | null = null;
  private contentModified = false;
  private cropGuidesEl!: HTMLElement;
  private drawing = false;
  private hasSaved = false;
  private lastPoint: Point | null = null;
  private undoStack: ImageData[] = [];
  private redoStack: ImageData[] = [];
  private readonly toolButtons = new Map<InkTool, ButtonComponent>();
  private readonly sizeButtons = new Map<number, ButtonComponent>();

  constructor(
    app: App,
    private readonly fileService: InkFileService,
    file: TFile,
    private readonly options: InkEditorModalOptions = {},
  ) {
    super(app);
    this.file = file;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("inkline-editor-modal-frame");
    contentEl.addClass("inkline-editor-modal");

    const headerEl = contentEl.createDiv({ cls: "inkline-editor-header" });
    this.nameInputEl = headerEl.createEl("input", {
      cls: "inkline-name-input",
      attr: {
        type: "text",
        value: this.fileService.getDisplayName(this.file),
        "aria-label": "Ink name",
      },
    });
    this.nameInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.save();
      }
    });

    const toolbarEl = contentEl.createDiv({ cls: "inkline-editor-toolbar" });
    this.createToolButton(toolbarEl, "Pen", "pen");
    this.createToolButton(toolbarEl, "Eraser", "eraser");

    const sizeGroupEl = toolbarEl.createDiv({ cls: "inkline-size-control" });
    sizeGroupEl.createSpan({ text: "Size" });
    for (const brush of BRUSH_SIZES) {
      this.createSizeButton(sizeGroupEl, brush);
    }

    new ButtonComponent(toolbarEl)
      .setButtonText("Undo")
      .onClick(() => this.undo());

    new ButtonComponent(toolbarEl)
      .setButtonText("Redo")
      .onClick(() => this.redo());

    new ButtonComponent(toolbarEl)
      .setButtonText("Clear")
      .onClick(() => this.clear());

    new ButtonComponent(toolbarEl)
      .setButtonText("Save")
      .setCta()
      .onClick(() => {
        void this.save();
      });

    new ButtonComponent(toolbarEl)
      .setButtonText("Save and Close")
      .onClick(() => {
        void this.saveAndClose();
      });

    const canvasWrapEl = contentEl.createDiv({ cls: "inkline-canvas-wrap" });
    const stageEl = canvasWrapEl.createDiv({ cls: "inkline-canvas-stage" });
    this.canvasEl = stageEl.createEl("canvas", { cls: "inkline-editor-canvas" });
    this.buildCropGuides(stageEl);
    this.buildBaselineGuides(stageEl);
    this.canvasEl.addEventListener("pointerdown", (event) => this.startStroke(event));
    this.canvasEl.addEventListener("pointermove", (event) => this.continueStroke(event));
    this.canvasEl.addEventListener("pointerup", (event) => this.endStroke(event));
    this.canvasEl.addEventListener("pointercancel", (event) => this.endStroke(event));

    this.updateToolState();
    this.updateSizeState();

    void this.loadImage();
  }

  onClose(): void {
    this.modalEl.removeClass("inkline-editor-modal-frame");
    this.contentEl.empty();

    if (this.options.isNew && !this.hasSaved) {
      void this.options.onDiscard?.(this.file);
    }
  }

  private createToolButton(parentEl: HTMLElement, label: string, tool: InkTool): void {
    const button = new ButtonComponent(parentEl)
      .setButtonText(label)
      .onClick(() => this.setTool(tool));
    this.toolButtons.set(tool, button);
  }

  private createSizeButton(parentEl: HTMLElement, brush: BrushSize): void {
    const button = new ButtonComponent(parentEl)
      .setButtonText(brush.label)
      .setTooltip(`Brush size ${brush.label} (~${brush.inlinePx}px inline)`)
      .onClick(() => this.setBrush(brush.inlinePx));
    this.sizeButtons.set(brush.inlinePx, button);
  }

  private setTool(tool: InkTool): void {
    this.tool = tool;
    this.updateToolState();
    this.updateBrushCursorStyle();
  }

  private setBrush(inlinePx: number): void {
    this.brushInlinePx = inlinePx;
    this.updateSizeState();
    this.updateBrushCursorStyle();
  }

  private updateToolState(): void {
    for (const [tool, button] of this.toolButtons) {
      button.buttonEl.toggleClass("inkline-active", tool === this.tool);
    }
  }

  private updateSizeState(): void {
    for (const [inlinePx, button] of this.sizeButtons) {
      button.buttonEl.toggleClass("inkline-active", inlinePx === this.brushInlinePx);
    }
  }

  /**
   * Render the brush footprint as the real canvas cursor (an SVG data URI),
   * scaled to the on-screen canvas size. Using the native cursor avoids the
   * jitter of a DOM element chasing pointer events.
   */
  private updateBrushCursorStyle(): void {
    if (!this.canvasEl) {
      return;
    }

    const rect = this.canvasEl.getBoundingClientRect();
    const scale = this.canvasEl.width && rect.width ? rect.width / this.canvasEl.width : 1;
    const diameter = Math.max(surfaceLineWidth(this.brushInlinePx) * scale, 1);
    this.canvasEl.style.cursor = brushCursor(diameter, this.tool);
  }

  /**
   * Corner crop-marks sitting just outside the canvas mark the width-step
   * cutoff the drawing currently snaps to (their inner edge is the cut line),
   * and follow the drawing live. Hovering a mark reveals the full dashed
   * cutoff lines. These are DOM only and never touch the exported PNG.
   */
  private buildCropGuides(stageEl: HTMLElement): void {
    this.cropGuidesEl = stageEl.createDiv({ cls: "inkline-crop-guides" });

    for (const corner of ["tl", "tr", "bl", "br"]) {
      this.cropGuidesEl.createDiv({ cls: `inkline-crop-mark inkline-crop-mark-${corner}` });
    }

    this.cropGuidesEl.createDiv({ cls: "inkline-crop-line inkline-crop-line-left" });
    this.cropGuidesEl.createDiv({ cls: "inkline-crop-line inkline-crop-line-right" });

    this.updateCropGuides(WIDTH_STEPS[0]);
  }

  private updateCropGuides(step: WidthStep): void {
    const leftPercent = ((1 - step) / 2) * 100;
    this.cropGuidesEl.style.setProperty("--inkline-crop-left", `${leftPercent}%`);
    this.cropGuidesEl.style.setProperty("--inkline-crop-right", `${100 - leftPercent}%`);
  }

  /** Re-detect the export width step and move the crop guides to match. */
  private refreshWidthStep(): void {
    if (!this.ctx) {
      return;
    }

    this.updateCropGuides(this.currentWidthStep());
  }

  /**
   * Horizontal baseline and cap-line references on the left/right edges, with
   * the ascender/descender regions shaded on hover. Positions come from the
   * shared layout so they match how the image renders inline. DOM only.
   */
  private buildBaselineGuides(stageEl: HTMLElement): void {
    const layout = this.lineLayout();
    const guidesEl = stageEl.createDiv({ cls: "inkline-baseline-guides" });
    guidesEl.style.setProperty("--inkline-capline", `${(layout.capLineY / IMAGE_SIZE) * 100}%`);
    guidesEl.style.setProperty("--inkline-baseline", `${(layout.baselineY / IMAGE_SIZE) * 100}%`);

    for (const side of ["left", "right"]) {
      for (const line of ["cap", "base"]) {
        guidesEl.createDiv({ cls: `inkline-htick inkline-htick-${side} inkline-htick-${line}` });
      }
    }

    guidesEl.createDiv({ cls: "inkline-hline inkline-hline-cap" });
    guidesEl.createDiv({ cls: "inkline-hline inkline-hline-base" });
    guidesEl.createDiv({ cls: "inkline-band inkline-band-ascender" });
    guidesEl.createDiv({ cls: "inkline-band inkline-band-descender" });
  }

  private lineLayout(): InkLineLayout {
    return computeInkLineLayout(parseDisplayHeightEm(this.options.displayHeight ?? "1.5em"));
  }

  private async loadImage(): Promise<void> {
    const data = await this.fileService.readBinary(this.file);
    const blob = new Blob([data], { type: "image/png" });
    const url = URL.createObjectURL(blob);

    try {
      const image = await loadImage(url);
      this.canvasEl.width = SURFACE_SIZE;
      this.canvasEl.height = SURFACE_SIZE;
      this.canvasEl.style.width = `${DISPLAY_WIDTH}px`;

      const ctx = this.canvasEl.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        throw new Error("Could not create a canvas rendering context.");
      }

      this.ctx = ctx;
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(0, 0, SURFACE_SIZE, SURFACE_SIZE);

      // Always edit on the square. A previously cropped file is scaled to the
      // surface height and re-centered into its width-step band so editing
      // continues. The aspect ratio snaps to the exact step so the band lands
      // on the same (fractional) surface coordinates the export cropped from,
      // making save/reload cycles geometrically drift-free.
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (sourceWidth > 0 && sourceHeight > 0) {
        this.exportSize = resolveExportSize(sourceHeight);
        this.loadedStep = snapAspectToWidthStep(sourceWidth / sourceHeight);
        const drawWidth = SURFACE_SIZE * this.loadedStep;
        const offsetX = (SURFACE_SIZE - drawWidth) / 2;
        this.ctx.drawImage(image, offsetX, 0, drawWidth, SURFACE_SIZE);
      }

      this.refreshWidthStep();
      this.updateBrushCursorStyle();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private startStroke(event: PointerEvent): void {
    if (!this.ctx) {
      return;
    }

    event.preventDefault();
    this.canvasEl.setPointerCapture(event.pointerId);
    this.pushUndo();
    this.redoStack = [];
    this.contentModified = true;
    this.drawing = true;
    this.lastPoint = this.getCanvasPoint(event);
    this.drawLine(this.lastPoint, this.lastPoint);
  }

  private continueStroke(event: PointerEvent): void {
    if (!this.drawing || !this.lastPoint) {
      return;
    }

    event.preventDefault();
    const point = this.getCanvasPoint(event);
    this.drawLine(this.lastPoint, point);
    this.lastPoint = point;
  }

  private endStroke(event: PointerEvent): void {
    if (!this.drawing) {
      return;
    }

    event.preventDefault();
    this.drawing = false;
    this.lastPoint = null;

    if (this.canvasEl.hasPointerCapture(event.pointerId)) {
      this.canvasEl.releasePointerCapture(event.pointerId);
    }

    this.refreshWidthStep();
  }

  private drawLine(from: Point, to: Point): void {
    this.ctx.save();
    this.ctx.strokeStyle = this.tool === "pen" ? "#000000" : "#ffffff";
    this.ctx.lineWidth = surfaceLineWidth(this.brushInlinePx);
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private getCanvasPoint(event: PointerEvent): Point {
    const rect = this.canvasEl.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.canvasEl.width,
      y: ((event.clientY - rect.top) / rect.height) * this.canvasEl.height,
    };
  }

  private pushUndo(): void {
    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvasEl.width, this.canvasEl.height));

    if (this.undoStack.length > MAX_UNDO_STEPS) {
      this.undoStack.shift();
    }
  }

  private undo(): void {
    if (!this.ctx) {
      return;
    }

    const imageData = this.undoStack.pop();
    if (!imageData) {
      return;
    }

    this.redoStack.push(this.ctx.getImageData(0, 0, this.canvasEl.width, this.canvasEl.height));
    this.ctx.putImageData(imageData, 0, 0);
    this.contentModified = true;
    this.refreshWidthStep();
  }

  private redo(): void {
    if (!this.ctx) {
      return;
    }

    const imageData = this.redoStack.pop();
    if (!imageData) {
      return;
    }

    this.undoStack.push(this.ctx.getImageData(0, 0, this.canvasEl.width, this.canvasEl.height));
    this.ctx.putImageData(imageData, 0, 0);
    this.contentModified = true;
    this.refreshWidthStep();
  }

  private clear(): void {
    if (!this.ctx) {
      return;
    }

    this.pushUndo();
    this.redoStack = [];
    this.contentModified = true;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    this.refreshWidthStep();
  }

  private async renameFromInput(): Promise<void> {
    if (!this.nameInputEl) {
      return;
    }

    const nextName = this.nameInputEl.value.trim();
    if (!nextName || nextName === this.fileService.getDisplayName(this.file)) {
      this.nameInputEl.value = this.fileService.getDisplayName(this.file);
      return;
    }

    this.file = await this.fileService.renameInkFile(this.file, nextName);
    this.nameInputEl.value = this.fileService.getDisplayName(this.file);
    this.options.onSave?.(this.file);
  }

  private async save(): Promise<void> {
    if (!this.ctx) {
      return;
    }

    await this.renameFromInput();
    this.forceGrayscaleOpaque();

    const step = this.currentWidthStep();
    const data = await canvasToPngArrayBuffer(this.exportCanvas(step));
    await this.fileService.writeBinary(this.file, data);
    this.loadedStep = step;
    this.contentModified = false;
    this.hasSaved = true;
    this.options.onSave?.(this.file);
    new Notice(`Saved inline ink: ${this.file.basename}`);
  }

  /**
   * Downsample the drawing surface to the file's export size (see
   * resolveExportSize), cropped to the centered band of the given width step.
   * The source band uses exact fractional coordinates so it matches where
   * loadImage re-centers the file. Run after forceGrayscaleOpaque so the
   * margins are flat white.
   */
  private exportCanvas(step: WidthStep): HTMLCanvasElement {
    const out = document.createElement("canvas");
    const ctx = out.getContext("2d");
    if (!ctx) {
      return this.canvasEl;
    }

    const size = this.exportSize;
    const sourceWidth = SURFACE_SIZE * step;
    const sourceX = (SURFACE_SIZE - sourceWidth) / 2;
    out.width = Math.round(size * step);
    out.height = size;
    ctx.drawImage(this.canvasEl, sourceX, 0, sourceWidth, SURFACE_SIZE, 0, 0, out.width, size);

    return out;
  }

  /**
   * The width step the canvas would export at right now. While the drawing is
   * untouched since the last load or save, the step implied by the file's own
   * aspect ratio is kept as-is, so a plain reopen-and-save can never move a
   * borderline drawing to a neighboring step; once the user draws, erases, or
   * clears, the step is re-detected from the ink extent.
   */
  private currentWidthStep(): WidthStep {
    if (!this.contentModified && this.loadedStep !== null) {
      return this.loadedStep;
    }

    return snapWidthStep(this.measureInkHalfWidthFraction());
  }

  /**
   * The maximum horizontal distance of any ink pixel from the surface's
   * vertical center line, as a fraction of the square's width; 0 when blank.
   * Each pixel is composited over white exactly like forceGrayscaleOpaque so
   * detection matches before and after flattening.
   */
  private measureInkHalfWidthFraction(): number {
    const { data } = this.ctx.getImageData(0, 0, SURFACE_SIZE, SURFACE_SIZE);
    const center = SURFACE_SIZE / 2;
    let left = SURFACE_SIZE;
    let right = -1;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255;
      const gray =
        ((data[index] + data[index + 1] + data[index + 2]) / 3) * alpha + 255 * (1 - alpha);
      if (gray >= INK_THRESHOLD) {
        continue;
      }

      const x = (index / 4) % SURFACE_SIZE;
      if (x < left) {
        left = x;
      }
      if (x > right) {
        right = x;
      }
    }

    if (right < 0) {
      return 0;
    }

    return Math.max(center - left, right + 1 - center) / SURFACE_SIZE;
  }

  private async saveAndClose(): Promise<void> {
    await this.save();
    this.close();
  }

  private forceGrayscaleOpaque(): void {
    const imageData = this.ctx.getImageData(0, 0, this.canvasEl.width, this.canvasEl.height);
    const { data } = imageData;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255;
      const red = data[index] * alpha + 255 * (1 - alpha);
      const green = data[index + 1] * alpha + 255 * (1 - alpha);
      const blue = data[index + 2] * alpha + 255 * (1 - alpha);
      const gray = Math.round((red + green + blue) / 3);

      data[index] = gray;
      data[index + 1] = gray;
      data[index + 2] = gray;
      data[index + 3] = 255;
    }

    this.ctx.putImageData(imageData, 0, 0);
  }
}

function brushCursor(diameter: number, tool: InkTool): string {
  // A white halo under a thin black line keeps the outline readable on any
  // canvas color, since a static cursor image cannot invert the pixels below.
  const padding = 3;
  const size = Math.ceil(diameter) + padding * 2;
  const center = size / 2;
  const hotspot = Math.round(center);
  const radius = diameter / 2;
  const dash = tool === "eraser" ? ` stroke-dasharray="3 3"` : "";
  const circle = (stroke: string, width: number, extra = ""): string =>
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${stroke}" stroke-opacity="0.9" stroke-width="${width}"${extra}/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    circle("white", 3) +
    circle("black", 1, dash) +
    `</svg>`;

  return `url('data:image/svg+xml,${encodeURIComponent(svg)}') ${hotspot} ${hotspot}, crosshair`;
}
