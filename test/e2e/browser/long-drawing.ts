// The view keeps what it has drawn and measured, and adds a stroke to it. These
// run in the renderer, where the canvas is the browser's own, for the tests
// that it always shows what a view starting from nothing would, and that
// adding to a long drawing stays quick.

import type { BaseLayer, Stroke, Tool } from "../../../src/format/record.ts";
import { cropSpan, joinSpans, type Span } from "../../../src/editor/guides.ts";
import { DrawingSession, type Shape } from "../../../src/editor/session.ts";
import { InkView } from "../../../src/editor/view.ts";
import {
  baseFromPicture,
  findInk,
  measureAdded,
  measureInk,
  saveInk,
} from "../../../src/ink/canvas.ts";
import {
  addedStroke,
  documentSpan,
  toUnits,
  type InkDocument,
} from "../../../src/ink/document.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import type { DrawableBase } from "../../../src/ink/render.ts";
import { picture } from "./pictures.ts";
import { straddling } from "./straddling.ts";

/** How wide the surfaces are, in CSS pixels. */
const surfaceWidth = 803;

/** How wide a full measurement's tiles are, in pixels. */
const tileWidth = 4096;

/** A font size a preview is usually shown at, in CSS pixels. */
const textSize = 16;

/** What a seeded run did, and the first difference it found, if any. */
export interface SequenceReport {
  /** How many times each operation ran. */
  readonly operations: Readonly<Record<string, number>>;
  /** Frames compared, and those adding one pen or eraser stroke to the last. */
  readonly frames: number;
  readonly addedPen: number;
  readonly addedEraser: number;
  /** Saves made, and those cropped a pixel from a full measurement. */
  readonly saves: number;
  readonly savesAPixelOff: number;
  readonly mismatch?: string;
}

/** A generator of numbers from 0 to 1, the same for the same seed: mulberry32. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  return context;
}

function pixelsOf(canvas: HTMLCanvasElement): ImageData {
  return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

/** Where two images differ, in size or in any byte of a pixel, if at all. */
function difference(a: ImageData, b: ImageData): string | undefined {
  if (a.width !== b.width || a.height !== b.height) {
    return `${String(a.width)}×${String(a.height)} against ${String(b.width)}×${String(b.height)}`;
  }
  for (let index = 0; index < a.data.length; index++) {
    if (a.data[index] !== b.data[index]) {
      const pixel = Math.floor(index / 4);
      return `at ${String(pixel % a.width)},${String(Math.floor(pixel / a.width))}: ${String(a.data[index])} against ${String(b.data[index])}`;
    }
  }
  return undefined;
}

/** Whether two spans' ends are at most a pixel apart. */
function nearSpan(a: Span, b: Span): boolean {
  return Math.abs(a.left - b.left) <= 1 && Math.abs(a.right - b.right) <= 1;
}

/** The image's ends a full measurement gives, with any stroke being drawn. */
function fullSpan(
  document: InkDocument,
  base: DrawableBase | undefined,
  active: Stroke | undefined,
): Span {
  const found = findInk(document, base);
  return cropSpan(
    joinSpans(
      found === undefined
        ? undefined
        : { left: found.left, right: found.right },
      active?.tool === "pen" ? documentSpan({ strokes: [active] }) : undefined,
    ),
  );
}

function sameSpan(a: Span, b: Span): boolean {
  return a.left === b.left && a.right === b.right;
}

/**
 * Runs `steps` random operations through a real session, on a drawing about
 * `reach` pixels wide, on a screen of `ratio` device pixels to a CSS pixel,
 * for `seed`: every way the editor can change a drawing, with some strokes
 * drawn over several frames, and some operations together in one frame, as
 * they come when a frame is late. A view kept all along shows each frame, and
 * each must have exactly the ends of a full measurement and show the same
 * pixels as a new view does, on the surface and in the preview, at full size
 * and in text. With no stroke being drawn, a stroke that shows nothing must
 * leave the preview in text as it was. Every few such frames, a save must crop
 * to those ends, or a pixel from them: it measures again in the file's
 * coordinates, where the edge of the ink can fall a column over, however the
 * view measured it (#159). It starts, with `straddles`, with a dot far left
 * and that many strokes across the edge between the first two tiles, and it
 * ends with a pen stroke right across. The run stops at the first difference.
 */
