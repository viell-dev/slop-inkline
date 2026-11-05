// Synthetic pictures for measuring how Make ink starts. Each holds strokes of a
// known shape, so that the ink made of it can be compared with what it should
// be. measure-ink.ts prints the results, and test/unit/ink/defaults.test.ts
// holds the code to them.

import type { Bounds } from "../../src/ink/geometry.ts";
import type {
  Luminance,
  PicturePlace,
  Region,
  RgbaPixels,
  TracedInk,
} from "../../src/ink/pixels.ts";

/** A straight stroke, from one point to another. */
export type Stroke = readonly [number, number, number, number];

/** A rectangle of one level. */
export interface Patch {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly level: number;
}

/** A picture, and what should become of it. */
export interface InkPicture extends RgbaPixels {
  readonly name: string;
  /** The kind of picture it is, which the results are grouped by. */
  readonly kind: string;
  /** 1 for each pixel that should become ink. */
  readonly wanted: Uint8Array;
  /** 1 for each pixel that may or may not, as a label's do. */
  readonly either: Uint8Array;
}

interface Scene {
  readonly name: string;
  readonly kind: string;
  readonly width: number;
  readonly height: number;
  /** The ground's level, throughout or at each pixel. */
  readonly ground: number | ((x: number, y: number) => number);
  /** The level of `strokes`, which are `thick` pixels wide. */
  readonly ink: number;
  readonly strokes: readonly Stroke[];
  readonly thick: number;
  /** How many times the strokes are blurred, by 1-2-1 across and down. */
  readonly soft?: number;
  /** How many levels of noise there are, each way. */
  readonly noise?: number;
  /** Other things on top, which are not what is being traced. */
  readonly blocks?: readonly Patch[];
  readonly label?: {
    readonly strokes: readonly Stroke[];
    readonly thick: number;
    readonly level: number;
  };
  readonly seed?: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function strokeDistance(x: number, y: number, stroke: Stroke): number {
  const [fromX, fromY, toX, toY] = stroke;
  const acrossX = toX - fromX;
  const acrossY = toY - fromY;
  const length = acrossX * acrossX + acrossY * acrossY;
  const along =
    length === 0
      ? 0
      : clamp(((x - fromX) * acrossX + (y - fromY) * acrossY) / length, 0, 1);
  return Math.hypot(x - fromX - along * acrossX, y - fromY - along * acrossY);
}

/** How much of each pixel `strokes` of `thick` pixels cover. */
function coverage(
  width: number,
  height: number,
  strokes: readonly Stroke[],
  thick: number,
): Float64Array {
  const covered = new Float64Array(width * height);
  for (const stroke of strokes) {
    // Only near the stroke: most of a picture is far from any one of them.
    const reach = thick / 2 + 1;
    const left = Math.floor(Math.min(stroke[0], stroke[2]) - reach);
    const right = Math.ceil(Math.max(stroke[0], stroke[2]) + reach);
    const top = Math.floor(Math.min(stroke[1], stroke[3]) - reach);
    const bottom = Math.ceil(Math.max(stroke[1], stroke[3]) + reach);
    for (let y = Math.max(0, top); y < Math.min(height, bottom); y++) {
      for (let x = Math.max(0, left); x < Math.min(width, right); x++) {
        const distance = strokeDistance(x + 0.5, y + 0.5, stroke);
        const here = clamp(thick / 2 - distance + 0.5, 0, 1);
        covered[y * width + x] = Math.max(covered[y * width + x] ?? 0, here);
      }
    }
  }
  return covered;
}

/** `values` blurred by 1-2-1 across and down, `times` times. */
function soften(
  values: Float64Array,
  width: number,
  height: number,
  times: number,
): Float64Array {
  let soft = values;
  const blur = (source: Float64Array, step: number, along: number) =>
    source.map((value, index) => {
      const at = step === 1 ? index % width : Math.floor(index / width);
      const before = source[at === 0 ? index : index - step] ?? 0;
      const after = source[at === along - 1 ? index : index + step] ?? 0;
      return (before + 2 * value + after) / 4;
    });
  for (let time = 0; time < times; time++) {
    soft = blur(blur(soft, 1, width), width, height);
  }
  return soft;
}

/** Repeatable random numbers from 0 up to 1, by mulberry32. */
export function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function inPatch(patch: Patch, x: number, y: number): boolean {
  return (
    x >= patch.x &&
    x < patch.x + patch.width &&
    y >= patch.y &&
    y < patch.y + patch.height
  );
}

/** The picture of a scene, opaque. */
function drawn(scene: Scene): InkPicture {
  const { width, height, ground, ink } = scene;
  const hard = coverage(width, height, scene.strokes, scene.thick);
  const shape = soften(hard, width, height, scene.soft ?? 0);
  const label =
    scene.label === undefined
      ? undefined
      : coverage(width, height, scene.label.strokes, scene.label.thick);
  const wanted = new Uint8Array(width * height);
  const either = new Uint8Array(width * height);
  const noise = scene.noise ?? 0;
  const random = randomFrom(scene.seed ?? 1);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const under = typeof ground === "number" ? ground : ground(x, y);
      let level = under + (ink - under) * (shape[at] ?? 0);
      wanted[at] = (hard[at] ?? 0) >= 0.5 ? 1 : 0;
      const labelled = label?.[at] ?? 0;
      if (labelled > 0 && scene.label !== undefined) {
        level += (scene.label.level - level) * labelled;
        wanted[at] = 0;
        either[at] = 1;
      }
      for (const block of scene.blocks ?? []) {
        if (inPatch(block, x, y)) {
          level = block.level;
          wanted[at] = 0;
          either[at] = 1;
        }
      }
      const noisy = (random() * 2 - 1) * noise;
      data.fill(clamp(Math.round(level + noisy), 0, 255), at * 4, at * 4 + 3);
      data[at * 4 + 3] = 255;
    }
  }
  const { name, kind } = scene;
  return { name, kind, width, height, data, wanted, either };
}

