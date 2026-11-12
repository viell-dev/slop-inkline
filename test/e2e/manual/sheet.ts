// Puts PNG screenshots side by side, each enlarged with square pixels to a
// common height, so that crops of one symbol at several sizes can be
// compared by eye. A tool for the #167 §2 investigation.
//
// node test/e2e/manual/sheet.ts <out.png> <height> <in.png>...

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

function decode(file: string): {
  width: number;
  height: number;
  rgb: Uint8Array;
} {
  const chunks = readChunks(new Uint8Array(readFileSync(file)));
  const { width, height, bitDepth, colorType } = imageHeader(chunks);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || channels === 0)
    throw new Error(`${file}: not 8-bit RGB(A)`);
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
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const a = channels === 4 ? (data[i * 4 + 3] ?? 255) / 255 : 1;
    for (let c = 0; c < 3; c++) {
      // Transparent pixels over white.
      rgb[i * 3 + c] = Math.round(
        (data[i * channels + c] ?? 0) * a + 255 * (1 - a),
      );
    }
  }
  return { width, height, rgb };
}

const [output, heightText, ...inputs] = process.argv.slice(2);
if (output === undefined || heightText === undefined) throw new Error("usage");
const target = Number(heightText);
const parts = inputs.map((file) => {
  const image = decode(file);
  const factor = target / image.height;
  return { image, factor, width: Math.round(image.width * factor) };
});
const gap = 12;
const width = parts.reduce((sum, part) => sum + part.width + gap, gap);
const data = new Uint8Array(width * target * 4).fill(255);
let left = gap;
for (const { image, factor, width: w } of parts) {
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x / factor));
      const sy = Math.min(image.height - 1, Math.floor(y / factor));
      const from = (sy * image.width + sx) * 3;
      data.set(
        [
          image.rgb[from] ?? 0,
          image.rgb[from + 1] ?? 0,
          image.rgb[from + 2] ?? 0,
          255,
        ],
        (y * width + left + x) * 4,
      );
    }
  }
  left += w + gap;
}
writeFileSync(output, encodePng({ width, height: target, data }));
