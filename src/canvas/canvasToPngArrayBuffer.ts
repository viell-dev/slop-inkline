import { canvasToPngBlob } from "./canvasToPngBlob";

/**
 * Encode a canvas as a PNG and return the encoded bytes.
 *
 * @param canvas - The canvas to encode.
 * @returns The PNG bytes, ready for vault binary IO.
 */
export async function canvasToPngArrayBuffer(
  canvas: HTMLCanvasElement,
): Promise<ArrayBuffer> {
  const blob = await canvasToPngBlob(canvas);
  return blob.arrayBuffer();
}
