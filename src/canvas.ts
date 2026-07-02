export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load ink image."));
    image.src = url;
  });
}

// The canvas bitmap is copied synchronously when toBlob is invoked, so the
// returned promise always resolves to the pixels as they were at call time,
// even if the canvas keeps changing while the PNG encodes in the background.
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

export async function canvasToPngArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await canvasToPngBlob(canvas);
  return blob.arrayBuffer();
}
