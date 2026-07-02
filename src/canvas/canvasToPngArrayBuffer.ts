import { canvasToPngBlob } from "./canvasToPngBlob";

export async function canvasToPngArrayBuffer(
  canvas: HTMLCanvasElement,
): Promise<ArrayBuffer> {
  const blob = await canvasToPngBlob(canvas);
  return blob.arrayBuffer();
}
