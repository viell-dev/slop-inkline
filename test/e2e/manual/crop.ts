// Crops an 8-bit RGB or RGBA PNG, such as a screenshot or a rasterized PDF
// page, for looking at a symbol in it, optionally enlarged with square
// pixels. A tool for the #167 §2 investigation.
//
// node test/e2e/manual/crop.ts <in.png> <out.png> <x> <y> <width> <height> [enlarge]

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { imageHeader, readChunks } from "../../../src/format/png.ts";
import { encodePng } from "../../support/png.ts";

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

const [input, output, ...numbers] = process.argv.slice(2);
if (input === undefined || output === undefined) {
  throw new Error("usage: crop.ts in out x y width height [enlarge]");
}
const [x0 = 0, y0 = 0, w = 1, h = 1, enlarge = 1] = numbers.map(Number);
const chunks = readChunks(new Uint8Array(readFileSync(input)));
const { width, height, bitDepth, colorType } = imageHeader(chunks);
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
if (bitDepth !== 8 || channels === 0) throw new Error("not 8-bit RGB(A)");
const raw = inflateSync(
  Buffer.concat(
    chunks.filter(({ type }) => type === "IDAT").map(({ data }) => data),
  ),
);
const stride = width * channels;
const data = new Uint8Array(stride * height);
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  for (let x = 0; x < stride; x++) {
    const at = y * stride + x;
    const left = x >= channels ? (data[at - channels] ?? 0) : 0;
    const up = y > 0 ? (data[at - stride] ?? 0) : 0;
    const upLeft =
      x >= channels && y > 0 ? (data[at - stride - channels] ?? 0) : 0;
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
const outWidth = w * enlarge;
const outHeight = h * enlarge;
const out = new Uint8Array(outWidth * outHeight * 4);
for (let y = 0; y < outHeight; y++) {
  for (let x = 0; x < outWidth; x++) {
    const sx = Math.min(width - 1, x0 + Math.floor(x / enlarge));
    const sy = Math.min(height - 1, y0 + Math.floor(y / enlarge));
    const at = sy * stride + sx * channels;
    out.set(
      [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0, 255],
      (y * outWidth + x) * 4,
    );
  }
}
writeFileSync(
  output,
  encodePng({ width: outWidth, height: outHeight, data: out }),
);