interface Glyph {
  readonly name: string;
  readonly kind: string;
  readonly width: number;
  readonly height: number;
  /** Its level, throughout or at each pixel. */
  readonly colour: number | ((x: number, y: number) => number);
  readonly soft?: number;
  readonly opacity?: number;
}

/** A glyph of strokes on a transparent ground: its shape is its alpha. */
function clearGlyph(
  glyph: Glyph & {
    readonly strokes: readonly Stroke[];
    readonly thick: number;
  },
): InkPicture {
  const { width, height } = glyph;
  return alphaGlyph(glyph, coverage(width, height, glyph.strokes, glyph.thick));
}

/** A glyph of any `shape`, which gives each pixel's alpha, from 0 to 1. */
function shapedGlyph(
  glyph: Glyph & { readonly shape: (x: number, y: number) => number },
): InkPicture {
  const { width, height, shape } = glyph;
  const alpha = Float64Array.from({ length: width * height }, (_, at) =>
    shape(at % width, Math.floor(at / width)),
  );
  return alphaGlyph(glyph, alpha);
}

/** A glyph whose `hard` alpha is softened as it says. */
function alphaGlyph(glyph: Glyph, hard: Float64Array): InkPicture {
  const { name, kind, width, height, colour } = glyph;
  const shape = soften(hard, width, height, glyph.soft ?? 0);
  const wanted = new Uint8Array(width * height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const level = typeof colour === "number" ? colour : colour(x, y);
      if ((shape[at] ?? 0) > 0) data.fill(level, at * 4, at * 4 + 3);
      data[at * 4 + 3] = Math.round(
        (shape[at] ?? 0) * 255 * (glyph.opacity ?? 1),
      );
      wanted[at] = (hard[at] ?? 0) >= 0.5 ? 1 : 0;
    }
  }
  const either = new Uint8Array(width * height);
  return { name, kind, width, height, data, wanted, either };
}

/**
 * `window` as a capture of a window: clear outside rounded corners of `radius`
 * pixels, in a black shadow `shadow` pixels wide fading from 45%.
 */