export async function runSequence(
  seed: number,
  steps: number,
  reach: number,
  ratio: number,
  straddles: number,
): Promise<SequenceReport> {
  const random = seeded(seed);
  const chance = (odds: number): boolean => random() < odds;
  const between = (low: number, high: number): number =>
    low + random() * (high - low);
  const whole = (low: number, high: number): number =>
    Math.floor(between(low, high + 1));

  const canvases = Array.from({ length: 6 }, () => createEl("canvas"));
  const [keptSurface, keptPreview, keptText, newSurface, newPreview, newText] =
    canvases;
  if (
    keptSurface === undefined ||
    keptPreview === undefined ||
    keptText === undefined ||
    newSurface === undefined ||
    newPreview === undefined ||
    newText === undefined
  ) {
    throw new Error("no canvases");
  }
  activeDocument.body.append(...canvases);

  // A dark block on white, which a picture's ink keeps.
  const blob = await picture(240, lineBox.height, "white", [
    { x: 20, y: 60, width: 200, height: 60, colour: "black" },
  ]);
  const { layer, drawable } = await baseFromPicture(
    new Uint8Array(await blob.arrayBuffer()),
  );
  // Where each layer is, one for each, as the editor keeps it.
  const places = new WeakMap<BaseLayer, DrawableBase>();
  const placed = (document: InkDocument): DrawableBase | undefined => {
    const { base } = document;
    if (base === undefined) return undefined;
    const known = places.get(base);
    if (known !== undefined) return known;
    const place = { ...drawable, x: base.x, y: base.y, scale: base.scale };
    places.set(base, place);
    return place;
  };

  // The font size that shows the preview pixel for pixel.
  const fullSize = lineBox.pxPerEm / ratio;
  const session = new DrawingSession({ strokes: [] });
  let fitted = { left: 0, right: reach };
  const kept = new InkView(keptSurface);
  kept.fit(fitted.left, fitted.right);
  kept.resize(surfaceWidth, ratio);

  const operations: Record<string, number> = {};
  const recent: string[] = [];
  const earlier: InkDocument[] = [];
  let frames = 0;
  let addedPen = 0;
  let addedEraser = 0;
  let saves = 0;
  let savesAPixelOff = 0;
  let last: InkDocument | undefined;
  let mismatch: string | undefined;

  /** Shows a frame in the kept view and a new one, and compares them. */
  const frame = async (): Promise<void> => {
    if (mismatch !== undefined) return;
    const { document } = session;
    const base = placed(document);
    const active = session.activeStroke;
    const erasing = session.tool === "eraser" && session.shape !== "free";
    const added = last === undefined ? undefined : addedStroke(last, document);
    if (added?.tool === "pen") addedPen++;
    if (added?.tool === "eraser") addedEraser++;
    last = document;
    frames++;

    kept.render(document, base, active, erasing);
    kept.drawPreview(keptPreview, fullSize);
    kept.drawPreview(keptText, textSize);
    const fresh = new InkView(newSurface);
    fresh.fit(fitted.left, fitted.right);
    fresh.magnified = kept.magnified;
    fresh.resize(surfaceWidth, ratio);
    fresh.centerOn(kept.center);
    fresh.render(document, base, active, erasing);
    fresh.drawPreview(newPreview, fullSize);
    fresh.drawPreview(newText, textSize);

    const at = `seed ${String(seed)}, after ${recent.slice(-6).join(", ")}`;
    const image = kept.image;
    const full = fullSpan(document, base, active);
    if (!sameSpan(image, full)) {
      mismatch = `${at}: the ends are ${JSON.stringify(image)}, and a full measurement says ${JSON.stringify(full)}`;
      return;
    }
    if (!sameSpan(kept.visible, fresh.visible)) {
      mismatch = `${at}: the views show ${JSON.stringify(kept.visible)} and ${JSON.stringify(fresh.visible)}`;
      return;
    }
    const surface = difference(pixelsOf(keptSurface), pixelsOf(newSurface));
    if (surface !== undefined) {
      mismatch = `${at}: the surface differs ${surface}`;
      return;
    }
    const preview = difference(pixelsOf(keptPreview), pixelsOf(newPreview));
    if (preview !== undefined) {
      mismatch = `${at}: the preview differs ${preview}`;
      return;
    }
    const inText = pixelsOf(keptText);
    const text = difference(inText, pixelsOf(newText));
    if (text !== undefined) {
      mismatch = `${at}: the preview in text differs ${text}`;
      return;
    }
    if (active === undefined) {
      // A dot above the line box, within the ink, so that it shows nothing.
      const dot: Stroke = {
        tool: "pen",
        size: toUnits(1),
        pressure: false,
        points: [toUnits((image.left + image.right) / 2), toUnits(-100)],
      };
      kept.render(document, base, dot);
      if (sameSpan(kept.image, image)) {
        kept.drawPreview(keptText, textSize);
        const started = difference(inText, pixelsOf(keptText));
        if (started !== undefined) {
          mismatch = `${at}: the preview in text changes as a stroke starts ${started}`;
          return;
        }
      }
      kept.render(document, base, undefined);
    }
    // A save takes longer than all of that, so it is every few frames.
    if (active !== undefined || frames % 5 !== 0) return;
    const saved = await saveInk(document, base);
    const crop = {
      left: saved.left,
      right: saved.left + saved.record.box.width,
    };
    saves++;
    if (!sameSpan(image, crop)) savesAPixelOff++;
    if (!nearSpan(image, crop)) {
      mismatch = `${at}: the ends are ${JSON.stringify(image)}, and a save crops to ${JSON.stringify(crop)}`;
    }
  };

  /** Somewhere to draw: by the image's ends as often as anywhere, to widen it. */
  const place = (): { x: number; y: number } => {
    const { left, right } = kept.image;
    return {
      x: chance(0.4)
        ? (chance(0.5) ? left : right) + between(-30, 30)
        : between(0, reach),
      y: between(-30, lineBox.height + 30),
    };
  };

  const brush = (shape: Shape): void => {
    session.tool = chance(0.4) ? "eraser" : "pen";
    session.shape = shape;
    session.sizeIndex = whole(0, 3);
    session.fill = chance(0.5);
    session.flatEnds = chance(0.4);
    session.snap = chance(0.4);
  };

  const freehand = async (): Promise<void> => {
    brush("free");
    const straight = chance(0.2);
    let at = place();
    session.begin(at);
    const moves = whole(0, 24);
    for (let move = 0; move < moves; move++) {
      at = { x: at.x + between(-16, 24), y: at.y + between(-12, 12) };
      session.extend([at], straight);
      if (chance(0.15)) await frame();
    }
    if (chance(0.1)) session.cancel();
    else session.end(at);
  };

  /** A straight stroke right across, wider than a tile on a wide drawing. */
  const across = (tool?: Tool): void => {
    brush("free");
    if (tool !== undefined) session.tool = tool;
    const y = between(0, lineBox.height);
    session.begin({ x: 0, y });
    session.extend([{ x: reach, y: between(0, lineBox.height) }], true);
    session.end();
  };

  /** A pen dot far left of the image's right end, unless it is already wide. */
  const farDot = (): void => {
    const { left, right } = kept.image;
    if (right - left > 3500) return;
    brush("free");
    session.tool = "pen";
    const at = { x: right - between(500, 4100), y: between(40, 150) };
    session.begin(at);
    session.end(at);
  };

  /** A pen stroke across the edge between a full measurement's first tiles. */
  const straddle = (): void => {
    const { document } = session;
    const origin = measureInk(document, placed(document))?.origin ?? 0;
    brush("free");
    session.tool = "pen";
    let at = {
      x: origin + tileWidth - between(0, 40),
      y: between(20, lineBox.height - 20),
    };
    session.begin(at);
    const moves = whole(1, 12);
    for (let move = 0; move < moves; move++) {
      at = { x: at.x + between(0, 12), y: at.y + between(-8, 8) };
      session.extend([at]);
    }
    session.end(at);
  };

  const ellipse = async (): Promise<void> => {
    brush("ellipse");
    const from = place();
    const to = { x: from.x + between(-120, 120), y: from.y + between(-90, 90) };
    session.begin(from);
    session.extend([to], chance(0.3));
    if (chance(0.3)) await frame();
    session.end(to);
  };

  const polygon = async (): Promise<void> => {
    brush("polygon");
    const first = place();
    session.begin(first);
    session.end(first);
    let at = first;
    const corners = whole(2, 5);
    for (let corner = 0; corner < corners && session.placing; corner++) {
      at = { x: at.x + between(-80, 80), y: at.y + between(-60, 60) };
      session.begin(at);
      session.end(at);
      if (chance(0.3)) await frame();
    }
    // Closed on its first corner, ended on its last, or just left there.
    const end = chance(0.5) ? first : at;
    if (session.placing) {
      session.begin(end);
      session.end(end);
    }
    if (session.placing) session.end();
  };

  const run: readonly (readonly [string, number, () => unknown])[] = [
    ["freehand", 10, freehand],
    [
      "across",
      0.5,
      () => {
        across();
      },
    ],
    [
      "far dot",
      0.5,
      () => {
        farDot();
      },
    ],
    [
      "straddle",
      2,
      () => {
        straddle();
      },
    ],
    ["ellipse", 4, ellipse],
    ["polygon", 4, polygon],
    ["undo", 4, () => session.undo()],
    ["redo", 3, () => session.redo()],
    [
      "move",
      3,
      // Far enough, some of the time, to take ink out of the line box.
      () => session.moveDrawing(toUnits(whole(-6, 6) * 16)),
    ],
    [
      "clear",
      0.3,
      () => {
        session.clear();
      },
    ],
    [
      "restore",
      1,
      () => {
        const document = earlier[whole(0, earlier.length - 1)];
        if (document !== undefined) session.replace(document);
      },
    ],
    [
      "add a base layer",
      1,
      () => {
        session.replace({
          strokes: session.document.strokes,
          base: {
            ...layer,
            x: toUnits(whole(0, reach)),
            y: toUnits(whole(-40, 40)),
          },
        });
      },
    ],
    [
      "drop the base layer",
      0.5,
      () => {
        session.replace({ strokes: session.document.strokes });
      },
    ],
    [
      "save",
      1,
      async () => {
        const { document } = session;
        const { left } = await saveInk(document, placed(document));
        session.markSaved(document);
        session.rebase(-left);
        kept.shift(-left);
      },
    ],
    [
      "pan",
      1,
      () => {
        kept.pan(whole(-400, 400));
      },
    ],
    [
      "zoom",
      1,
      () => {
        kept.magnified = !kept.magnified;
        kept.resize(surfaceWidth, ratio);
      },
    ],
    [
      "fit",
      0.5,
      () => {
        fitted = kept.image;
        kept.fit(fitted.left, fitted.right);
        kept.resize(surfaceWidth, ratio);
      },
    ],
  ];
  const total = run.reduce((sum, [, weight]) => sum + weight, 0);
  const choose = (): readonly [string, number, () => unknown] => {
    let left = random() * total;
    for (const entry of run) {
      left -= entry[1];
      if (left < 0) return entry;
    }
    throw new Error("no operation chosen");
  };

  try {
    await frame();
    if (straddles > 0) {
      farDot();
      await frame();
    }
    for (let stroke = 0; stroke < straddles; stroke++) {
      straddle();
      await frame();
    }
    for (let step = 0; step < steps && mismatch === undefined; step++) {
      const [name, , operate] = choose();
      recent.push(name);
      operations[name] = (operations[name] ?? 0) + 1;
      await operate();
      if (chance(0.1)) earlier.push(session.document);
      // A late frame finds several changes together.
      if (chance(0.75)) await frame();
    }
    await frame();
    across("pen");
    await frame();
  } finally {
    for (const canvas of canvases) canvas.remove();
  }
  return {
    operations,
    frames,
    addedPen,
    addedEraser,
    saves,
    savesAPixelOff,
    ...(mismatch === undefined ? {} : { mismatch }),
  };
}

