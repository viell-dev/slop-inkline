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
  const data = new Uint8ClampedArray(width * height * 4).fill(inkGrey);
  for (let index = 0; index < width * height; index++) {
    data[index * 4 + 3] = alpha[index] ?? 0;
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

/**
 * Each pixel's luminance, from 0 for black to 255 for white, with Rec. 709
 * weights on the stored values, as if the picture lay on white: a
 * transparent pixel counts as white, like the paper around dark ink.
 */
export function luminance(pixels: RgbaPixels): Uint8ClampedArray {
  const { width, height, data } = pixels;
  const values = new Uint8ClampedArray(width * height);
  for (let index = 0; index < values.length; index++) {
    const offset = index * 4;
    const alpha = (data[offset + 3] ?? 0) / 255;
    const own =
      0.2126 * (data[offset] ?? 0) +
      0.7152 * (data[offset + 1] ?? 0) +
      0.0722 * (data[offset + 2] ?? 0);
    values[index] = Math.round(own * alpha + 255 * (1 - alpha));
  }
  return values;
}

/**
 * The threshold that best splits `values` into dark and light, by Otsu's
 * method: the one that makes the two groups' means lie furthest apart,
 * weighted by their sizes. Values below it are dark. Where thresholds split
 * equally well, as all between two values with none in between do, the
 * middle one wins, so that the picture's edges ramp evenly across it. A
 * picture of one value throughout gives the middle, 128.
 */
export function otsuThreshold(values: Uint8ClampedArray): number {
  const counts = new Uint32Array(256);
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- for...of over a typed array is many times slower in V8
  for (let index = 0; index < values.length; index++) {
    const value = values[index] ?? 0;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  const total = values.length;
  let sum = 0;
  for (let value = 0; value < 256; value++) {
    sum += value * (counts[value] ?? 0);
  }
  let darkCount = 0;
  let darkSum = 0;
  let best = -1;
  let first = 128;
  let last = 128;
  for (let value = 0; value < 255; value++) {
    darkCount += counts[value] ?? 0;
    darkSum += value * (counts[value] ?? 0);
    const lightCount = total - darkCount;
    if (darkCount === 0 || lightCount === 0) continue;
    const apart = darkSum / darkCount - (sum - darkSum) / lightCount;
    const between = darkCount * lightCount * apart * apart;
    // Equal but for rounding, as across a run of empty values.
    const tie = 1e-9 * Math.max(1, best);
    if (between > best + tie) {
      best = between;
      first = value + 1;
      last = value + 1;
    } else if (between >= best - tie) {
      last = value + 1;
    }
  }
  return Math.round((first + last) / 2);
}

/**
 * Whether the ink in `values` is likely light on a dark ground, as in many
 * games' screenshots: whether more of it lies below `threshold` than at or
 * above it. Ink is the smaller part of a picture of a symbol.
 */
export function lightInk(
  values: Uint8ClampedArray,
  threshold: number,
): boolean {
  let dark = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- for...of over a typed array is many times slower in V8
  for (let index = 0; index < values.length; index++) {
    if ((values[index] ?? 0) < threshold) dark++;
  }
  return dark > values.length - dark;
}

/**
 * How many luminance levels a threshold's edge spans: pixels within half of
 * it from the threshold get part of an ink's alpha, so that the edges of a
 * picture's shapes stay as smooth as they were.
 */
export const thresholdEdge = 32;

/**
 * The thresholds the editor offers: half an edge past each end of the values,
 * so that one end leaves no ink and the other makes everything ink.
 */
export const thresholdRange = {
  min: -thresholdEdge / 2,
  max: 256 + thresholdEdge / 2,
} as const;

/**
 * The ink in `values` by a threshold, as one alpha per pixel: dark values
 * become ink, or light ones with `light`, full well past the threshold and
 * none well short of it, with a ramp of {@link thresholdEdge} levels across
 * it.
 */
export function thresholdAlpha(
  values: Uint8ClampedArray,
  threshold: number,
  light: boolean,
): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value++) {
    // The middle of the ramp lies halfway between the last dark level and
    // the threshold, the first light one.
    const past = light ? value - threshold + 0.5 : threshold - 0.5 - value;
    table[value] = Math.round((past / thresholdEdge + 0.5) * 255);
  }
  const alpha = new Uint8ClampedArray(values.length);
  for (let index = 0; index < values.length; index++) {
    alpha[index] = table[values[index] ?? 0] ?? 0;
  }
  return alpha;
}