function captured(
  window: InkPicture,
  name: string,
  radius: number,
  shadow = 0,
): InkPicture {
  const width = window.width + 2 * shadow;
  const height = window.height + 2 * shadow;
  const data = new Uint8ClampedArray(width * height * 4);
  const wanted = new Uint8Array(width * height);
  const either = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const inX = x - shadow;
      const inY = y - shadow;
      let alpha = 0;
      if (inX >= 0 && inY >= 0 && inX < window.width && inY < window.height) {
        const source = inY * window.width + inX;
        const fromX = Math.min(inX, window.width - 1 - inX);
        const fromY = Math.min(inY, window.height - 1 - inY);
        const past =
          fromX < radius && fromY < radius
            ? Math.hypot(radius - fromX - 0.5, radius - fromY - 0.5)
            : 0;
        alpha = Math.round(255 * clamp(radius - past + 0.5, 0, 1));
        data.set(window.data.subarray(source * 4, source * 4 + 3), at * 4);
        wanted[at] = window.wanted[source] ?? 0;
        either[at] = window.either[source] ?? 0;
      }
      if (alpha < 255 && shadow > 0) {
        const apartX = Math.max(0, -inX, inX - window.width + 1);
        const apartY = Math.max(0, -inY, inY - window.height + 1);
        const faded = clamp(1 - Math.hypot(apartX, apartY) / shadow, 0, 1);
        const dark = Math.round(255 * 0.45 * faded);
        if (dark > alpha) {
          data.fill(0, at * 4, at * 4 + 3);
          alpha = dark;
        }
      }
      data[at * 4 + 3] = alpha;
    }
  }
  return { name, kind: "Captures", width, height, data, wanted, either };
}

/** A tile on a clear ground with corners of `corner`, and a mark on it. */
function badge(
  name: string,
  side: number,
  corner: number,
  plate: number,
  mark: number,
): InkPicture {
  const glyph = coverage(
    side,
    side,
    letterH(side * 0.33, side * 0.25, side * 0.34, side * 0.5),
    side / 12,
  );
  const data = new Uint8ClampedArray(side * side * 4);
  const wanted = new Uint8Array(side * side);
  const middle = side / 2;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const at = y * side + x;
      const apartX = Math.max(0, Math.abs(x + 0.5 - middle) - middle + corner);
      const apartY = Math.max(0, Math.abs(y + 0.5 - middle) - middle + corner);
      const inside = clamp(corner - Math.hypot(apartX, apartY) + 0.5, 0, 1);
      const level = plate + (mark - plate) * (glyph[at] ?? 0);
      data.fill(level, at * 4, at * 4 + 3);
      data[at * 4 + 3] = Math.round(inside * 255);
      wanted[at] = (glyph[at] ?? 0) >= 0.5 ? 1 : 0;
    }
  }
  const either = new Uint8Array(side * side);
  return {
    name,
    kind: "Captures",
    width: side,
    height: side,
    data,
    wanted,
    either,
  };
}

function letterH(
  x: number,
  y: number,
  width: number,
  height: number,
): readonly Stroke[] {
  return [
    [x, y, x, y + height],
    [x + width, y, x + width, y + height],
    [x, y + height / 2, x + width, y + height / 2],
  ];
}

/** A rune of a stem, two arms and a tail. */
function rune(
  x: number,
  y: number,
  width: number,
  height: number,
): readonly Stroke[] {
  const middle = x + width / 2;
  return [
    [middle, y, middle, y + height],
    [x, y + height * 0.2, middle, y + height * 0.5],
    [x + width, y + height * 0.2, middle, y + height * 0.5],
    [x, y + height, middle, y + height * 0.7],
  ];
}

/** A row of `count` letters of thin strokes, each `size` pixels wide. */
function lettering(
  x: number,
  y: number,
  count: number,
  size: number,
): readonly Stroke[] {
  const strokes: Stroke[] = [];
  for (let index = 0; index < count; index++) {
    const left = x + index * size * 1.25;
    const right = left + size * 0.75;
    const bottom = y + size * 1.4;
    strokes.push(
      [left, y, left, bottom],
      [left, y + size * 0.7, right, y],
      [left, y + size * 0.7, right, bottom],
    );
  }
  return strokes;
}

const side = 96;
const dim = { ground: 8, ink: 50 };
const square = { width: side, height: side };
const letter = letterH(side * 0.3, side * 0.1, side * 0.4, side * 0.72);
const glyph = rune(side * 0.25, side * 0.1, side * 0.5, side * 0.72);

/** A corner block `share` of the area of a picture `side` pixels square. */
function corner(share: number, level: number): readonly Patch[] {
  const area = side * side * share;
  const width = Math.round(Math.sqrt(area * 2));
  const height = Math.max(1, Math.round(area / width));
  return [{ x: 0, y: side - height, width, height, level }];
}

