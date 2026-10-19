// Encodes synthetic PNGs for tests and fixtures, independent of a browser's
// canvas. Pixels are 8-bit RGBA, or 8-bit grey with `grey: true`.

import { deflateSync } from "node:zlib";
import { writeChunks, type Chunk } from "../../src/format/png.ts";

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** `width × height` pixels, row by row, 4 bytes each (1 with `grey`). */
  readonly data: Uint8Array;
  readonly grey?: boolean;
}

export function header(width: number, height: number, grey = false): Chunk {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  // Bit depth 8; colour type 0 (grey) or 6 (RGBA); deflate; adaptive
  // filtering; no interlacing.
  data.set([8, grey ? 0 : 6, 0, 0, 0], 8);
  return { type: "IHDR", data };
}

/** The chunks of a PNG holding the pixels, with each row unfiltered. */
export function pixelChunks(pixels: Pixels): Chunk[] {
  const channels = pixels.grey === true ? 1 : 4;
  const stride = pixels.width * channels;
  if (pixels.data.length !== stride * pixels.height) {
    throw new Error("pixel data does not match the size");
  }
  const raw = new Uint8Array((stride + 1) * pixels.height);
  for (let row = 0; row < pixels.height; row++) {
    raw.set(
      pixels.data.subarray(row * stride, (row + 1) * stride),
      row * (stride + 1) + 1,
    );
  }
  return [
    header(pixels.width, pixels.height, pixels.grey),
    { type: "IDAT", data: new Uint8Array(deflateSync(raw, { level: 9 })) },
    { type: "IEND", data: new Uint8Array(0) },
  ];
}

export function encodePng(pixels: Pixels): Uint8Array {
  return writeChunks(pixelChunks(pixels));
}

/** A fully transparent RGBA image. */
export function blank(width: number, height: number): Pixels {
  return { width, height, data: new Uint8Array(width * height * 4) };
}
