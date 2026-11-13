// Measures a solid block of ink in a picture of the screen or of a page, to a
// fraction of a pixel, so that end-to-end tests can compare the shape a
// symbol shows in with the shape it was drawn in. Plain functions over RGBA
// pixels, for the renderer, where pictures are decoded, and for unit tests.

/** An RGB colour, each channel 0 to 255. */
export type Rgb = readonly [number, number, number];

/** Pixels row by row, 4 bytes each, as `ImageData` holds them. */
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

/** Whole pixels from `left` and `top`, up to `right` and `bottom`. */
export interface Region {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Where a block of ink lies in a picture, in pixels, and its colour. */
export interface Block {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
  /** The colour of the pixel at its middle. */
  readonly colour: Rgb;
}

/** `region`, cut to the picture. */
function within(pixels: Rgba, region: Region): Region {
  return {
    left: Math.max(0, Math.floor(region.left)),
    top: Math.max(0, Math.floor(region.top)),
    right: Math.min(pixels.width, Math.ceil(region.right)),
    bottom: Math.min(pixels.height, Math.ceil(region.bottom)),
  };
}

function colourAt(pixels: Rgba, x: number, y: number): Rgb {
  const at = (y * pixels.width + x) * 4;
  return [
    pixels.data[at] ?? 0,
    pixels.data[at + 1] ?? 0,
    pixels.data[at + 2] ?? 0,
  ];
}

/** The colour that most pixels in `region` have. */
export function commonColour(pixels: Rgba, region: Region): Rgb {
  const { left, top, right, bottom } = within(pixels, region);
  const counts = new Map<string, { colour: Rgb; count: number }>();
  let common: { colour: Rgb; count: number } = { colour: [0, 0, 0], count: 0 };
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const colour = colourAt(pixels, x, y);
      const key = colour.join();
      const entry = counts.get(key) ?? { colour, count: 0 };
      entry.count++;
      counts.set(key, entry);
      if (entry.count > common.count) common = entry;
    }
  }
  return common.colour;
}

/** The colour in `region` that lies furthest from `ground`. */
export function furthestColour(pixels: Rgba, region: Region, ground: Rgb): Rgb {
  const { left, top, right, bottom } = within(pixels, region);
  let furthest = ground;
  let distance = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const colour = colourAt(pixels, x, y);
      const away = colour.reduce(
        (sum, value, channel) => sum + (value - (ground[channel] ?? 0)) ** 2,
        0,
      );
      if (away > distance) {
        distance = away;
        furthest = colour;
      }
    }
  }
  return furthest;
}

/**
 * The block of `ink` on `ground` in `region`, or undefined if there is none.
 * Each pixel counts as the share of the way it lies from the ground's colour
 * to the ink's, so that a pixel the block's edge crosses counts in part. The
 * block's height is the ink it holds over the most any one row holds, which
 * is its width, and its width is the ink over the most any column holds; its
 * middle is where its ink balances. So the block must be a rectangle, alone
 * in the region.
 */
export function measureBlock(
  pixels: Rgba,
  region: Region,
  ground: Rgb,
  ink: Rgb,
): Block | undefined {
  const { left, top, right, bottom } = within(pixels, region);
  const step = ink.map((value, channel) => value - (ground[channel] ?? 0));
  const length = step.reduce((sum, value) => sum + value * value, 0);
  if (length === 0 || right <= left || bottom <= top) return undefined;
  const rows = new Float64Array(bottom - top);
  const columns = new Float64Array(right - left);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const colour = colourAt(pixels, x, y);
      const along = colour.reduce(
        (sum, value, channel) =>
          sum + (value - (ground[channel] ?? 0)) * (step[channel] ?? 0),
        0,
      );
      const share = Math.min(1, Math.max(0, along / length));
      rows[y - top] = (rows[y - top] ?? 0) + share;
      columns[x - left] = (columns[x - left] ?? 0) + share;
    }
  }
  const area = rows.reduce((sum, value) => sum + value, 0);
  if (area === 0) return undefined;
  /** Where the ink of `sums`, from `from`, balances. */
  const middle = (sums: Float64Array, from: number): number =>
    sums.reduce((sum, value, index) => sum + (from + index + 0.5) * value, 0) /
    area;
  const width = area / Math.max(...columns);
  const height = area / Math.max(...rows);
  const x = middle(columns, left);
  const y = middle(rows, top);
  return {
    left: x - width / 2,
    top: y - height / 2,
    right: x + width / 2,
    bottom: y + height / 2,
    width,
    height,
    colour: colourAt(pixels, Math.floor(x), Math.floor(y)),
  };
}