/** How {@link measureAdded} did on strokes that are hard to measure alone. */
export interface StraddlingReport {
  readonly cases: number;
  /** Where it differed from a full measurement, which it never should. */
  readonly differences: readonly string[];
  /** How many a stroke on a tile of its own would have got wrong. */
  readonly wrongAlone: number;
}

/**
 * Measures each of the {@link straddling} strokes, added to its far dot, as the
 * editor does, and fully.
 */
export function measureStraddling(): StraddlingReport {
  const differences: string[] = [];
  let wrongAlone = 0;
  for (const { far, stroke } of straddling) {
    const dot: Stroke = {
      tool: "pen",
      size: toUnits(12),
      pressure: false,
      points: [far, toUnits(100)],
    };
    const before = measureInk({ strokes: [dot] }, undefined);
    const full = measureInk({ strokes: [dot, stroke] }, undefined);
    if (before === undefined || full === undefined) {
      throw new Error("a stroke leaves no ink");
    }
    const added = measureAdded(before, stroke);
    if (JSON.stringify(added) !== JSON.stringify(full)) {
      differences.push(
        `${JSON.stringify(added)} against ${JSON.stringify(full)}`,
      );
    }
    const alone = findInk({ strokes: [stroke] }, undefined);
    if (
      Math.max(alone?.right ?? -Infinity, before.ink?.right ?? -Infinity) !==
      full.ink?.right
    ) {
      wrongAlone++;
    }
  }
  return { cases: straddling.length, differences, wrongAlone };
}

