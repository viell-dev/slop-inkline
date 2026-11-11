// A preview of the dense test sign outside Obsidian, for the #167 §2
// investigation: it rasterizes the sign's strokes as round-capped lines in
// the 192-pixel line box, then shrinks that image by area averaging to the
// heights it would have in a 16-pixel line at 1x, 2x, 3x, 5x, and 8x on a
// display of one device pixel per CSS pixel, and enlarges each again with
// square pixels so that the result can be looked at. This is a simulation;
// what Obsidian shows is measured by scale-explore.e2e.ts.
//
// node test/e2e/manual/dense-preview.ts <output directory>

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodePng } from "../../support/png.ts";
import { brushS, denseCorners, lattice, type Point } from "./dense-glyph.ts";

const height = 192;
const width = 160;

function distance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length),
        );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Coverage of each pixel, 0 to 1, sampled 4 × 4 within it. */
function rasterize(): Float64Array {
  const cover = new Float64Array(width * height);
  const strokes = denseCorners();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let inside = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const p: Point = [x + (sx + 0.5) / 4, y + (sy + 0.5) / 4];
          const hit = strokes.some((corners) =>
            corners
              .slice(1)
              .some(
                (to, index) =>
                  distance(p, corners[index] ?? to, to) <= brushS / 2,
              ),
          );
          if (hit) inside++;
        }
      }
      cover[y * width + x] = inside / 16;
    }
  }
  return cover;
}

/** Area-averaged reduction to `h` rows, keeping the proportions. */
function shrink(
  cover: Float64Array,
  h: number,
): { w: number; h: number; data: Float64Array } {
  const factor = height / h;
  const w = Math.max(1, Math.round(width / factor));
  const data = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let area = 0;
      const y0 = y * factor;
      const y1 = (y + 1) * factor;
      const x0 = x * factor;
      const x1 = (x + 1) * factor;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          if (sx >= width || sy >= height) continue;
          const a =
            (Math.min(sx + 1, x1) - Math.max(sx, x0)) *
            (Math.min(sy + 1, y1) - Math.max(sy, y0));
          sum += (cover[sy * width + sx] ?? 0) * a;
          area += a;
        }
      }
      data[y * w + x] = area > 0 ? sum / area : 0;
    }
  }
  return { w, h, data };
}

/** Line coverage minus gap coverage on the lattice's column. */
function contrast(cover: Float64Array, w: number, h: number): number {
  const scale = h / height;
  const x = Math.min(w - 1, Math.floor(lattice.column * scale));
  const at = (y: number): number =>
    cover[Math.min(h - 1, Math.floor(y * scale)) * w + x] ?? 0;
  const mean = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  return mean(lattice.lines.map(at)) - mean(lattice.gaps.map(at));
}

const out = path.resolve(process.argv[2] ?? "test-results/dense-preview");
mkdirSync(out, { recursive: true });
const cover = rasterize();
const report: Record<string, number> = {
  full: contrast(cover, width, height),
};
// Dark ink on white, each reduction enlarged to 192 rows with square pixels.
const sheet = { w: 0, parts: [] as { w: number; pixels: Uint8Array }[] };
for (const scale of [1, 2, 3, 5, 8]) {
  const h = Math.round(24 * scale);
  const small = shrink(cover, h);
  report[`${String(scale)}x`] = contrast(small.data, small.w, small.h);
  const factor = height / h;
  const w = Math.round(small.w * factor);
  const pixels = new Uint8Array(w * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w; x++) {
      const value =
        small.data[
          Math.min(small.h - 1, Math.floor(y / factor)) * small.w +
            Math.min(small.w - 1, Math.floor(x / factor))
        ] ?? 0;
      const grey = Math.round(255 - value * 255);
      pixels.set([grey, grey, grey, 255], (y * w + x) * 4);
    }
  }
  sheet.parts.push({ w, pixels });
  sheet.w += w + 8;
}
const data = new Uint8Array(sheet.w * height * 4).fill(255);
let left = 0;
for (const part of sheet.parts) {
  for (let y = 0; y < height; y++) {
    data.set(
      part.pixels.subarray(y * part.w * 4, (y + 1) * part.w * 4),
      (y * sheet.w + left) * 4,
    );
  }
  left += part.w + 8;
}
writeFileSync(
  path.join(out, "dense-simulated-1x-2x-3x-5x-8x.png"),
  encodePng({ width: sheet.w, height, data }),
);
writeFileSync(
  path.join(out, "dense-simulated.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
