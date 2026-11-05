// Pixel rules that need no canvas: where the ink is, and how a picture's
// pixels become ink when a file without a record is opened.

import { limits } from "../format/record.ts";
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

/** How many of `values` there are of each level. */
function valueCounts(values: Uint8ClampedArray): Uint32Array {
  const counts = new Uint32Array(256);
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- for...of over a typed array is many times slower in V8
  for (let index = 0; index < values.length; index++) {
    const value = values[index] ?? 0;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/**
 * Otsu's split of the values from `from` up to `to`, by `counts` of each, as
 * {@link otsuThreshold} says; with how cleanly it splits them, from 0 to 1: the
 * share of their variance that lies between the two groups. Values of two
 * tones split at nearly 1, and noise or a gradient at about 0.75.
 */
function otsuSplit(
  counts: Uint32Array,
  from = 0,
  to = 256,
): { threshold: number; clean: number } {
  let total = 0;
  let sum = 0;
  let squares = 0;
  for (let value = from; value < to; value++) {
    const count = counts[value] ?? 0;
    total += count;
    sum += value * count;
    squares += value * value * count;
  }
  let darkCount = 0;
  let darkSum = 0;
  let best = -1;
  let first = 128;
  let last = 128;
  for (let value = from; value < to - 1; value++) {
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
  const variance = total * squares - sum * sum;
  return {
    threshold: Math.round((first + last) / 2),
    clean: best > 0 && variance > 0 ? best / variance : 0,
  };
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
  return otsuSplit(valueCounts(values)).threshold;
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
 * How many luminance levels a threshold's edge spans in a picture of black
 * and white: pixels within half of it from the threshold get part of an ink's
 * alpha, so that the edges of a picture's shapes stay as smooth as they were.
 * Less contrast narrows it, as {@link traceRegion} says.
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
 * none well short of it, with a ramp of `edge` levels across it,
 * {@link thresholdEdge} unless finer samples need a narrower one.
 */
export function thresholdAlpha(
  values: Uint8ClampedArray,
  threshold: number,
  light: boolean,
  edge = thresholdEdge,
): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value++) {
    // The middle of the ramp lies halfway between the last dark level and
    // the threshold, the first light one.
    const past = light ? value - threshold + 0.5 : threshold - 0.5 - value;
    table[value] = Math.round((past / edge + 0.5) * 255);
  }
  const alpha = new Uint8ClampedArray(values.length);
  for (let index = 0; index < values.length; index++) {
    alpha[index] = table[values[index] ?? 0] ?? 0;
  }
  return alpha;
}

/**
 * The middle one of the values from `from` up to `to`, by `counts` of each;
 * undefined when none lies there.
 */
function medianBetween(
  counts: Uint32Array,
  from: number,
  to: number,
): number | undefined {
  let total = 0;
  for (let value = from; value < to; value++) total += counts[value] ?? 0;
  let seen = 0;
  for (let value = from; value < to; value++) {
    seen += counts[value] ?? 0;
    if (total > 0 && seen * 2 >= total) return value;
  }
  return undefined;
}

/**
 * How far apart the two sides of `threshold` lie in `values`: the median of
 * those at or above it less the median of those below it, so that a few
 * bright pixels far from the shapes being traced count for little. With none
 * on one side, as for a threshold past all of them, the distance from the
 * threshold to the other side's median, so that moving it on past them fades
 * the ink rather than making more; 255 for no values. From 1 to 255.
 */
export function thresholdContrast(
  values: Uint8ClampedArray,
  threshold: number,
): number {
  const counts = valueCounts(values);
  const middle = Math.min(256, Math.max(0, Math.ceil(threshold)));
  const dark = medianBetween(counts, 0, middle);
  const light = medianBetween(counts, middle, 256);
  const apart =
    dark === undefined
      ? light === undefined
        ? 255
        : light - threshold
      : light === undefined
        ? threshold - dark
        : light - dark;
  return Math.min(255, Math.max(1, apart));
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

/** How opaque a pixel must be to count as part of what a picture shows. */
const fairlyOpaque = 128;

/**
 * How much of a part of a picture must be fairly opaque for it to have a
 * ground of its own, as {@link ownGround} says. A capture of a window has only
 * rounded corners or a shadow around it, while a glyph on a transparent ground
 * leaves much of its bounding box clear.
 */
const ownGroundShare = 2 / 3;

/** The `values` of the pixels that `alpha` says are fairly opaque. */
function fairlyOpaqueValues(
  values: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
): Uint8ClampedArray {
  let count = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- for...of over a typed array is many times slower in V8
  for (let index = 0; index < alpha.length; index++) {
    if ((alpha[index] ?? 0) >= fairlyOpaque) count++;
  }
  const solid = new Uint8ClampedArray(count);
  let at = 0;
  for (let index = 0; index < alpha.length; index++) {
    if ((alpha[index] ?? 0) >= fairlyOpaque) solid[at++] = values[index] ?? 0;
  }
  return solid;
}

/**
 * The fairly opaque ones of `values`, where those are so much of a part of a
 * picture that they hold its ground as well as its ink, as an opaque picture's
 * values do: its transparency lies only around it, as with the rounded corners
 * or the shadow of a window's capture. Undefined where the transparency is the
 * ground and they are all ink, as around a glyph.
 */
function ownGround(
  values: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
): Uint8ClampedArray | undefined {
  const solid = fairlyOpaqueValues(values, alpha);
  return solid.length >= alpha.length * ownGroundShare ? solid : undefined;
}

/**
 * A picture's luminance and, when any pixel is not fully opaque, each
 * pixel's alpha, as {@link traceInk} takes them. With alpha, the luminance
 * is each pixel's own colour's, not laid on white, since the alpha limits
 * the ink by itself: an anti-aliased edge is the glyph's colour, part
 * opaque.
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
  if (opaque) return { width, height, values: luminance(pixels) };
  const values = new Uint8ClampedArray(width * height);
  for (let index = 0; index < values.length; index++) {
    const offset = index * 4;
    values[index] = Math.round(
      0.2126 * (data[offset] ?? 0) +
        0.7152 * (data[offset + 1] ?? 0) +
        0.0722 * (data[offset + 2] ?? 0),
    );
  }
  return { width, height, values, alpha };
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
 * `picture` made `factor` times smaller across and down: each alpha the
 * mean of the block it stands for, and each value its mean, weighted by
 * alpha where there is any, so that a transparent pixel's colour counts for
 * nothing. The blocks at the right and bottom edges may be smaller.
 */
export function shrinkLuminance(picture: Luminance, factor: number): Luminance {
  if (factor <= 1) return picture;
  const width = Math.ceil(picture.width / factor);
  const height = Math.ceil(picture.height / factor);
  const own = picture.alpha;
  const values = new Uint8ClampedArray(width * height);
  const alpha =
    own === undefined ? undefined : new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const top = y * factor;
    const bottom = Math.min(picture.height, top + factor);
    for (let x = 0; x < width; x++) {
      const left = x * factor;
      const right = Math.min(picture.width, left + factor);
      let sum = 0;
      let weight = 0;
      for (let row = top; row < bottom; row++) {
        for (let column = left; column < right; column++) {
          const at = row * picture.width + column;
          const a = own === undefined ? 1 : (own[at] ?? 0);
          sum += (picture.values[at] ?? 0) * a;
          weight += a;
        }
      }
      const count = (bottom - top) * (right - left);
      values[y * width + x] = weight === 0 ? 0 : Math.round(sum / weight);
      if (alpha !== undefined)
        alpha[y * width + x] = Math.round(weight / count);
    }
  }
  return alpha === undefined
    ? { width, height, values }
    : { width, height, values, alpha };
}

/**
 * How small a share of a picture a part must be for {@link inkThreshold} to
 * ask whether it is only a label.
 */
const labelShare = 1 / 16;

/**
 * How cleanly the rest of a picture must split for {@link inkThreshold} to go
 * by that split, as {@link otsuSplit} measures it: more than its noise or a
 * gradient across it would.
 */
const cleanSplit = 0.8;

/**
 * How much further from a picture's middle a label lies on average than the
 * strokes it drew the threshold from, as {@link labelAside} measures it.
 */
const labelSpread = 1.5;

/**
 * How wide strokes are at most on average, as a share of the picture's shorter
 * side; a tone wider than that is a panel behind the ink.
 */
const strokeShare = 1 / 6;

/**
 * Whether the tone between thresholds `first` and `second` of a picture is
 * strokes with a label off to one side: `second` is the rest of the picture's
 * split, and the label the part beyond `first`. The picture is framed around
 * what is to be traced, so that a label lies further from its middle than the
 * strokes do, on average, measuring each axis by the picture's size. Strokes
 * are thin, which a panel behind a glyph is not, and at most one runs off the
 * picture, while a line behind a glyph runs through it, crossing its border
 * twice. Only the fairly opaque pixels count, where `alpha` is given.
 */
function labelAside(
  values: Uint8ClampedArray,
  width: number,
  alpha: Uint8ClampedArray | undefined,
  first: number,
  second: number,
): boolean {
  const height = values.length / width;
  const low = Math.min(first, second);
  const high = Math.max(first, second);
  const solid = (index: number) =>
    alpha === undefined || (alpha[index] ?? 0) >= fairlyOpaque;
  let labelCount = 0;
  let labelFar = 0;
  let toneCount = 0;
  let toneFar = 0;
  let toneOnBorder = 0;
  let labelEdges = 0;
  let toneEdges = 0;
  const pair = (value: number, index: number) => {
    if (!solid(index)) return;
    const other = values[index] ?? 0;
    if (value < first !== other < first) labelEdges++;
    if (value < second !== other < second) toneEdges++;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!solid(index)) continue;
      const value = values[index] ?? 0;
      const far =
        ((2 * x + 1) / width - 1) ** 2 + ((2 * y + 1) / height - 1) ** 2;
      if (value >= low && value < high) {
        toneCount++;
        toneFar += far;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          toneOnBorder++;
        }
      } else if (first > second ? value >= first : value < first) {
        labelCount++;
        labelFar += far;
      }
      if (x + 1 < width) pair(value, index + 1);
      if (y + 1 < height) pair(value, index + width);
    }
  }
  // Its edges at `second`, but for those it shares with the label.
  const outline = toneEdges - labelEdges;
  if (toneCount === 0 || labelCount === 0 || outline <= 0) return false;
  // A stroke's area is its width times half of its outline.
  const across = (2 * toneCount) / outline;
  return (
    across <= strokeShare * Math.min(width, height) &&
    toneOnBorder < 1.5 * across &&
    labelFar / labelCount >= (labelSpread * toneFar) / toneCount
  );
}