/** What adding to a long drawing took, in ms, and whether its ends agree. */
export interface ChangeTimes {
  /** A pen stroke within the image's ends, then past them. */
  readonly inside: readonly number[];
  readonly past: readonly number[];
  /** A frame of a stroke being drawn past them, on the same drawing. */
  readonly frames: readonly number[];
  readonly ends: { readonly shown: Span; readonly full: Span };
  readonly strokes: number;
}

/**
 * Times the surface and the preview after each of nine changes of each kind,
 * to `count` dots `span` pixels across, each with a read of a pixel from
 * each, so that drawing the browser holds back is counted.
 */
export function timeChanges(count: number, span: number): ChangeTimes {
  const dot = (x: number, y: number): Stroke => ({
    tool: "pen",
    size: toUnits(12),
    pressure: false,
    points: [toUnits(x), toUnits(y)],
  });
  const surface = createEl("canvas");
  const preview = createEl("canvas");
  activeDocument.body.append(surface, preview);
  const view = new InkView(surface);
  view.fit(0, span);
  view.resize(surfaceWidth, 1);
  const show = (document: InkDocument, active?: Stroke): number => {
    const started = performance.now();
    view.render(document, undefined, active);
    view.drawPreview(preview, 16);
    context2d(surface).getImageData(0, 0, 1, 1);
    context2d(preview).getImageData(0, 0, 1, 1);
    return performance.now() - started;
  };
  let document: InkDocument = {
    strokes: Array.from({ length: count }, (_, index) =>
      dot((index * span) / count, 60 + ((index * 37) % 80)),
    ),
  };
  show(document);
  const samples = Array.from({ length: 9 }, (_, index) => index);
  const add = (stroke: Stroke): number => {
    document = { strokes: [...document.strokes, stroke] };
    return show(document);
  };
  try {
    const inside = samples.map((index) =>
      add(dot((span * (index + 2)) / 12, 100)),
    );
    const past = samples.map((index) => add(dot(span + 40 * (index + 1), 100)));
    const frames = samples.map((index) =>
      show(document, dot(span + 400 + 40 * index, 100)),
    );
    show(document);
    return {
      inside,
      past,
      frames,
      ends: {
        shown: view.image,
        full: fullSpan(document, undefined, undefined),
      },
      strokes: document.strokes.length,
    };
  } finally {
    surface.remove();
    preview.remove();
  }
}
