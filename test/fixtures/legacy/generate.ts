// Writes synthetic files in the prototype's format, which Inkline must keep
// opening: opaque greyscale PNGs, dark ink on white, as tall as the
// prototype's stored size and as wide as one of its width steps. They are
// drawn here from a formula, never taken from anyone's vault. The script
// writes only files that do not exist yet.
//
//   node test/fixtures/legacy/generate.ts

import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodePng } from "../../support/png.ts";

/**
 * A thick antialiased line from (x0, y0) to (x1, y1), with the given radius,
 * in a prototype file of the given height and width step, scaled from a
 * drawing made on the default 192-pixel square.
 */
function prototypeFile(height: number, step: number): Uint8Array {
  const width = Math.round(height * step);
  const scale = height / 192;
  const [x0, y0, x1, y1, radius] = [30 * scale, 40 * scale, 85 * scale, 150 * scale, 6 * scale];
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const along = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
      const distance = Math.hypot(px - along * dx, py - along * dy);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance));
      const grey = Math.round(255 * (1 - coverage));
      data.set([grey, grey, grey, 255], (y * width + x) * 4);
    }
  }
  return encodePng({ width, height, data });
}

const files: Record<string, () => Uint8Array> = {
  // The default stored size, at the 0.6 width step.
  "prototype-192.ink.png": () => prototypeFile(192, 0.6),
  // A larger stored size the prototype allowed, at the 0.8 width step.
  "prototype-288.ink.png": () => prototypeFile(288, 0.8),
};

for (const [name, make] of Object.entries(files)) {
  const file = path.join(import.meta.dirname, name);
  const exists = await access(file).then(
    () => true,
    () => false,
  );
  if (exists) continue;
  await writeFile(file, make(), { flag: "wx" });
  console.log(`wrote ${name}`);
}
