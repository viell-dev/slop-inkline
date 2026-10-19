// The line box: the geometry every symbol is drawn in, which maps one image
// to one line of text. docs/file-format.md explains the values.

import type { Box } from "../format/record.ts";

/** The line box version 1 writes, in pixels: 1.5 em tall at 128 px per em. */
export const lineBox = {
  pxPerEm: 128,
  /** 1.5 em: Obsidian's default line height, so a symbol never widens it. */
  height: 192,
  /** 0.375 em above the bottom, below the default font's descenders. */
  baseline: 144,
} as const;

/** Space kept on each side of the ink when cropping: 1/16 em. */
export const sideBearing = 8;

/** The narrowest image, so that a dot stays easy to click: 3/8 em. */
export const minWidth = 48;

/** A rectangle in pixels; `right` and `bottom` lie just outside it. */
export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The horizontal crop for ink within `bounds`: the ink plus a side bearing
 * on each side, widened evenly to the minimum width, in whole pixels. With no
 * ink, the crop is the minimum width from 0.
 */
export function crop(bounds: Bounds | undefined): {
  left: number;
  width: number;
} {
  if (bounds === undefined) return { left: 0, width: minWidth };
  const left = Math.floor(bounds.left) - sideBearing;
  const right = Math.ceil(bounds.right) + sideBearing;
  const width = right - left;
  if (width >= minWidth) return { left, width };
  return { left: left - Math.floor((minWidth - width) / 2), width: minWidth };
}

/**
 * How to show an image with this box in text: its height in em, and the
 * `vertical-align` in em that puts its baseline on the text's.
 */
export function display(box: Box): {
  heightEm: number;
  verticalAlignEm: number;
} {
  return {
    heightEm: box.height / box.pxPerEm,
    verticalAlignEm: -(box.height - box.baseline) / box.pxPerEm,
  };
}
