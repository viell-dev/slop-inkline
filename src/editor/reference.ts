// A picture to trace over, pasted or dropped into the editor, shown faintly
// under the drawing and never saved. Where it sits, and how moving and
// scaling it change that, is plain arithmetic, so that unit tests can check
// it; only decoding it needs the browser.

import { recordChunkType } from "../format/ink-file.ts";
import { PngError, readChunks } from "../format/png.ts";
import { lineBox, type Bounds } from "../ink/geometry.ts";

/** Where a picture sits in the document. */
export interface Placement {
  /** Its left and top edges, in document pixels. */
  readonly x: number;
  readonly y: number;
  /** Document pixels per picture pixel. */
  readonly scale: number;
}

/**
 * The scales a picture may take, in document pixels per picture pixel: from
 * a large screenshot shrunk to a dot, to a tiny one filling the surface.
 */
export const scaleLimits = { min: 1 / 64, max: 64 } as const;

/**
 * The largest picture kept, in pixels a side: a larger one is scaled down to
 * it, keeping its proportions, which still leaves more detail than the
 * surface shows.
 */
export const maxPictureSide = 4096;

function limited(scale: number): number {
  return Math.min(scaleLimits.max, Math.max(scaleLimits.min, scale));
}

/**
 * Where a picture of `width` × `height` pixels first sits within `area`, in
 * document pixels: at its own size, a document pixel to each of its pixels,
 * or scaled down, keeping its proportions, as far as fits a larger one in
 * the area. Its middle goes to `middle`, moved as little as keeps it inside
 * the area. The editor passes what the surface shows across, the line box's
 * height, and the point halfway between the font's cap height and baseline
 * in the middle of the surface, so that a small picture sits as a capital
 * letter would.
 */
export function placePicture(
  width: number,
  height: number,
  area: Bounds,
  middle: { readonly x: number; readonly y: number },
): Placement {
  const scale = limited(
    Math.min(
      1,
      (area.right - area.left) / Math.max(1, width),
      (area.bottom - area.top) / Math.max(1, height),
    ),
  );
  const within = (start: number, low: number, high: number): number =>
    Math.max(low, Math.min(start, high));
  return {
    x: within(
      middle.x - (width * scale) / 2,
      area.left,
      area.right - width * scale,
    ),
    y: within(
      middle.y - (height * scale) / 2,
      area.top,
      area.bottom - height * scale,
    ),
    scale,
  };
}

/**
 * Where a symbol's own image, `height` pixels tall, first sits: one line of
 * text tall, from the line box's top to its bottom, as every version of the
 * format shows it, which for its current version is a document pixel to each
 * of the image's, however wide it is; and from document x 0, where the image
 * starts in its own drawing, so that it lies over the strokes it shows.
 */
export function placeSymbolImage(height: number): Placement {
  return { x: 0, y: 0, scale: limited(lineBox.height / Math.max(1, height)) };
}

/**
 * Whether `bytes` are a symbol's own image: a PNG that holds a record chunk,
 * whatever the record in it holds, as every version of the format keeps its
 * record there. Bytes that are no PNG, or no well-formed one, hold none.
 */
export function isSymbolImage(bytes: Uint8Array): boolean {
  try {
    // Only whether the chunk is there counts, so no CRC is worked out but the
    // header's, which a large picture's chunks need not cost.
    return readChunks(bytes, () => false).some(
      (chunk) => chunk.type === recordChunkType,
    );
  } catch (error) {
    if (error instanceof PngError) return false;
    throw error;
  }
}

/** `placement` moved by `dx` and `dy` document pixels. */
export function movePicture(
  placement: Placement,
  dx: number,
  dy: number,
): Placement {
  return { ...placement, x: placement.x + dx, y: placement.y + dy };
}

/**
 * `placement` scaled by `factor` about the document point `x`, `y`, which
 * stays where it is on the picture. The scale stays within
 * {@link scaleLimits}, and the point stays put however much of `factor`
 * those allow.
 */
