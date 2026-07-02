/**
 * Composite every pixel over white, convert it to grayscale, and force full
 * opacity, in place.
 *
 * @remarks
 * Run before exporting so the stored PNG is always an opaque grayscale
 * image regardless of how the strokes were composited.
 *
 * @param ctx - The 2D context of the canvas to flatten.
 */
export function flattenCanvasToGrayscale(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
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

  ctx.putImageData(imageData, 0, 0);
}
