import { INK_THRESHOLD } from "../constants";

/**
 * The maximum horizontal distance of any ink pixel from the square surface's
 * vertical center line, as a fraction of the square's width; 0 when blank.
 * Each pixel is composited over white exactly like flattenCanvasToGrayscale
 * so detection matches before and after flattening.
 */
export function measureInkHalfWidthFraction(
  ctx: CanvasRenderingContext2D,
  size: number,
): number {
  const { data } = ctx.getImageData(0, 0, size, size);
  const center = size / 2;
  let left = size;
  let right = -1;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const gray =
      ((data[index] + data[index + 1] + data[index + 2]) / 3) * alpha +
      255 * (1 - alpha);
    if (gray >= INK_THRESHOLD) {
      continue;
    }

    const x = (index / 4) % size;
    if (x < left) {
      left = x;
    }
    if (x > right) {
      right = x;
    }
  }

  if (right < 0) {
    return 0;
  }

  return Math.max(center - left, right + 1 - center) / size;
}