/**
 * The smallest rectangle holding every value above zero in `alpha`, one
 * value per pixel of an image `width` pixels wide, if any is.
 */
export function alphaBounds(
  alpha: Uint8ClampedArray,
  width: number,
): Bounds | undefined {
  const height = width === 0 ? 0 : Math.floor(alpha.length / width);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((alpha[y * width + x] ?? 0) === 0) continue;
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

/** The part of `alpha`, `width` values a row, that `bounds` holds. */
export function cropAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  bounds: Bounds,
): Uint8ClampedArray {
  const across = bounds.right - bounds.left;
  const output = new Uint8ClampedArray(across * (bounds.bottom - bounds.top));
  for (let y = bounds.top; y < bounds.bottom; y++) {
    output.set(
      alpha.subarray(y * width + bounds.left, y * width + bounds.right),
      (y - bounds.top) * across,
    );
  }
  return output;
}

/** Where a picture sits in the document. */
export interface PicturePlace {
  /** Its left and top edges, in document pixels. */
  readonly x: number;
  readonly y: number;
  /** Document pixels per picture pixel. */
  readonly scale: number;
}

/** A picture's luminance, one value per pixel, as {@link luminance} gives. */
export interface Luminance {
  readonly width: number;
  readonly height: number;
  readonly values: Uint8ClampedArray;
  /**
   * Each pixel's own alpha, when any pixel is not fully opaque: its ink is
   * no more opaque than it is, so that a transparent ground stays empty.
   */
  readonly alpha?: Uint8ClampedArray;
}

/**
 * A picture's luminance and, when any pixel is not fully opaque, each
 * pixel's alpha, as {@link traceInk} takes them.
 */
export function pictureLuminance(pixels: RgbaPixels): Luminance {
  const { width, height, data } = pixels;
  const alpha = new Uint8ClampedArray(width * height);
  let opaque = true;
  for (let index = 0; index < alpha.length; index++) {
    const value = data[index * 4 + 3] ?? 0;
    alpha[index] = value;
    if (value !== 255) opaque = false;
  }
  const values = luminance(pixels);
  return opaque ? { width, height, values } : { width, height, values, alpha };
}

/**
 * The largest picture the preview traces, in pixels: a larger one is traced
 * from a smaller copy, which is still finer than the surface shows it.
 */
export const maxPreviewPixels = 1024 * 1024;

/**
 * How much smaller, across and down, the copy of a picture of `width` ×
 * `height` pixels that the preview traces is: 1 for one within
 * {@link maxPreviewPixels}.
 */
export function previewFactor(width: number, height: number): number {
  return Math.max(1, Math.ceil(Math.sqrt((width * height) / maxPreviewPixels)));
}

/**
 * `picture` made `factor` times smaller across and down, each value, and
 * alpha, the mean of the block it stands for; the blocks at the right and
 * bottom edges may be smaller.
 */
export function shrinkLuminance(picture: Luminance, factor: number): Luminance {
  if (factor <= 1) return picture;
  const width = Math.ceil(picture.width / factor);
  const height = Math.ceil(picture.height / factor);
  const shrink = (source: Uint8ClampedArray): Uint8ClampedArray => {
    const output = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y++) {
      const top = y * factor;
      const bottom = Math.min(picture.height, top + factor);
      for (let x = 0; x < width; x++) {
        const left = x * factor;
        const right = Math.min(picture.width, left + factor);
        let sum = 0;
        for (let row = top; row < bottom; row++) {
          for (let column = left; column < right; column++) {
            sum += source[row * picture.width + column] ?? 0;
          }
        }
        output[y * width + x] = Math.round(
          sum / ((bottom - top) * (right - left)),
        );
      }
    }
    return output;
  };
  const values = shrink(picture.values);
  return picture.alpha === undefined
    ? { width, height, values }
    : { width, height, values, alpha: shrink(picture.alpha) };
}