/** The dense shapes a tightly cropped glyph can take, in `width` × `height`. */
function denseShapes(
  width: number,
  height: number,
): readonly (readonly [string, (x: number, y: number) => number])[] {
  const across = (x: number) => x / width;
  const down = (y: number) => y / height;
  const fromSide = (x: number) => Math.min(x, width - 1 - x);
  const fromEnd = (y: number) => Math.min(y, height - 1 - y);
  const shorter = Math.min(width, height);
  const middleX = (width - 1) / 2;
  const middleY = (height - 1) / 2;
  return [
    [
      "bold H",
      (x, y) => {
        const stems = across(x) < 0.38 || across(x) >= 0.62;
        return stems || (down(y) >= 0.4 && down(y) < 0.6) ? 1 : 0;
      },
    ],
    [
      "block with a counter",
      (x, y) => {
        const middle = (at: number) => at >= 0.42 && at < 0.58;
        return middle(across(x)) && middle(down(y)) ? 0 : 1;
      },
    ],
    [
      "block with a notch",
      (x, y) => (across(x) >= 0.4 && across(x) < 0.6 && down(y) < 0.18 ? 0 : 1),
    ],
    ["octagon", (x, y) => (fromSide(x) + fromEnd(y) < shorter * 0.2 ? 0 : 1)],
    [
      "disc",
      (x, y) => (Math.hypot(x - middleX, y - middleY) <= shorter / 2 ? 1 : 0),
    ],
  ];
}

/** The pictures that the table of results lists, kind by kind. */
export function inkPictures(): InkPicture[] {
  const pictures: InkPicture[] = [];
  const dimH = {
    kind: "A small bright element",
    ...square,
    ...dim,
    strokes: letter,
    thick: 8,
    soft: 1,
    noise: 1,
  };
  const words = lettering(side * 0.08, side * 0.87, 3, 6);
  pictures.push(
    drawn({
      ...dimH,
      name: "Dim H, white block of 0.3%",
      blocks: corner(0.003, 255),
    }),
    drawn({
      ...dimH,
      name: "Dim H, white block of 1.2%",
      blocks: corner(0.012, 255),
    }),
    drawn({
      ...dimH,
      name: "Dim H, label of white letters",
      label: { strokes: words, thick: 1.5, level: 255 },
    }),
  );
  const plain = { kind: "Ordinary pictures", ...square };
  for (const [name, ground, ink] of [
    ["Black on white", 255, 0],
    ["Grey on white", 255, 128],
    ["Pale grey on white", 255, 215],
    ["White on black", 0, 255],
    ["Light on dark", 40, 160],
    ["Dim light on dark", 8, 50],
    ["Dim dark on light", 50, 8],
  ] as const) {
    pictures.push(
      drawn({
        ...plain,
        name: `${name}, hard edges`,
        ground,
        ink,
        strokes: letter,
        thick: 8,
      }),
      drawn({
        ...plain,
        name: `${name}, soft edges`,
        ground,
        ink,
        strokes: glyph,
        thick: 3,
        soft: 1,
        noise: 1,
      }),
    );
  }
  for (const noise of [3, 12, 20]) {
    const noisy = {
      kind: "Noisy backgrounds",
      ...square,
      strokes: letter,
      thick: 8,
      soft: 1,
      noise,
    };
    pictures.push(
      drawn({
        ...noisy,
        name: `Dark on light, noise ±${String(noise)}`,
        ground: 235,
        ink: 20,
      }),
      drawn({ ...noisy, name: `Dim, noise ±${String(noise)}`, ...dim }),
    );
  }
  const onClear = {
    kind: "Transparent grounds",
    ...square,
    strokes: letter,
    thick: 8,
  };
  pictures.push(
    clearGlyph({ ...onClear, name: "Black glyph", colour: 0 }),
    clearGlyph({ ...onClear, name: "White glyph", colour: 255 }),
    clearGlyph({
      ...onClear,
      name: "Soft black glyph",
      colour: 0,
      strokes: glyph,
      thick: 3,
      soft: 1,
    }),
    clearGlyph({
      ...onClear,
      name: "Soft white glyph",
      colour: 255,
      strokes: glyph,
      thick: 3,
      soft: 1,
    }),
    clearGlyph({
      ...onClear,
      name: "Glyph of 50% opacity",
      colour: 30,
      opacity: 0.5,
    }),
    clearGlyph({
      ...onClear,
      name: "Bold glyph of two tones",
      colour: (x) => (x < side / 2 ? 60 : 180),
      thick: 24,
    }),
  );
  for (const grey of [20, 128, 230]) {
    pictures.push(
      clearGlyph({
        ...onClear,
        kind: "Glyphs of one colour",
        name: `Glyph of grey ${String(grey)}`,
        colour: grey,
        strokes: glyph,
        thick: 4,
      }),
    );
  }
  const dense = "Dense glyphs, tightly cropped";
  for (const size of [10, 100]) {
    for (const [name, colour] of [
      ["White", 255],
      ["Black", 0],
    ] as const) {
      pictures.push(
        shapedGlyph({
          name: `${name} bar of ${String(size)}, alpha 64 at each side`,
          kind: dense,
          width: size,
          height: size,
          shape: (x) => (x === 0 || x === size - 1 ? 64 / 255 : 1),
          colour,
        }),
      );
    }
  }
  for (const [name, shape] of denseShapes(side, side)) {
    pictures.push(
      shapedGlyph({
        name: `${name}, soft edges`,
        kind: dense,
        ...square,
        shape,
        colour: 40,
        soft: 1,
      }),
      shapedGlyph({
        name: `${name}, two tones`,
        kind: dense,
        ...square,
        shape,
        colour: (x) => (x < side / 2 ? 60 : 200),
      }),
    );
  }
  pictures.push(
    shapedGlyph({
      name: "Rectangle of two tones, alpha 64 all round",
      kind: dense,
      ...square,
      shape: (x, y) =>
        Math.min(x, y, side - 1 - x, side - 1 - y) === 0 ? 64 / 255 : 1,
      colour: (x) => (x < side / 2 ? 60 : 200),
    }),
  );
  const windowSize = { width: 240, height: 160 };
  const windowH = letterH(72, 24, 96, 112);
  for (const [name, ground, ink] of [
    ["Dim light ink", 8, 50],
    ["Dark ink on light", 240, 30],
    ["Dim dark ink", 50, 8],
  ] as const) {
    const window = drawn({
      kind: "Captures",
      name,
      ...windowSize,
      ground,
      ink,
      strokes: windowH,
      thick: 10,
      soft: 1,
      noise: 1,
    });
    pictures.push(
      captured(window, `${name}, rounded corners`, 10),
      captured(window, `${name}, corners and a shadow of 8`, 10, 8),
      captured(window, `${name}, corners and a shadow of 16`, 10, 16),
      captured(window, `${name}, corners and a shadow of 28`, 10, 28),
    );
  }
  pictures.push(
    badge("Tile with a dark mark, small corners", side, side / 12, 220, 30),
    badge("Tile with a dark mark, large corners", side, side / 6, 220, 30),
    badge("Disc with a light mark", side, side / 2, 30, 220),
  );
  return pictures;
}

