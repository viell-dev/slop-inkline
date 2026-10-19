import { describe, expect, it } from "vitest";
import type { Stroke } from "../../../src/format/record.ts";
import {
  drawInk,
  inkColor,
  inkGrey,
  type DrawableBase,
  type DrawingContext,
} from "../../../src/ink/render.ts";

/** A context that records what is drawn, for checking the order of work. */
class RecordingContext implements DrawingContext {
  calls: string[] = [];
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  beginPath(): void {
    this.calls.push("beginPath");
  }
  fill(): void {
    this.calls.push(
      `fill ${this.globalCompositeOperation} ${typeof this.fillStyle === "string" ? this.fillStyle : "pattern"}`,
    );
  }
  moveTo(): void {
    this.calls.push("moveTo");
  }
  quadraticCurveTo(): void {
    // Many per outline; not worth recording.
  }
  closePath(): void {
    this.calls.push("closePath");
  }
  drawImage(
    _image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.calls.push(
      `drawImage ${String(dx)} ${String(dy)} ${String(dw)} ${String(dh)} smooth=${String(this.imageSmoothingEnabled)} ${this.imageSmoothingQuality}`,
    );
  }
  save(): void {
    this.calls.push("save");
  }
  restore(): void {
    this.calls.push("restore");
  }
  translate(x: number, y: number): void {
    this.calls.push(`translate ${String(x)} ${String(y)}`);
  }
}

const pen: Stroke = {
  tool: "pen",
  size: 32,
  pressure: false,
  points: [16, 16],
};
const eraser: Stroke = { ...pen, tool: "eraser" };

describe("drawInk", () => {
  it("draws the base layer first, then each stroke in order", () => {
    const context = new RecordingContext();
    const base: DrawableBase = {
      x: 32,
      y: -16,
      scale: 2,
      width: 10,
      height: 5,
      // The recording context never looks at the image.
      image: {} as CanvasImageSource,
    };
    drawInk(context, [pen, eraser, pen], base, 7);
    expect(context.calls).toEqual([
      "save",
      "translate 7 0",
      "drawImage 2 -1 20 10 smooth=true high",
      "beginPath",
      "moveTo",
      "closePath",
      `fill source-over ${inkColor}`,
      "beginPath",
      "moveTo",
      "closePath",
      `fill destination-out ${inkColor}`,
      "beginPath",
      "moveTo",
      "closePath",
      `fill source-over ${inkColor}`,
      "restore",
    ]);
  });

  it("draws nothing but the state change for an empty drawing", () => {
    const context = new RecordingContext();
    drawInk(context, [], undefined);
    expect(context.calls).toEqual(["save", "translate 0 0", "restore"]);
  });
});

describe("inkGrey", () => {
  /** WCAG relative luminance of an sRGB grey or colour. */
  const luminance = (...channels: number[]): number => {
    const [r = 0, g = 0, b = 0] = channels.map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number, b: number): number =>
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const grey = luminance(inkGrey, inkGrey, inkGrey);

  it("matches the CSS colour", () => {
    expect(inkColor).toBe(`#${inkGrey.toString(16).repeat(3)}`);
  });

  it("has a contrast of at least 4:1 on white and on dark backgrounds", () => {
    expect(contrast(grey, luminance(255, 255, 255))).toBeGreaterThanOrEqual(4);
    // Obsidian's and GitHub's default dark backgrounds.
    expect(contrast(grey, luminance(0x1e, 0x1e, 0x1e))).toBeGreaterThanOrEqual(
      4,
    );
    expect(contrast(grey, luminance(0x0d, 0x11, 0x17))).toBeGreaterThanOrEqual(
      4,
    );
  });
});