/**
 * The threshold to start from on a picture with a ground in its own values,
 * `width` a row, among the fairly opaque ones where `alpha` is given: Otsu's,
 * unless that only splits off a small label, far brighter or darker than the
 * strokes, which would leave them no ink. A few such pixels outweigh many
 * dim ones, as Otsu's method squares how far values lie apart. Then it is the
 * split of the rest of the picture, if that is clean, as {@link labelAside}
 * tells it from a small symbol on a ground of two tones.
 */
function inkThreshold(
  values: Uint8ClampedArray,
  width: number,
  alpha?: Uint8ClampedArray,
): number {
  const solid =
    alpha === undefined ? values : fairlyOpaqueValues(values, alpha);
  const counts = valueCounts(solid);
  const { threshold } = otsuSplit(counts);
  let dark = 0;
  for (let value = 0; value < threshold; value++) dark += counts[value] ?? 0;
  const light = solid.length - dark;
  if (Math.min(dark, light) >= solid.length * labelShare) return threshold;
  const rest =
    light < dark
      ? otsuSplit(counts, 0, threshold)
      : otsuSplit(counts, threshold);
  return rest.clean >= cleanSplit &&
    labelAside(values, width, alpha, threshold, rest.threshold)
    ? rest.threshold
    : threshold;
}

