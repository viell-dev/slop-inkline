// A picture to trace over, pasted or dropped into the editor, shown faintly
// under the drawing and never saved. Where it sits, and how moving and
// scaling it change that, is plain arithmetic, so that unit tests can check
// it; only decoding it needs the browser.

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
 * Where a picture of `width` × `height` pixels first sits: as tall as from
 * `top` to `bottom`, in document pixels, and centred on `centerX`. The
 * editor passes the font's cap height and baseline, so that the picture
 * reads as a capital letter would.
 */
export function placePicture(
  width: number,
  height: number,
  top: number,
  bottom: number,
  centerX: number,
): Placement {
  const scale = limited((bottom - top) / Math.max(1, height));
  return { x: centerX - (width * scale) / 2, y: top, scale };
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

/** The wheel's `deltaMode` values, as a `WheelEvent` reports them. */
const linePixels = 100 / 3;
const pagePixels = 800;

/**
 * How much one turn of the wheel scales a picture: a wheel's notch, about
 * 100 pixels of `deltaY`, scales by about a fifth, up when it turns away.
 * `deltaMode` says whether `deltaY` counts pixels, lines, or pages, as a
 * `WheelEvent`'s does; a notch is three lines.
 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const pixels =
    deltaMode === 1
      ? deltaY * linePixels
      : deltaMode === 2
        ? deltaY * pagePixels
        : deltaY;
  return Math.exp(-pixels / 500);
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