/**
 * Where to start making ink of part of a picture: the threshold by Otsu's
 * method, and whether the ink is light. On an opaque picture the ink is the
 * smaller part, as {@link lightInk} judges. Where the picture has
 * transparency, its fairly opaque pixels are the ink, and their own
 * luminance says whether it is light.
 */
export function inkDefaults(part: {
  readonly values: Uint8ClampedArray;
  readonly alpha?: Uint8ClampedArray;
}): { threshold: number; light: boolean } {
  const { values, alpha } = part;
  if (alpha === undefined) {
    const threshold = otsuThreshold(values);
    return { threshold, light: lightInk(values, threshold) };
  }
  let count = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- for...of over a typed array is many times slower in V8
  for (let index = 0; index < alpha.length; index++) {
    if ((alpha[index] ?? 0) >= 128) count++;
  }
  if (count === 0) {
    const threshold = otsuThreshold(values);
    return { threshold, light: lightInk(values, threshold) };
  }
  const ink = new Uint8ClampedArray(count);
  let at = 0;
  for (let index = 0; index < alpha.length; index++) {
    if ((alpha[index] ?? 0) >= 128) ink[at++] = values[index] ?? 0;
  }
  const threshold = otsuThreshold(ink);
  // The ink is all there is: light if most of it is.
  return { threshold, light: !lightInk(ink, threshold) };
}

/** Part of a picture's luminance, and where it starts in the picture. */
export interface Region {
  readonly values: Uint8ClampedArray;
  readonly alpha?: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

/**
 * The luminance of the part of a picture at `place` that lies within
 * `region`, in document pixels, by whole picture pixels, with where that
 * part's top left corner is in the picture; undefined when no part does.
 */
export function regionValues(
  picture: Luminance,
  place: PicturePlace,
  region: Bounds,
): Region | undefined {
  const { x, y, scale } = place;
  const left = Math.max(0, Math.floor((region.left - x) / scale));
  const right = Math.min(picture.width, Math.ceil((region.right - x) / scale));
  const top = Math.max(0, Math.floor((region.top - y) / scale));
  const bottom = Math.min(
    picture.height,
    Math.ceil((region.bottom - y) / scale),
  );
  if (right <= left || bottom <= top) return undefined;
  const width = right - left;
  const bounds = { left, top, right, bottom };
  const values = cropAlpha(picture.values, picture.width, bounds);
  const part = { values, width, height: bottom - top, left, top };
  return picture.alpha === undefined
    ? part
    : { ...part, alpha: cropAlpha(picture.alpha, picture.width, bounds) };
}

/** A picture's ink: one alpha per pixel of part of it, and where that is. */
export interface TracedInk {
  readonly alpha: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** The part's left and top edges, in document pixels. */
  readonly x: number;
  readonly y: number;
}

/**
 * The ink of a picture at `place` by a threshold, as {@link thresholdAlpha}
 * finds it, for the part of the picture that lies within `region`, in
 * document pixels, cropped to its ink; undefined when none is there.
 */
export function traceInk(
  picture: Luminance,
  place: PicturePlace,
  threshold: number,
  light: boolean,
  region: Bounds,
): TracedInk | undefined {
  const part = regionValues(picture, place, region);
  return part && traceRegion(part, place, threshold, light);
}

/**
 * The ink of `part` of a picture at `place`, as {@link traceInk} finds it:
 * for a threshold changing while the part stays the same.
 */
export function traceRegion(
  part: Region,
  place: PicturePlace,
  threshold: number,
  light: boolean,
): TracedInk | undefined {
  const alpha = thresholdAlpha(part.values, threshold, light);
  const own = part.alpha;
  if (own !== undefined) {
    for (let index = 0; index < alpha.length; index++) {
      alpha[index] = Math.round(
        ((alpha[index] ?? 0) * (own[index] ?? 0)) / 255,
      );
    }
  }
  const bounds = alphaBounds(alpha, part.width);
  if (bounds === undefined) return undefined;
  const { scale } = place;
  return {
    alpha: cropAlpha(alpha, part.width, bounds),
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
    x: place.x + (part.left + bounds.left) * scale,
    y: place.y + (part.top + bounds.top) * scale,
  };
}