/**
 * Where to start making ink of part of a picture, `width` values a row: the
 * threshold, and whether the ink is light. On an opaque picture the threshold
 * is {@link inkThreshold}'s and the ink the smaller part, as {@link lightInk}
 * judges, and so among the fairly opaque pixels of a part with a ground of its
 * own, as {@link ownGround} says. Where the transparency is the ground, those
 * pixels are all ink: Otsu's method splits them, and their own luminance says
 * whether the ink is light.
 */
export function inkDefaults(part: {
  readonly values: Uint8ClampedArray;
  readonly width: number;
  readonly alpha?: Uint8ClampedArray;
}): { threshold: number; light: boolean } {
  const { values, width, alpha } = part;
  if (alpha === undefined) {
    const threshold = inkThreshold(values, width);
    return { threshold, light: lightInk(values, threshold) };
  }
  const ink = fairlyOpaqueValues(values, alpha);
  if (ink.length === 0) {
    const threshold = otsuThreshold(values);
    return { threshold, light: lightInk(values, threshold) };
  }
  let darkest = 255;
  let lightest = 0;
  let sum = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- for...of over a typed array is many times slower in V8
  for (let index = 0; index < ink.length; index++) {
    const value = ink[index] ?? 0;
    darkest = Math.min(darkest, value);
    lightest = Math.max(lightest, value);
    sum += value;
  }
  // Ink of nearly one value, as a glyph of one colour is: a threshold past
  // all of it on the far side makes it all full ink, rather than cutting
  // through it.
  if (lightest - darkest < thresholdEdge) {
    const light = sum / ink.length >= 128;
    return light
      ? {
          threshold: Math.max(thresholdRange.min, darkest - thresholdEdge / 2),
          light,
        }
      : {
          threshold: Math.min(
            thresholdRange.max,
            lightest + thresholdEdge / 2 + 1,
          ),
          light,
        };
  }
  if (ink.length >= alpha.length * ownGroundShare) {
    const threshold = inkThreshold(values, width, alpha);
    return { threshold, light: lightInk(ink, threshold) };
  }
  // The ink is all there is: light if most of it is.
  const threshold = otsuThreshold(ink);
  return { threshold, light: !lightInk(ink, threshold) };
}

