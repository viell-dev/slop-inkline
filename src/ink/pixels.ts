// Pixel rules that need no canvas: where the ink is, and how a picture's
// pixels become ink when a file without a record is opened.

import type { Bounds } from "./geometry.ts";
import { inkGrey } from "./render.ts";

/** Pixels as a canvas's `ImageData` holds them: RGBA, row by row. */
export interface RgbaPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** The smallest rectangle holding every pixel with any alpha, if any does. */
export function inkBounds(pixels: RgbaPixels): Bounds | undefined {
  const { width, height, data } = pixels;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right === -1
    ? undefined
    : { left, top, right: right + 1, bottom: bottom + 1 };
}

/**
 * The ink a picture holds, as one alpha value per pixel. A picture with any
 * transparency keeps its alpha. A fully opaque one, such as the prototype's
 * files or a screenshot, is dark ink on a light ground: its alpha is 255
 * minus its luminance, so white becomes empty and black full ink.
 */
export function inkAlpha(pixels: RgbaPixels): Uint8ClampedArray {
  const { width, height, data } = pixels;
  const alpha = new Uint8ClampedArray(width * height);
  let opaque = true;
  for (let index = 0; index < alpha.length; index++) {
    if ((data[index * 4 + 3] ?? 0) !== 255) {
      opaque = false;
      break;
    }
  }
  for (let index = 0; index < alpha.length; index++) {
    const offset = index * 4;
    if (opaque) {
      // Rec. 709 luminance weights on the stored values.
      const luminance =
        0.2126 * (data[offset] ?? 0) +
        0.7152 * (data[offset + 1] ?? 0) +
        0.0722 * (data[offset + 2] ?? 0);
      alpha[index] = 255 - Math.round(luminance);
    } else {
      alpha[index] = data[offset + 3] ?? 0;
    }
  }
  return alpha;
}

/** RGBA pixels of grey ink with the given alpha, ready to encode as PNG. */
export function inkPixels(
  width: number,
  height: number,
  alpha: Uint8ClampedArray,
): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data.set([inkGrey, inkGrey, inkGrey, alpha[index] ?? 0], index * 4);
  }
  return data;
}

/**
 * Repeats each pixel of a one-value-per-pixel image `factor` times across and
 * down, which enlarges it without changing what it shows.
 */
export function repeatPixels(
  values: Uint8ClampedArray,
  width: number,
  height: number,
  factor: number,
): Uint8ClampedArray {
  if (factor === 1) return values;
  const wide = width * factor;
  const output = new Uint8ClampedArray(wide * height * factor);
  for (let y = 0; y < height * factor; y++) {
    const source = Math.floor(y / factor) * width;
    for (let x = 0; x < wide; x++) {
      output[y * wide + x] = values[source + Math.floor(x / factor)] ?? 0;
    }
  }
  return output;
}
