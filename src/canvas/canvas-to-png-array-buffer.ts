import { canvasToPngBlob } from "./canvas-to-png-blob";

export async function canvasToPngArrayBuffer(
  canvas: HTMLCanvasElement,
): Promise<ArrayBuffer> {
  const blob = await canvasToPngBlob(canvas);
  return blob.arrayBuffer();
}