/** Part of a picture's luminance, and where it starts in the picture. */
export interface Region {
  readonly values: Uint8ClampedArray;
  readonly alpha?: Uint8ClampedArray;
  /**
   * The picture's own values that say how much contrast this part has: its
   * pixels, where `values` are finer samples of them, which add values between
   * its tones, not more of them; and only the fairly opaque ones of a part
   * with transparency and a ground of its own, as {@link ownGround} says.
   */
  readonly tones?: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

/**
 * The picture pixels of a picture of `width` × `height` pixels at `place`
 * that lie within `region`, in document pixels, by whole picture pixels;
 * undefined when none do.
 */
export function regionBounds(
  width: number,
  height: number,
  place: PicturePlace,
  region: Bounds,
): Bounds | undefined {
  const { x, y, scale } = place;
  const left = Math.max(0, Math.floor((region.left - x) / scale));
  const right = Math.min(width, Math.ceil((region.right - x) / scale));
  const top = Math.max(0, Math.floor((region.top - y) / scale));
  const bottom = Math.min(height, Math.ceil((region.bottom - y) / scale));
  if (right <= left || bottom <= top) return undefined;
  return { left, top, right, bottom };
}

/**
 * How much smaller a copy of a picture at `place` the preview should trace,
 * for the part of it within `region`: just enough that the part is within
 * {@link maxPreviewPixels}, and 1, the picture itself, when it is already,
 * so that a picture zoomed in on shows as finely as Apply makes it.
 */
export function previewShrink(
  width: number,
  height: number,
  place: PicturePlace,
  region: Bounds,
): number {
  const bounds = regionBounds(width, height, place, region);
  if (bounds === undefined) return 1;
  return previewFactor(bounds.right - bounds.left, bounds.bottom - bounds.top);
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
  const bounds = regionBounds(picture.width, picture.height, place, region);
  if (bounds === undefined) return undefined;
  const { left, top, right, bottom } = bounds;
  const width = right - left;
  const values = cropAlpha(picture.values, picture.width, bounds);
  const part = { values, width, height: bottom - top, left, top };
  if (picture.alpha === undefined) return part;
  const alpha = cropAlpha(picture.alpha, picture.width, bounds);
  const tones = ownGround(values, alpha);
  if (tones === undefined) return { ...part, alpha };
  return {
    ...part,
    alpha: alpha.map((value) => (value < fairlyOpaque ? 0 : value)),
    tones,
  };
}

/**
 * How many times finer, across and down, to sample the part of a picture of
 * `width` × `height` pixels at `place` that lies within `region` before
 * making ink of it: enough that a sample is no larger than a document pixel,
 * so that the ink of an enlarged picture has edges as sharp as the document
 * shows, not as soft as one of the picture's pixels. 1, the picture itself,
 * for a picture no larger than the document shows it, or where finer samples
 * would be more than {@link maxPreviewPixels} or more than a base layer
 * holds a side.
 */
export function enlargeFactor(
  width: number,
  height: number,
  place: PicturePlace,
  region: Bounds,
): number {
  if (place.scale <= 1) return 1;
  const bounds = regionBounds(width, height, place, region);
  if (bounds === undefined) return 1;
  const across = bounds.right - bounds.left;
  const down = bounds.bottom - bounds.top;
  return Math.max(
    1,
    Math.min(
      Math.ceil(place.scale),
      Math.floor(limits.baseSize / Math.max(across, down)),
      Math.floor(Math.sqrt(maxPreviewPixels / (across * down))),
    ),
  );
}

/**
 * For samples `from` up to `to` along a side of a picture `size` pixels
 * long, sampled `factor` times finer: the pixels on each side of each
 * sample's centre, the nearest edge pixel standing in past the picture's
 * ends, and how far the sample lies from the first towards the second.
 */
function samplesAlong(
  from: number,
  to: number,
  factor: number,
  size: number,
): { before: Int32Array; after: Int32Array; past: Float64Array } {
  const count = to - from;
  const before = new Int32Array(count);
  const after = new Int32Array(count);
  const past = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const at = (from + index + 0.5) / factor - 0.5;
    const whole = Math.floor(at);
    before[index] = Math.min(size - 1, Math.max(0, whole));
    after[index] = Math.min(size - 1, Math.max(0, whole + 1));
    past[index] = at - whole;
  }
  return { before, after, past };
}

