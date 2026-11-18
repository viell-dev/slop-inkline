// What the editor's drawing area shows of a shape, kept in the renderer to
// compare a filled shape with the same shape unfilled, so that only counts
// of pixels cross to the test.

/** The alpha of each pixel of the drawing area, as kept. */
interface Kept {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8Array;
}

const kept = new Map<string, Kept>();

/** The drawing area's canvas in the editor open now. */
function surface(): HTMLCanvasElement {
  const canvas = activeDocument.querySelector(
    ".inkline-editor .inkline-surface",
  );
  if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
    throw new Error("no drawing area");
  }
  return canvas;
}

/**
 * Keeps the alpha of what the drawing area shows now under `name`, and
 * returns how many of its pixels show anything. With the guides and the grid
 * off, that is the ink.
 */
export function keepSurface(name: string): number {
  const canvas = surface();
  const { width, height } = canvas;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  const { data } = context.getImageData(0, 0, width, height);
  const alpha = new Uint8Array(width * height);
  let inked = 0;
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    const value = data[pixel * 4 + 3] ?? 0;
    alpha[pixel] = value;
    if (value > 0) inked++;
  }
  kept.set(name, { width, height, alpha });
  return inked;
}

function keptAs(name: string): Kept {
  const found = kept.get(name);
  if (found === undefined) throw new Error(`nothing kept as ${name}`);
  return found;
}

/** Two kept views of the drawing area, which must be the same size. */
function pair(a: string, b: string): readonly [Kept, Kept] {
  const first = keptAs(a);
  const second = keptAs(b);
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error("the drawing area changed size");
  }
  return [first, second];
}

/** How many pixels two kept views of the drawing area differ in. */
export function pixelsApart(a: string, b: string): number {
  const [first, second] = pair(a, b);
  let apart = 0;
  for (const [pixel, value] of first.alpha.entries()) {
    if (second.alpha[pixel] !== value) apart++;
  }
  return apart;
}

/**
 * The pixels of `kept` reached from `seeds` through those `passes` lets
 * through, each pixel's eight neighbours, corners too, being next to it: a
 * shape's partly covered edge pixels can meet only at a corner where it
 * comes to a point.
 */
function reached(
  { width, alpha }: Kept,
  seeds: readonly number[],
  passes: (value: number) => boolean,
): Uint8Array {
  const found = new Uint8Array(alpha.length);
  const queue: number[] = [];
  for (const seed of seeds) {
    if (found[seed] === 1 || !passes(alpha[seed] ?? 0)) continue;
    found[seed] = 1;
    queue.push(seed);
  }
  for (let pixel = queue.pop(); pixel !== undefined; pixel = queue.pop()) {
    const x = pixel % width;
    for (let dy = -width; dy <= width; dy += width) {
      for (let dx = x > 0 ? -1 : 0; dx <= (x < width - 1 ? 1 : 0); dx++) {
        const next = pixel + dy + dx;
        if (next < 0 || next >= alpha.length || found[next] === 1) continue;
        if (!passes(alpha[next] ?? 0)) continue;
        found[next] = 1;
        queue.push(next);
      }
    }
  }
  return found;
}

/** A pixel that compared wrongly: where it is, unfilled and filled. */
type Sample = readonly [x: number, y: number, before: number, after: number];

/** How a filled shape compares with the same shape unfilled. */
export interface ShapeComparison {
  /**
   * The pixels inside the unfilled shape's line, its partly covered inner
   * edge included, and how many of them the filled shape does not show as
   * the line's middle is: fully inked for the pen, or with nothing left for
   * the eraser.
   */
  readonly within: number;
  readonly withinUnlike: number;
  /**
   * The pixels of the line itself, between those within and those outside,
   * and how many of them the filled shape shows with less of what the line
   * does there: less ink for the pen, more for the eraser. Its middle is
   * already all it can be, but a seam where its pieces meet need not be.
   */
  readonly line: number;
  readonly lineLess: number;
  /**
   * The pixels outside the line, its partly covered outer edge included, and
   * how many of them the two show differently.
   */
  readonly outside: number;
  readonly outsideApart: number;
  /** Of the pixels outside, those partly inked, as along the outer edge. */
  readonly edge: number;
  /** The alpha at the point given as inside the shape, unfilled and filled. */
  readonly middle: readonly [number, number];
  /** Up to five pixels that compared wrongly, for a failure to show. */
  readonly samples: readonly Sample[];
}

/**
 * Compares the drawing area kept as `filled` with the same shape kept as
 * `unfilled`, drawn with `tool`; `inside` is a point inside the shape's line,
 * as fractions of the area's width and height.
 *
 * Along its middle, the pen's line is fully inked, and the eraser's leaves
 * nothing. So for the pen, what lies inside is all that `inside` reaches
 * through pixels not fully inked, and what lies outside is all that the
 * area's sides reach through them. The eraser's shape is drawn on ink, so
 * what lies inside it is all that `inside` reaches through pixels with ink,
 * and everything else counts as outside.
 */
export function compareFill(
  unfilled: string,
  filled: string,
  tool: "pen" | "eraser",
  inside: readonly [number, number],
): ShapeComparison {
  const [before, after] = pair(unfilled, filled);
  const { width, height } = before;
  const solid = tool === "pen" ? 255 : 0;
  const middle =
    Math.round(inside[1] * height) * width + Math.round(inside[0] * width);
  const open = (value: number): boolean => value !== solid;
  const within = reached(before, [middle], open);
  let outside: Uint8Array | undefined;
  if (tool === "pen") {
    const sides: number[] = [];
    for (let x = 0; x < width; x++) sides.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y++) {
      sides.push(y * width, y * width + width - 1);
    }
    outside = reached(before, sides, open);
  }
  const counts = {
    within: 0,
    withinUnlike: 0,
    line: 0,
    lineLess: 0,
    outside: 0,
    outsideApart: 0,
    edge: 0,
  };
  const samples: Sample[] = [];
  const sample = (pixel: number, value: number, now: number): void => {
    if (samples.length < 5) {
      samples.push([pixel % width, Math.floor(pixel / width), value, now]);
    }
  };
  for (const [pixel, value] of before.alpha.entries()) {
    const now = after.alpha[pixel] ?? 0;
    if (within[pixel] === 1) {
      counts.within++;
      if (now !== solid) {
        counts.withinUnlike++;
        sample(pixel, value, now);
      }
    } else if (outside === undefined || outside[pixel] === 1) {
      counts.outside++;
      if (now !== value) {
        counts.outsideApart++;
        sample(pixel, value, now);
      }
      if (value > 0 && value < 255) counts.edge++;
    } else {
      counts.line++;
      if (Math.abs(solid - now) > Math.abs(solid - value)) {
        counts.lineLess++;
        sample(pixel, value, now);
      }
    }
  }
  return {
    ...counts,
    middle: [before.alpha[middle] ?? 0, after.alpha[middle] ?? 0],
    samples,
  };
}
