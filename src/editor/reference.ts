// A picture to trace over, pasted or dropped into the editor, shown faintly
// under the drawing and never saved. Where it sits, and how moving and
// scaling it change that, is plain arithmetic, so that unit tests can check
// it.

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

/**
 * How much one turn of the wheel scales a picture: a wheel's notch, about
 * 100 pixels of `deltaY`, scales by about a fifth, up when it turns away.
 */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY / 500);
}