/**
 * The part of `picture` at `place` that lies within `region`, as
 * {@link regionValues} gives it, but from samples `factor` times finer across
 * and down, with where those samples are and the threshold's ramp for them.
 * Each sample is between the four pixels around it, by how near it is to
 * each: its alpha theirs, and its value theirs weighted by alpha where there
 * is any, so that a transparent pixel's colour counts for nothing. Undefined
 * when no part is in `region`.
 */
export function enlargedRegion(
  picture: Luminance,
  place: PicturePlace,
  region: Bounds,
  factor: number,
): { part: Region; place: PicturePlace; edge: number } | undefined {
  const coarse = regionBounds(picture.width, picture.height, place, region);
  const fine = { ...place, scale: place.scale / factor };
  const bounds = regionBounds(
    picture.width * factor,
    picture.height * factor,
    fine,
    region,
  );
  if (coarse === undefined || bounds === undefined) return undefined;
  // Within the picture pixels the region holds, by which enlargeFactor
  // bounds the samples: dividing by the finer scale can round one past them.
  const left = Math.max(bounds.left, coarse.left * factor);
  const top = Math.max(bounds.top, coarse.top * factor);
  const right = Math.min(bounds.right, coarse.right * factor);
  const bottom = Math.min(bounds.bottom, coarse.bottom * factor);
  if (right <= left || bottom <= top) return undefined;
  const width = right - left;
  const height = bottom - top;
  const columns = samplesAlong(left, right, factor, picture.width);
  const rows = samplesAlong(top, bottom, factor, picture.height);
  const source = picture.values;
  const own = picture.alpha;
  const pixels = cropAlpha(source, picture.width, coarse);
  const tones =
    own === undefined
      ? pixels
      : ownGround(pixels, cropAlpha(own, picture.width, coarse));
  // Around a ground of its own, what is mostly clear is a shadow: left among
  // the samples, its colour would darken the ground's edge.
  const least = tones === undefined ? 0 : fairlyOpaque;
  const values = new Uint8ClampedArray(width * height);
  const alpha =
    own === undefined ? undefined : new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const upper = (rows.before[y] ?? 0) * picture.width;
    const lower = (rows.after[y] ?? 0) * picture.width;
    const down = rows.past[y] ?? 0;
    for (let x = 0; x < width; x++) {
      const across = columns.past[x] ?? 0;
      const near = columns.before[x] ?? 0;
      const far = columns.after[x] ?? 0;
      // Unrolled over the four pixels: this runs for up to a million samples.
      let a = (1 - across) * (1 - down);
      let b = across * (1 - down);
      let c = (1 - across) * down;
      let d = across * down;
      if (own !== undefined) {
        const opaqueA = own[upper + near] ?? 0;
        const opaqueB = own[upper + far] ?? 0;
        const opaqueC = own[lower + near] ?? 0;
        const opaqueD = own[lower + far] ?? 0;
        a *= opaqueA < least ? 0 : opaqueA;
        b *= opaqueB < least ? 0 : opaqueB;
        c *= opaqueC < least ? 0 : opaqueC;
        d *= opaqueD < least ? 0 : opaqueD;
      }
      const weight = a + b + c + d;
      const sum =
        a * (source[upper + near] ?? 0) +
        b * (source[upper + far] ?? 0) +
        c * (source[lower + near] ?? 0) +
        d * (source[lower + far] ?? 0);
      const at = y * width + x;
      values[at] = weight === 0 ? 0 : Math.round(sum / weight);
      if (alpha !== undefined) alpha[at] = Math.round(weight);
    }
  }
  const part = { values, width, height, left, top };
  const toned = tones === undefined ? part : { ...part, tones };
  return {
    part: alpha === undefined ? toned : { ...toned, alpha },
    place: fine,
    // Between two pixels' centres, values change by at most 255 over
    // `factor` samples: a ramp no wider than that keeps an edge to about one
    // sample, however much the picture is enlarged.
    edge: Math.min(thresholdEdge, 255 / factor),
  };
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
 * for a threshold changing while the part stays the same. `edge` is the
 * threshold's ramp in a picture of black and white. An opaque picture's ramp
 * is that share of its {@link thresholdContrast}, so that a dim picture's
 * edges are as sharp as a bright one's: the whole ramp would span most of the
 * levels between its ground and its ink, and leave their edges as soft as
 * they were. So is the ramp of a part with a ground of its own, by the contrast
 * of its {@link Region.tones}. A part whose ground is its transparency keeps
 * the whole ramp: its own alpha limits its edges, and its colours mean little
 * where that is low.
 */
export function traceRegion(
  part: Region,
  place: PicturePlace,
  threshold: number,
  light: boolean,
  edge = thresholdEdge,
): TracedInk | undefined {
  const own = part.alpha;
  const tones = own === undefined ? (part.tones ?? part.values) : part.tones;
  const ramp =
    tones === undefined
      ? edge
      : (edge * thresholdContrast(tones, threshold)) / 255;
  const alpha = thresholdAlpha(part.values, threshold, light, ramp);
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
