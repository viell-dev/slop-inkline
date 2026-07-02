/**
 * Encode a canvas as a PNG blob.
 *
 * @remarks
 * The canvas bitmap is copied synchronously when `toBlob` is invoked, so
 * the returned promise always resolves to the pixels as they were at call
 * time, even if the canvas keeps changing while the PNG encodes in the
 * background.
 *
 * @param canvas - The canvas to encode.
 * @returns The encoded PNG; rejects when the browser cannot produce one.
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("Could not export PNG."));
      }
    }, "image/png");
  });
}
