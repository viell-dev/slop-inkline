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
  lineTo(): void {
    this.calls.push("lineTo");
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
  rect(x: number, y: number, width: number, height: number): void {
    this.calls.push(
      `rect ${String(x)} ${String(y)} ${String(width)} ${String(height)}`,
    );
  }
  clip(fillRule: CanvasFillRule): void {
    this.calls.push(`clip ${fillRule}`);
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

  it("draws a cut stroke with its cut boxes clipped away, and only that one", () => {
    const context = new RecordingContext();
    // Down a 2 px brush from (1, 1) to (1, 3) px, cut at both ends.
    const cut: Stroke = {
      ...pen,
      points: [16, 16, 16, 48],
      cut: { start: "up", end: "down" },
    };
    drawInk(context, [cut, eraser], undefined);
    const everywhere = 2 ** 24;
    const all = `rect ${String(-everywhere)} ${String(-everywhere)} ${String(2 * everywhere)} ${String(2 * everywhere)}`;
    expect(context.calls).toEqual([
      "save",
      "translate 0 0",
      "save",
      "beginPath",
      all,
      // Above the start, 3 px each way: the brush's width and a pixel more.
      "rect -2 -2 6 3",
      "clip evenodd",
      "beginPath",
      all,
      "rect -2 3 6 3",
      "clip evenodd",
      "beginPath",
      "moveTo",
      "closePath",
      `fill source-over ${inkColor}`,
      "restore",
      "beginPath",
      "moveTo",
      "closePath",
      `fill destination-out ${inkColor}`,
      "restore",
    ]);
  });

  it("draws the rest of a long cut stroke in its cut boxes again", () => {
    const context = new RecordingContext();
    // Down a 2 px brush from (1, 1) to (1, 9) px, cut at its end only.
    const long: Stroke = {
      ...pen,
      points: [16, 16, 16, 144],
      cut: { end: "down" },
    };
    drawInk(context, [long], undefined);
    const everywhere = 2 ** 24;
    const all = `rect ${String(-everywhere)} ${String(-everywhere)} ${String(2 * everywhere)} ${String(2 * everywhere)}`;
    expect(context.calls).toEqual([
      "save",
      "translate 0 0",
      "save",
      "beginPath",
      all,
      "rect -2 9 6 3",
      "clip evenodd",
      "beginPath",
      "moveTo",
      "closePath",
      `fill source-over ${inkColor}`,
      "restore",
      // Its first point alone is more than 4 px from the cut end.
      "save",
      "beginPath",
      "rect -2 9 6 3",
      "clip nonzero",
      "beginPath",
      "moveTo",
      "closePath",
      `fill source-over ${inkColor}`,
      "restore",
      "restore",
    ]);
  });

  it("fills a polygon's pieces with straight sides, together, in one fill", () => {
    const context = new RecordingContext();
    // Right 1 px and down 1 px with a 2 px brush: two sides and a corner.
    const polygon: Stroke = {
      ...pen,
      points: [16, 16, 32, 16, 32, 32],
      kind: "polygon",
    };
    drawInk(context, [polygon], undefined);
    const side = ["moveTo", "lineTo", "lineTo", "lineTo", "closePath"];
    expect(context.calls).toEqual([
      "save",
      "translate 0 0",
      "beginPath",
      ...side,
      ...side,
      "moveTo",
      "lineTo",
      "lineTo",
      "lineTo",
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