export function scalePicture(
  placement: Placement,
  factor: number,
  x: number,
  y: number,
): Placement {
  const scale = limited(placement.scale * factor);
  const applied = scale / placement.scale;
  return {
    x: x - (x - placement.x) * applied,
    y: y - (y - placement.y) * applied,
    scale,
  };
}

/**
 * `placement` of a picture of `width` × `height` pixels scaled by `factor`
 * about its own middle, which stays where it is, as {@link scalePicture}
 * keeps a point.
 */
export function scaleAboutMiddle(
  placement: Placement,
  width: number,
  height: number,
  factor: number,
): Placement {
  const { x, y, scale } = placement;
  return scalePicture(
    placement,
    factor,
    x + (width * scale) / 2,
    y + (height * scale) / 2,
  );
}

/** The wheel's `deltaMode` values, as a `WheelEvent` reports them. */
const linePixels = 100 / 3;
const pagePixels = 800;

/**
 * How many pixels the wheel turns to scale a picture by e: a wheel's notch,
 * about 100 pixels of `deltaY`, then scales it by about a twentieth, and
 * about 14 notches double it, for a fine choice of size.
 */
const wheelPixelsPerE = 2000;

/**
 * How much one turn of the wheel scales a picture: a wheel's notch, by about
 * a twentieth, up when it turns away. It goes by the pixels turned, so that a
 * trackpad's many small turns scale it smoothly, and turns scale it as much
 * as one turn of their total. `deltaMode` says whether `deltaY` counts
 * pixels, lines, or pages, as a `WheelEvent`'s does; a notch is three lines.
 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const pixels =
    deltaMode === 1
      ? deltaY * linePixels
      : deltaMode === 2
        ? deltaY * pagePixels
        : deltaY;
  return Math.exp(-pixels / wheelPixelsPerE);
}

/**
 * A size of `width` × `height` pixels scaled down, keeping its proportions,
 * to at most `max` pixels a side, in whole pixels of at least one; a size
 * that fits stays as it is.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const factor = Math.min(1, max / width, max / height);
  if (factor === 1) return { width, height };
  return {
    width: Math.max(1, Math.min(max, Math.round(width * factor))),
    height: Math.max(1, Math.min(max, Math.round(height * factor))),
  };
}

/**
 * Decodes a picture in any format the browser reads, such as a pasted
 * screenshot, scaled down to fit {@link maxPictureSide}. Rejects when the
 * browser cannot decode it.
 */
export async function decodePicture(picture: Blob): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(picture);
  const size = fitWithin(bitmap.width, bitmap.height, maxPictureSide);
  if (size.width === bitmap.width && size.height === bitmap.height) {
    return bitmap;
  }
  try {
    return await createImageBitmap(bitmap, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: "high",
    });
  } finally {
    bitmap.close();
  }
}

/** The file extensions of pictures the browser can decode to trace over. */
const pictureExtensions = /\.(?:png|jpe?g|gif|bmp|webp|avif)$/i;

/** Whether a vault path names a picture that can be traced over. */
export function isPicturePath(path: string): boolean {
  return pictureExtensions.test(path);
}

/**
 * The vault path that an `obsidian://open` link names, as Obsidian's file
 * explorer puts on a drag in a URI list, when it names a file in the vault
 * called `vault`; otherwise undefined. The first link of the list counts.
 */
export function openLinkPath(
  uriList: string,
  vault: string,
): string | undefined {
  const first = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("#"));
  // Read as text: Chromium before 130 parses no host from such a link.
  const query = /^obsidian:\/\/open\/?\?([^#]*)/i.exec(first ?? "")?.[1];
  if (query === undefined) return undefined;
  const params = new URLSearchParams(query);
  if (params.get("vault") !== vault) return undefined;
  return params.get("file") ?? undefined;
}
