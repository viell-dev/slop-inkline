import { App, ButtonComponent, Modal, Notice, TFile } from "obsidian";
import { canvasToPngArrayBuffer, loadImage } from "./canvas";
import { InkFileService } from "./ink-file";

type InkTool = "pen" | "eraser";

interface Point {
  x: number;
  y: number;
}

const BRUSH_SIZES = [10, 20, 30, 40];
const DEFAULT_PEN_SIZE = BRUSH_SIZES[0];
const MAX_UNDO_STEPS = 50;
const MAX_CANVAS_DISPLAY_WIDTH = 768;

interface InkEditorModalOptions {
  isNew?: boolean;
  onSave?: (file: TFile) => void;
  onDiscard?: (file: TFile) => void | Promise<void>;
}

export class InkEditorModal extends Modal {
  private nameInputEl!: HTMLInputElement;
  private canvasEl!: HTMLCanvasElement;
  private brushCursorEl!: HTMLElement;
  private ctx!: CanvasRenderingContext2D;
  private file: TFile;
  private tool: InkTool = "pen";
  private size = DEFAULT_PEN_SIZE;
  private drawing = false;
  private hasSaved = false;
  private lastPoint: Point | null = null;
  private lastClientPoint: Point | null = null;
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
    this.brushCursorEl = stageEl.createDiv({ cls: "inkline-brush-cursor" });
    this.canvasEl.addEventListener("pointerdown", (event) => this.startStroke(event));
    this.canvasEl.addEventListener("pointermove", (event) => this.continueStroke(event));
    this.canvasEl.addEventListener("pointerup", (event) => this.endStroke(event));
    this.canvasEl.addEventListener("pointercancel", (event) => this.endStroke(event));
    this.canvasEl.addEventListener("pointerenter", () => this.showBrushCursor());
    this.canvasEl.addEventListener("pointerleave", () => this.hideBrushCursor());
    this.canvasEl.addEventListener("pointermove", (event) => this.moveBrushCursor(event));

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
  }

  private setSize(size: number): void {
    this.size = size;
    this.updateSizeState();
    this.refreshBrushCursor();
  }

  private updateToolState(): void {
    for (const [tool, button] of this.toolButtons) {
      button.buttonEl.toggleClass("inkline-active", tool === this.tool);
    }
    this.brushCursorEl?.toggleClass("inkline-brush-cursor-eraser", this.tool === "eraser");
  }

  private updateSizeState(): void {
    for (const [size, button] of this.sizeButtons) {
      button.buttonEl.toggleClass("inkline-active", size === this.size);
    }
  }

  private showBrushCursor(): void {
    this.brushCursorEl.toggleClass("is-visible", true);
    this.refreshBrushCursor();
  }

  private hideBrushCursor(): void {
    this.brushCursorEl.toggleClass("is-visible", false);
  }

  private moveBrushCursor(event: PointerEvent): void {
    this.lastClientPoint = { x: event.clientX, y: event.clientY };
    this.refreshBrushCursor();
  }

  private refreshBrushCursor(): void {
    if (!this.lastClientPoint) {
      return;
    }

    const rect = this.canvasEl.getBoundingClientRect();
    const scale = this.canvasEl.width ? rect.width / this.canvasEl.width : 1;
    const diameter = this.size * scale;

    this.brushCursorEl.style.width = `${diameter}px`;
    this.brushCursorEl.style.height = `${diameter}px`;
    this.brushCursorEl.style.left = `${this.lastClientPoint.x - rect.left}px`;
    this.brushCursorEl.style.top = `${this.lastClientPoint.y - rect.top}px`;
  }

  private async loadImage(): Promise<void> {
    const data = await this.fileService.readBinary(this.file);
    const blob = new Blob([data], { type: "image/png" });
    const url = URL.createObjectURL(blob);

    try {
      const image = await loadImage(url);
      this.canvasEl.width = image.naturalWidth || image.width;
      this.canvasEl.height = image.naturalHeight || image.height;
      this.canvasEl.style.width = `${Math.min(this.canvasEl.width, MAX_CANVAS_DISPLAY_WIDTH)}px`;

      const ctx = this.canvasEl.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        throw new Error("Could not create a canvas rendering context.");
      }

      this.ctx = ctx;
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(0, 0, this.canvasEl.width, this.canvasEl.height);
      this.ctx.drawImage(image, 0, 0, this.canvasEl.width, this.canvasEl.height);
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

    const data = await canvasToPngArrayBuffer(this.canvasEl);
    await this.fileService.writeBinary(this.file, data);
    this.hasSaved = true;
    this.options.onSave?.(this.file);
    new Notice(`Saved inline ink: ${this.file.basename}`);
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
