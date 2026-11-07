// Encodes synthetic PNGs for tests and fixtures, independent of a browser's
// canvas. Pixels are 8-bit RGBA, or 8-bit grey with `grey: true`.

import { deflateSync, inflateSync } from "node:zlib";
import {
  imageHeader,
  readChunks,
  writeChunks,
  type Chunk,
} from "../../src/format/png.ts";

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

/** The predictor of PNG's Paeth filter. */
function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * The stored pixels of an 8-bit RGBA PNG, read without a canvas, whose
 * premultiplied alpha would hide a transparent pixel's colour.
 */
export function decodeRgba(bytes: Uint8Array): Pixels {
  const chunks = readChunks(bytes);
  const { width, height, bitDepth, colorType } = imageHeader(chunks);
  if (bitDepth !== 8 || colorType !== 6) throw new Error("not 8-bit RGBA");
  const raw = inflateSync(
    Buffer.concat(
      chunks.filter(({ type }) => type === "IDAT").map(({ data }) => data),
    ),
  );
  const stride = width * 4;
  const data = new Uint8Array(stride * height);
  const value = (at: number): number => data[at] ?? 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= 4 ? value(at - 4) : 0;
      const up = y > 0 ? value(at - stride) : 0;
      const upLeft = x >= 4 && y > 0 ? value(at - stride - 4) : 0;
      const predicted =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, upLeft)
                : 0;
      data[at] = ((raw[y * (stride + 1) + 1 + x] ?? 0) + predicted) & 0xff;
    }
  }
  return { width, height, data };
}