/** What Make ink made of a picture from where it starts. */
export interface InkResult {
  readonly threshold: number;
  readonly light: boolean;
  /** The share of the wanted pixels that became ink. */
  readonly found: number;
  /** The share of the other pixels that became ink. */
  readonly stray: number;
  /** The share of the ink partly covered, enlarged 2.4 times. */
  readonly partial: number;
}

/** The functions of `src/ink/pixels.ts` that making ink takes. */
export interface InkCode {
  pictureLuminance(pixels: RgbaPixels): Luminance;
  regionValues(
    picture: Luminance,
    place: PicturePlace,
    region: Bounds,
  ): Region | undefined;
  inkDefaults(part: Region): { threshold: number; light: boolean };
  traceRegion(
    part: Region,
    place: PicturePlace,
    threshold: number,
    light: boolean,
    edge?: number,
  ): TracedInk | undefined;
  enlargeFactor(
    width: number,
    height: number,
    place: PicturePlace,
    region: Bounds,
  ): number;
  enlargedRegion(
    picture: Luminance,
    place: PicturePlace,
    region: Bounds,
    factor: number,
  ): { part: Region; place: PicturePlace; edge: number } | undefined;
}

/** Makes ink of `picture` by `code`, as the editor does, from its defaults. */
export function measureInk(code: InkCode, picture: InkPicture): InkResult {
  const { width, height } = picture;
  const luma = code.pictureLuminance(picture);
  const own = { x: 0, y: 0, scale: 1 };
  const part = code.regionValues(luma, own, {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
  });
  if (part === undefined) throw new Error("no part");
  const { threshold, light } = code.inkDefaults(part);
  const ink = code.traceRegion(part, own, threshold, light);
  let wanted = 0;
  let found = 0;
  let other = 0;
  let stray = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      if (picture.either[at] === 1) continue;
      const inX = x - (ink?.x ?? 0);
      const inY = y - (ink?.y ?? 0);
      const inked =
        ink !== undefined &&
        inX >= 0 &&
        inY >= 0 &&
        inX < ink.width &&
        inY < ink.height &&
        (ink.alpha[inY * ink.width + inX] ?? 0) >= 128;
      if (picture.wanted[at] === 1) {
        wanted++;
        if (inked) found++;
      } else {
        other++;
        if (inked) stray++;
      }
    }
  }
  // Sharpness shows where a picture is enlarged, as most small ones are.
  const place = { x: 0, y: 0, scale: 2.4 };
  const region = {
    left: 0,
    top: 0,
    right: Math.ceil(width * place.scale),
    bottom: Math.ceil(height * place.scale),
  };
  const factor = code.enlargeFactor(width, height, place, region);
  const fine = code.enlargedRegion(luma, place, region, factor);
  if (fine === undefined) throw new Error("no samples");
  const enlarged = code.traceRegion(
    fine.part,
    fine.place,
    threshold,
    light,
    fine.edge,
  );
  const inked = enlarged?.alpha.filter((value) => value > 0) ?? [];
  const soft = inked.filter((value) => value < 255).length;
  return {
    threshold,
    light,
    found: found / Math.max(1, wanted),
    stray: stray / Math.max(1, other),
    partial: soft / Math.max(1, inked.length),
  };
}

