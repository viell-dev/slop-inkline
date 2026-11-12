// A synthetic symbol near the format's widest, for the tests of a symbol
// wider than the space it is in: wide.e2e.ts on the screen, and pdf.e2e.ts
// in a native PDF.

import { encodePng } from "../../support/png.ts";

/**
 * Its size, 4,000 pixels wide, near the format's 4,096, and 192 tall, as
 * every symbol is, and its ink: an opaque grey block from x 8 to 3,992 and
 * from the top down to the baseline, y 144. It has no record, as a symbol
 * from elsewhere would not.
 */
export const wide: {
  readonly width: number;
  readonly height: number;
  readonly block: Readonly<Record<"left" | "top" | "right" | "bottom", number>>;
} = {
  width: 4000,
  height: 192,
  block: { left: 8, top: 0, right: 3992, bottom: 144 },
};

/** How many times wider than tall its block was drawn: 27.7. */
export const drawnRatio =
  (wide.block.right - wide.block.left) / (wide.block.bottom - wide.block.top);

/**
 * How wide it shows, without a size of its own, in text of `fontSize`
 * pixels at the symbol size `scale`, where nothing narrows it: 1.5 em tall
 * times that size, at its own proportions.
 */
export function fullWidth(fontSize: number, scale: number): number {
  return 1.5 * fontSize * scale * (wide.width / wide.height);
}

/** The symbol's file. */
export function widePng(): Uint8Array {
  const { width, height, block } = wide;
  const data = new Uint8Array(width * height * 4);
  for (let y = block.top; y < block.bottom; y++) {
    for (let x = block.left; x < block.right; x++) {
      data.set([126, 126, 126, 255], (y * width + x) * 4);
    }
  }
  return encodePng({ width, height, data });
}
