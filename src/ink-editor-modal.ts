import { App, ButtonComponent, Modal, Notice, TFile } from "obsidian";
import { canvasToPngArrayBuffer, loadImage } from "./canvas";
import { CANVAS_SIZE, InkFileService, NARROW_WIDTH } from "./ink-file";
import { computeInkLineLayout, InkLineLayout, parseDisplayHeightEm } from "./layout";

type InkTool = "pen" | "eraser";

interface Point {
  x: number;
  y: number;
}

const BRUSH_SIZES = [10, 20, 30, 40];
const DEFAULT_PEN_SIZE = BRUSH_SIZES[0];
const MAX_UNDO_STEPS = 50;
const MAX_CANVAS_DISPLAY_WIDTH = 768;

// Empty horizontal margin on each side of the centered narrow band.
const BAND_MARGIN = (CANVAS_SIZE - NARROW_WIDTH) / 2;
// Pixels darker than this (grayscale, on white) count as ink for band detection.
const INK_THRESHOLD = 250;

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
  private size = DEFAULT_PEN_SIZE;
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
    for (const size of BRUSH_SIZES) {
      this.createSizeButton(sizeGroupEl, size);
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

  private createSizeButton(parentEl: HTMLElement, size: number): void {
    const button = new ButtonComponent(parentEl)
      .setButtonText(`${size}`)
      .setTooltip(`Brush size ${size}px`)
      .onClick(() => this.setSize(size));
    this.sizeButtons.set(size, button);
  }

  private setTool(tool: InkTool): void {
    this.tool = tool;
    this.updateToolState();
    this.updateBrushCursorStyle();
  }

  private setSize(size: number): void {
    this.size = size;
    this.updateSizeState();
    this.updateBrushCursorStyle();
  }

  private updateToolState(): void {
    for (const [tool, button] of this.toolButtons) {
      button.buttonEl.toggleClass("inkline-active", tool === this.tool);
    }
  }

  private updateSizeState(): void {
    for (const [size, button] of this.sizeButtons) {
      button.buttonEl.toggleClass("inkline-active", size === this.size);
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
    const diameter = Math.max(this.size * scale, 1);
    this.canvasEl.style.cursor = brushCursor(diameter, this.tool);
  }

  /**
   * Corner crop-marks sitting just outside the canvas mark the narrow-band
   * cutoff (their inner edge is the cut line). Hovering a mark reveals the full
   * dashed cutoff lines. These are DOM only and never touch the exported PNG.
   */
  private buildCropGuides(stageEl: HTMLElement): void {
    const leftPercent = (BAND_MARGIN / CANVAS_SIZE) * 100;
    const guidesEl = stageEl.createDiv({ cls: "inkline-crop-guides" });
    guidesEl.style.setProperty("--inkline-crop-left", `${leftPercent}%`);
    guidesEl.style.setProperty("--inkline-crop-right", `${100 - leftPercent}%`);

    for (const corner of ["tl", "tr", "bl", "br"]) {
      guidesEl.createDiv({ cls: `inkline-crop-mark inkline-crop-mark-${corner}` });
    }

    guidesEl.createDiv({ cls: "inkline-crop-line inkline-crop-line-left" });
    guidesEl.createDiv({ cls: "inkline-crop-line inkline-crop-line-right" });
  }

  /**
   * Horizontal baseline and cap-line references on the left/right edges, with
   * the ascender/descender regions shaded on hover. Positions come from the
   * shared layout so they match how the image renders inline. DOM only.
   */
  private buildBaselineGuides(stageEl: HTMLElement): void {
    const layout = this.lineLayout();
    const guidesEl = stageEl.createDiv({ cls: "inkline-baseline-guides" });
    guidesEl.style.setProperty("--inkline-capline", `${(layout.capLineY / CANVAS_SIZE) * 100}%`);
    guidesEl.style.setProperty("--inkline-baseline", `${(layout.baselineY / CANVAS_SIZE) * 100}%`);

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
      this.canvasEl.width = CANVAS_SIZE;
      this.canvasEl.height = CANVAS_SIZE;
      this.canvasEl.style.width = `${Math.min(CANVAS_SIZE, MAX_CANVAS_DISPLAY_WIDTH)}px`;

      const ctx = this.canvasEl.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        throw new Error("Could not create a canvas rendering context.");
      }

      this.ctx = ctx;
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Always edit on the square. A previously cropped (narrow) file is scaled
      // to the canvas height and re-centered into the band so editing continues.
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (sourceWidth > 0 && sourceHeight > 0) {
        const drawWidth = Math.min((sourceWidth / sourceHeight) * CANVAS_SIZE, CANVAS_SIZE);
        const offsetX = Math.round((CANVAS_SIZE - drawWidth) / 2);
        this.ctx.drawImage(image, offsetX, 0, drawWidth, CANVAS_SIZE);
      }

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
  }

  private drawLine(from: Point, to: Point): void {
    this.ctx.save();
    this.ctx.strokeStyle = this.tool === "pen" ? "#000000" : "#ffffff";
    this.ctx.lineWidth = this.size;
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
  }

  private clear(): void {
    if (!this.ctx) {
      return;
    }

    this.pushUndo();
    this.redoStack = [];
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.canvasEl.width, this.canvasEl.height);
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

    const data = await canvasToPngArrayBuffer(this.exportCanvas());
    await this.fileService.writeBinary(this.file, data);
    this.hasSaved = true;
    this.options.onSave?.(this.file);
    new Notice(`Saved inline ink: ${this.file.basename}`);
  }

  /**
   * Export the full square, or just the centered narrow band when all ink stays
   * inside it. Run after forceGrayscaleOpaque so the margins are flat white.
   */
  private exportCanvas(): HTMLCanvasElement {
    const bandEnd = CANVAS_SIZE - BAND_MARGIN;
    if (this.hasInkInColumns(0, BAND_MARGIN) || this.hasInkInColumns(bandEnd, CANVAS_SIZE)) {
      return this.canvasEl;
    }

    const cropped = document.createElement("canvas");
    cropped.width = NARROW_WIDTH;
    cropped.height = CANVAS_SIZE;

    const ctx = cropped.getContext("2d");
    if (!ctx) {
      return this.canvasEl;
    }

    ctx.drawImage(this.canvasEl, BAND_MARGIN, 0, NARROW_WIDTH, CANVAS_SIZE, 0, 0, NARROW_WIDTH, CANVAS_SIZE);
    return cropped;
  }

  private hasInkInColumns(startX: number, endX: number): boolean {
    if (endX <= startX) {
      return false;
    }

    const { data } = this.ctx.getImageData(startX, 0, endX - startX, CANVAS_SIZE);
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < INK_THRESHOLD) {
        return true;
      }
    }

    return false;
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