/** What every position of the slider makes of a picture at its own pixels. */
export interface InkSweep {
  /** The ink at each threshold, from the slider's low end, in full pixels. */
  readonly ink: readonly number[];
  /** How many pixels are partly covered at each. */
  readonly partial: readonly number[];
}

/** Sweeps the slider over `picture`, by `code`, with light ink or dark. */
export function sweepInk(
  code: InkCode,
  picture: InkPicture,
  light: boolean,
): InkSweep {
  const { width, height } = picture;
  const own = { x: 0, y: 0, scale: 1 };
  const part = code.regionValues(code.pictureLuminance(picture), own, {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
  });
  if (part === undefined) throw new Error("no part");
  const ink: number[] = [];
  const partial: number[] = [];
  for (let threshold = -16; threshold <= 272; threshold++) {
    const alpha = code.traceRegion(part, own, threshold, light)?.alpha ?? [];
    let sum = 0;
    let soft = 0;
    for (const value of alpha) {
      sum += value / 255;
      if (value > 0 && value < 255) soft++;
    }
    ink.push(sum);
    partial.push(soft);
  }
  return { ink, partial };
}

/**
 * The most that ink grows in one step as the slider moves away from it: up for
 * light ink, down for dark.
 */
export function inkGrowth(ink: readonly number[], light: boolean): number {
  let most = 0;
  for (let at = 1; at < ink.length; at++) {
    const before = ink[at - 1] ?? 0;
    const after = ink[at] ?? 0;
    most = Math.max(most, light ? after - before : before - after);
  }
  return most;
}

/** Whether a result is the ink wanted: nearly all of it, and little else. */
export function madeInk(result: InkResult): boolean {
  return result.found >= 0.9 && result.stray <= 0.02;
}

/** The sizes the random pictures come in. */
const sizes = [
  { width: 103, height: 137 },
  { width: 160, height: 120 },
  { width: 256, height: 96 },
  { width: 80, height: 80 },
  { width: 320, height: 180 },
  { width: 64, height: 128 },
  { width: 200, height: 200 },
] as const;

/** Random choices, repeatable from a seed. */
class Dice {
  readonly #random: () => number;

  constructor(seed: number) {
    this.#random = randomFrom(seed);
  }

  next(): number {
    return this.#random();
  }

  between(low: number, high: number): number {
    return low + this.#random() * (high - low);
  }

