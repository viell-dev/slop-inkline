import { App, ButtonComponent, Modal, Notice, TFile } from "obsidian";
import { InkFileService } from "./ink-file";

type InkTool = "pen" | "eraser";

interface Point {
  x: number;
  y: number;
}

export class InkEditorModal extends Modal {
  private canvasEl!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private tool: InkTool = "pen";
  private size = 8;
  private drawing = false;
  private lastPoint: Point | null = null;
  private undoStack: ImageData[] = [];
  private redoStack: ImageData[] = [];

  constructor(
    app: App,
    private readonly fileService: InkFileService,
    private readonly file: TFile,
    private readonly onSave?: (file: TFile) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("inkline-editor-modal");

    contentEl.createEl("h2", { text: this.file.basename });

    const toolbarEl = contentEl.createDiv({ cls: "inkline-editor-toolbar" });
    this.createToolButton(toolbarEl, "Pen", "pen");
    this.createToolButton(toolbarEl, "Eraser", "eraser");

    const sizeLabelEl = toolbarEl.createEl("label", { cls: "inkline-size-control" });
    sizeLabelEl.createSpan({ text: "Size" });
    const sizeInputEl = sizeLabelEl.createEl("input", {
      attr: {
        type: "range",
        min: "1",
        max: "48",
        value: this.size.toString(),
      },
    });
    sizeInputEl.addEventListener("input", () => {
      this.size = Number(sizeInputEl.value);
    });

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

    const canvasWrapEl = contentEl.createDiv({ cls: "inkline-canvas-wrap" });
    this.canvasEl = canvasWrapEl.createEl("canvas", { cls: "inkline-editor-canvas" });
    this.canvasEl.addEventListener("pointerdown", (event) => this.startStroke(event));
    this.canvasEl.addEventListener("pointermove", (event) => this.continueStroke(event));
    this.canvasEl.addEventListener("pointerup", (event) => this.endStroke(event));
    this.canvasEl.addEventListener("pointercancel", (event) => this.endStroke(event));

    void this.loadImage();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private createToolButton(parentEl: HTMLElement, label: string, tool: InkTool): void {
    new ButtonComponent(parentEl)
      .setButtonText(label)
      .onClick(() => {
        this.tool = tool;
      });
  }

  private async loadImage(): Promise<void> {
    const data = await this.fileService.readBinary(this.file);
    const blob = new Blob([data], { type: "image/png" });
    const url = URL.createObjectURL(blob);

    try {
      const image = await loadImage(url);
      this.canvasEl.width = image.naturalWidth || image.width;
      this.canvasEl.height = image.naturalHeight || image.height;

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

    if (this.undoStack.length > 50) {
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

  private async save(): Promise<void> {
    if (!this.ctx) {
      return;
    }

    this.forceGrayscaleOpaque();
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.canvasEl.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("Could not export PNG."));
        }
      }, "image/png");
    });

    await this.fileService.writeBinary(this.file, await blob.arrayBuffer());
    this.onSave?.(this.file);
    new Notice(`Saved inline ink: ${this.file.basename}`);
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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load ink image."));
    image.src = url;
  });
}
