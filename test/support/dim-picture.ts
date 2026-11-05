// A synthetic dim screenshot, as of a game: thin light strokes on a dark
// ground, little contrast between them, soft edges, and a little noise.

/** The levels of a dim picture's ground and strokes, of 0 to 255. */
export const dimLevels = { ground: 8, ink: 50 } as const;

/** How much of the pixel at `at` lies between `from` and `to`. */
function overlap(from: number, to: number, at: number): number {
  return Math.max(0, Math.min(to, at + 1) - Math.max(from, at));
}

/** `values`, `side` a row, blurred by 1-2-1 across and down: σ of about 0.7. */
function soften(values: Float64Array, side: number): Float64Array {
  const pass = (source: Float64Array, step: number, limit: number) =>
    source.map((value, index) => {
      const along = step === 1 ? index % side : Math.floor(index / side);
      const before = source[along === 0 ? index : index - step] ?? 0;
      const after = source[along === limit ? index : index + step] ?? 0;
      return (before + 2 * value + after) / 4;
    });
  return pass(pass(values, 1, side - 1), side, side - 1);
}

/**
 * The luminance of a dim picture `side` pixels square: an H as tall as the
 * picture, its strokes an eighth of the picture wide. The noise repeats from
 * one call to the next.
 */
export function dimH(
  side: number,
  levels: { readonly ground: number; readonly ink: number } = dimLevels,
): Uint8ClampedArray {
  const stroke = side / 8;
  const stems = [side / 4, (side * 5) / 8];
  const bar = (side * 7) / 16;
  const shape = new Float64Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const inStems = stems.reduce(
        (sum, stem) => sum + overlap(stem, stem + stroke, x),
        0,
      );
      const across = overlap(side / 4, (side * 5) / 8 + stroke, x);
      const inBar = across * overlap(bar, bar + stroke, y);
      shape[y * side + x] = Math.max(inStems, inBar);
    }
  }
  const soft = soften(shape, side);
  const values = new Uint8ClampedArray(side * side);
  let seed = 1;
  for (let index = 0; index < values.length; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const noise = (seed % 3) - 1;
    const level = soft[index] ?? 0;
    values[index] =
      Math.round(levels.ground + (levels.ink - levels.ground) * level) + noise;
  }
  return values;
}

/**
 * A dim picture `side` pixels square with a label: a dim H within it, and a
 * small white block in a corner, as a screenshot of a game might have.
 */
export function labelledDimH(side: number): Uint8ClampedArray {
  const margin = Math.round(side / 16);
  const inner = side - 2 * margin;
  const glyph = dimH(inner);
  const values = new Uint8ClampedArray(side * side).fill(dimLevels.ground);
  for (let y = 0; y < inner; y++) {
    values.set(
      glyph.subarray(y * inner, (y + 1) * inner),
      (y + margin) * side + margin,
    );
  }
  const width = Math.round(side / 6);
  const height = Math.round(side / 10);
  for (let y = side - height; y < side; y++) {
    values.fill(255, y * side + side - width, (y + 1) * side);
  }
  return values;
}