  whole(below: number): number {
    return Math.floor(this.#random() * below);
  }

  pick<T>(choices: readonly T[]): T {
    const choice = choices[this.whole(choices.length)];
    if (choice === undefined) throw new Error("nothing to pick");
    return choice;
  }
}

/** A random glyph of straight strokes and arcs in a box. */
function randomGlyph(
  dice: Dice,
  x: number,
  y: number,
  width: number,
  height: number,
): Stroke[] {
  const strokes: Stroke[] = [];
  const parts = 2 + dice.whole(4);
  for (let part = 0; part < parts; part++) {
    if (dice.next() < 0.35) {
      const middleX = x + dice.between(0.3, 0.7) * width;
      const middleY = y + dice.between(0.3, 0.7) * height;
      const acrossX = dice.between(0.15, 0.45) * width;
      const acrossY = dice.between(0.15, 0.45) * height;
      const from = dice.between(0, 2 * Math.PI);
      const turn = dice.between(1.5, 2 * Math.PI);
      const at = (step: number) => {
        const angle = from + (turn * step) / 12;
        return [
          middleX + acrossX * Math.cos(angle),
          middleY + acrossY * Math.sin(angle),
        ] as const;
      };
      for (let step = 0; step < 12; step++) {
        strokes.push([...at(step), ...at(step + 1)]);
      }
    } else {
      let fromX = x + dice.next() * width;
      let fromY = y + dice.next() * height;
      const steps = 1 + dice.whole(3);
      for (let step = 0; step < steps; step++) {
        const toX = x + dice.next() * width;
        const toY = y + dice.next() * height;
        strokes.push([fromX, fromY, toX, toY]);
        fromX = toX;
        fromY = toY;
      }
    }
  }
  return strokes;
}

/** A dim or pale symbol with something far brighter or darker off to one side. */
function randomLabelled(dice: Dice, index: number): InkPicture {
  const { width, height } = dice.pick(sizes);
  const [ground, ink] = dice.pick([
    [8, 50],
    [15, 60],
    [20, 44],
    [5, 35],
    [30, 90],
    [60, 120],
    [247, 205],
    [235, 180],
  ] as const);
  const level = ground > 128 ? 0 : 255;
  const element = dice.pick(["letters", "letters", "block", "bar"]);
  const edge = dice.pick(["bottom", "bottom", "top", "corner"]);
  const y = edge === "top" ? height * 0.03 : height * dice.between(0.8, 0.88);
  const x =
    edge === "corner"
      ? width * dice.between(0.72, 0.84)
      : width * dice.between(0.15, 0.6);
  const scene = {
    name: `Labelled ${String(index)}`,
    kind: "Labelled",
    width,
    height,
    ground,
    ink,
    strokes: randomGlyph(
      dice,
      width * 0.22,
      height * 0.1,
      width * 0.56,
      height * 0.6,
    ),
    thick: dice.pick([2, 3, 4, 5]),
    noise: dice.pick([0, 1, 1, 2, 3]),
    soft: dice.pick([0, 1, 1]),
    seed: index + 1,
  };
  if (element === "block") {
    return drawn({
      ...scene,
      blocks: [
        {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width * dice.between(0.06, 0.16)),
          height: Math.max(2, Math.round(height * dice.between(0.04, 0.09))),
          level,
        },
      ],
    });
  }
  if (element === "bar") {
    return drawn({
      ...scene,
      blocks: [
        {
          x: Math.round(width * 0.1),
          y: Math.round(height * 0.93),
          width: Math.round(width * 0.8),
          height: 3,
          level,
        },
      ],
    });
  }
  const size = Math.max(4, Math.min(width, height) / dice.between(12, 18));
  return drawn({
    ...scene,
    label: {
      strokes: lettering(x, y, 2 + dice.whole(3), size),
      thick: dice.pick([1.5, 2]),
      level,
    },
  });
}

const plainTones = [
  [255, 0],
  [0, 255],
  [245, 30],
  [15, 230],
  [255, 128],
  [40, 160],
  [230, 90],
  [200, 40],
] as const;

/** Dark on light or light on dark, at any size, from thin to bold. */
function randomOrdinary(dice: Dice, index: number): InkPicture {
  const { width, height } = dice.pick(sizes);
  const [ground, ink] = dice.pick([...plainTones, [8, 50], [50, 8]]);
  const box = dice.pick([0.5, 0.7, 0.9]);
  return drawn({
    name: `Ordinary ${String(index)}`,
    kind: "Ordinary",
    width,
    height,
    ground,
    ink,
    strokes: randomGlyph(
      dice,
      (width * (1 - box)) / 2,
      (height * (1 - box)) / 2,
      width * box,
      height * box,
    ),
    thick: dice.pick([2, 3, 4, 6, 8, Math.round(Math.min(width, height) / 10)]),
    noise: dice.pick([0, 1, 2]),
    soft: dice.pick([0, 1, 2]),
    seed: index + 1,
  });
}

function randomNoisy(dice: Dice, index: number): InkPicture {
  const { width, height } = dice.pick(sizes);
  const [ground, ink] = dice.pick(plainTones);
  return drawn({
    name: `Noisy ${String(index)}`,
    kind: "Noisy",
    width,
    height,
    ground,
    ink,
    strokes: randomGlyph(
      dice,
      width * 0.2,
      height * 0.15,
      width * 0.6,
      height * 0.7,
    ),
    thick: dice.pick([3, 4, 6]),
    noise: dice.pick([3, 6, 12, 20, 30]),
    soft: dice.pick([0, 1]),
    seed: index + 1,
  });
}

/** A glyph on a transparent ground, of one colour or several. */
function randomClear(dice: Dice, index: number): InkPicture {
  const { width, height } = dice.pick(sizes);
  const tones = dice.pick(["one", "one", "two", "gradient"]);
  const grey = dice.pick([0, 20, 128, 230, 255]);
  return clearGlyph({
    name: `Clear ${String(index)}`,
    kind: "Clear",
    width,
    height,
    strokes: randomGlyph(
      dice,
      width * 0.1,
      height * 0.1,
      width * 0.8,
      height * 0.8,
    ),
    thick: dice.pick([2, 3, 5, 8, 14]),
    colour:
      tones === "one"
        ? grey
        : tones === "two"
          ? (x) => (x < width / 2 ? 40 : 200)
          : (_, y) => 30 + (y / height) * 180,
    soft: dice.pick([0, 1]),
    opacity: dice.pick([1, 1, 1, 0.5]),
  });
}

/** A glyph that fills most of its crop, of one colour or several. */
function randomDense(dice: Dice, index: number): InkPicture {
  const { width, height } = dice.pick(sizes);
  const [name, shape] = dice.pick(denseShapes(width, height));
  const tones = dice.pick(["one", "one", "two", "gradient"]);
  const grey = dice.pick([0, 20, 128, 230, 255]);
  return shapedGlyph({
    name: `Dense ${String(index)}, ${name}`,
    kind: "Dense",
    width,
    height,
    shape,
    colour:
      tones === "one"
        ? grey
        : tones === "two"
          ? (x) => (x < width / 2 ? 40 : 200)
          : (_, y) => 30 + (y / height) * 180,
    soft: dice.pick([0, 0, 1]),
  });
}

/** A window with a symbol in it, with rounded corners and perhaps a shadow. */
function randomCapture(dice: Dice, index: number): InkPicture {
  const { width, height } = dice.pick(sizes);
  const [ground, ink] = dice.pick(plainTones);
  const shorter = Math.min(width, height);
  const window = drawn({
    name: `Window ${String(index)}`,
    kind: "Window",
    width,
    height,
    ground,
    ink,
    strokes: randomGlyph(
      dice,
      width * 0.2,
      height * 0.15,
      width * 0.6,
      height * 0.7,
    ),
    thick: dice.pick([3, 4, 6]),
    noise: dice.pick([0, 1, 2]),
    soft: dice.pick([0, 1]),
    seed: index + 1,
  });
  return captured(
    window,
    `Capture ${String(index)}`,
    Math.floor(dice.between(0, shorter / 10)),
    dice.pick([0, 0, 6, 16, 32]),
  );
}

/** A group of random pictures, which `make` draws one at a time. */
export interface RandomGroup {
  readonly name: string;
  /** Whether its pictures are glyphs, which make what they always made. */
  readonly glyphs: boolean;
  make(dice: Dice, index: number): InkPicture;
}

const groups: readonly RandomGroup[] = [
  { name: "Ordinary dark and light", glyphs: false, make: randomOrdinary },
  { name: "Noisy backgrounds", glyphs: false, make: randomNoisy },
  {
    name: "A dim symbol, something bright to one side",
    glyphs: false,
    make: randomLabelled,
  },
  { name: "Transparent grounds", glyphs: true, make: randomClear },
  { name: "Dense glyphs", glyphs: true, make: randomDense },
  { name: "Captures of windows", glyphs: false, make: randomCapture },
];

/**
 * The groups of random pictures, `count` in each from `seed`, with what draws
 * them one by one: holding them all would take too much memory.
 */
export function randomGroups(
  count: number,
  seed: number,
): readonly (readonly [RandomGroup, () => Generator<InkPicture>])[] {
  return groups.map((group, place) => [
    group,
    function* pictures() {
      const dice = new Dice(seed + place);
      for (let index = 0; index < count; index++) {
        yield group.make(dice, index);
      }
    },
  ]);
}
