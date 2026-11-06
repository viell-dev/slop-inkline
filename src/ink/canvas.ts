// Opening and saving symbols with the browser's own image decoder and canvas;
// the format module encodes the pixels. Everything here needs a browser; the
// rules it applies live in modules that unit tests can run.

import {
  preservableChunks,
  readInk,
  writeInkFile,
  type CarriedChunk,
} from "../format/ink-file.ts";
import {
  encodeRgba,
  imageHeader,
  readChunks,
  writeChunks,
} from "../format/png.ts";
import {
  limits,
  unitsPerPixel,
  type BaseLayer,
  type InkRecord,
  type Stroke,
} from "../format/record.ts";
import {
  fitsFormat,
  recordFromDocument,
  type InkDocument,
} from "./document.ts";
import { crop, lineBox, type Bounds } from "./geometry.ts";
import { strokeBounds } from "./outline.ts";
import {
  baseIsReduced,
  greyInk,
  inkAlpha,
  inkBounds,
  inkPixels,
  reduceBaseAlpha,
  type RgbaPixels,
  type TracedInk,
} from "./pixels.ts";
import { drawInk, inkColor, type DrawableBase } from "./render.ts";

/** The largest picture opened without a record, in pixels a side. */
export const maxPictureSize = limits.baseSize;

/** The widest canvas drawn on at once while looking for the ink. */
const tileWidth = 4096;

function canvas(width: number, height: number) {
  const surface = new OffscreenCanvas(width, height);
  const context = surface.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("no 2D canvas context");
  return { surface, context };
}

/**
 * Decodes a PNG file, after checking its structure and that it is at most
 * `maxSize` pixels a side, so that a crafted file cannot claim a huge image.
 * Colour profiles and gamma are ignored, and so is `eXIf`, whose orientation
 * Chromium would apply: the stored values are used as they are, as the format
 * specifies, whichever way a browser's defaults go.
 */
export async function decodePng(
  bytes: Uint8Array,
  maxSize = maxPictureSize,
): Promise<ImageBitmap> {
  const chunks = readChunks(bytes);
  const { width, height } = imageHeader(chunks);
  if (width > maxSize || height > maxSize) {
    throw new RangeError(
      `image is ${String(width)}×${String(height)}, larger than ${String(maxSize)} pixels a side`,
    );
  }
  const plain = chunks.some(({ type }) => type === "eXIf")
    ? writeChunks(chunks.filter(({ type }) => type !== "eXIf"))
    : bytes.slice();
  return createImageBitmap(new Blob([plain], { type: "image/png" }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
}

/** An image's pixels, as RGBA. */
export function readPixels(image: ImageBitmap | OffscreenCanvas): RgbaPixels {
  const { surface, context } = canvas(image.width, image.height);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, surface.width, surface.height);
}

/**
 * Encodes RGBA pixels as a PNG file. The format module does it rather than
 * the canvas: Chromium can hold a canvas's encoding back for seconds, until
 * the window has time to spare.
 */
export function encodePixels(pixels: RgbaPixels): Promise<Uint8Array> {
  return encodeRgba(pixels.width, pixels.height, pixels.data, {
    // A task of its own, so that frames and input run between batches.
    pause: () =>
      new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      }),
  });
}

/** A drawing ready to edit: the document, and its base layer decoded. */
export interface EditableInk {
  readonly kind: "editable";
  readonly document: InkDocument;
  readonly base?: DrawableBase;
  /** The file's chunks to keep when it is saved again: text and the like. */
  readonly carried: readonly CarriedChunk[];
  /** How wide the symbol shows in the line box, in pixels, from 0. */
  readonly width: number;
}

/**
 * A file with a record that this version cannot use, which must not be edited,
 * since saving would replace it: one that a later version of Inkline wrote, or
 * one that is damaged, or breaks the format.
 */
export type UnusableInk =
  | { readonly kind: "newer-version"; readonly detail: string }
  | { readonly kind: "damaged"; readonly detail: string };

/**
 * A base layer for drawing. Its pixels are tinted to the ink's grey, keeping
 * their alpha, since a base layer's ink is its alpha whatever its colours.
 */
export async function drawableBase(base: BaseLayer): Promise<DrawableBase> {
  const bitmap = await decodePng(base.png, limits.baseSize);
  try {
    const { surface, context } = canvas(bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = inkColor;
    context.fillRect(0, 0, surface.width, surface.height);
    return { ...base, image: surface };
  } finally {
    bitmap.close();
  }
}

/** A size in pixels as whole units, at least one. */
function drawnSize(pixels: number): number {
  return Math.max(1, Math.round(pixels * unitsPerPixel));
}

/**
 * A base layer from a picture's pixels: their ink, kept at the picture's own
 * resolution and scaled to fill the line box's height. Throws a `RangeError`
 * for a picture too large to open, or whose ink encodes to more bytes than a
 * base layer can hold.
 */
export async function baseFromPicture(
  bytes: Uint8Array,
): Promise<{ layer: BaseLayer; drawable: DrawableBase }> {
  const bitmap = await decodePng(bytes);
  let pixels: RgbaPixels;
  try {
    pixels = readPixels(bitmap);
  } finally {
    bitmap.close();
  }
  const { width, height } = pixels;
  const png = await encodePixels({
    width,
    height,
    data: inkPixels(width, height, inkAlpha(pixels)),
  });
  // A base layer that a record could not hold could never be saved.
  if (png.length > limits.baseBytes) {
    throw new RangeError(
      `a ${String(width)}×${String(height)} picture's ink takes ${String(png.length)} bytes, more than a base layer can hold (${String(limits.baseBytes)})`,
    );
  }
  const layer: BaseLayer = {
    x: 0,
    y: 0,
    width: drawnSize((width * lineBox.height) / height),
    height: drawnSize(lineBox.height),
    png,
  };
  return { layer, drawable: await drawableBase(layer) };
}

/**
 * A traced picture's ink, as `traceInk` finds it at `scale` document pixels
 * per pixel traced, ready to draw as a base layer at once: to preview it
 * while the threshold changes, without encoding it.
 */
export function previewInk(ink: TracedInk, scale: number): DrawableBase {
  const { surface, context } = canvas(ink.width, ink.height);
  context.putImageData(
    new ImageData(inkPixels(ink.width, ink.height, ink.alpha), ink.width),
    0,
    0,
  );
  return {
    x: Math.round(ink.x * unitsPerPixel),
    y: Math.round(ink.y * unitsPerPixel),
    width: drawnSize(ink.width * scale),
    height: drawnSize(ink.height * scale),
    image: surface,
  };
}

/**
 * A base layer of a traced picture's ink, as `traceInk` finds it at `scale`
 * document pixels per pixel traced. Throws a `RangeError` when the ink is
 * larger than a base layer can be, or encodes to more bytes than one can
 * hold.
 */
export async function baseFromInk(
  ink: TracedInk,
  scale: number,
): Promise<{ layer: BaseLayer; drawable: DrawableBase }> {
  const { width, height } = ink;
  if (width > limits.baseSize || height > limits.baseSize) {
    throw new RangeError(
      `the picture's ink is ${String(width)}×${String(height)} pixels, larger than a base layer can be (${String(limits.baseSize)} a side)`,
    );
  }
  const png = await encodePixels({
    width,
    height,
    data: inkPixels(width, height, ink.alpha),
  });
  if (png.length > limits.baseBytes) {
    throw new RangeError(
      `the picture's ink takes ${String(png.length)} bytes, more than a base layer can hold (${String(limits.baseBytes)})`,
    );
  }
  const layer: BaseLayer = {
    x: Math.round(ink.x * unitsPerPixel),
    y: Math.round(ink.y * unitsPerPixel),
    width: drawnSize(width * scale),
    height: drawnSize(height * scale),
    png,
  };
  return { layer, drawable: await drawableBase(layer) };
}

/**
 * Opens a file's pixels for editing as a base layer, whatever record it holds,
 * which saving would then replace: for a file without one, or to start a new
 * symbol from one whose record cannot be used.
 */
export async function openPicture(bytes: Uint8Array): Promise<EditableInk> {
  const { layer, drawable } = await baseFromPicture(bytes);
  return {
    kind: "editable",
    document: { strokes: [], base: layer },
    base: drawable,
    carried: preservableChunks(readChunks(bytes)),
    width: Math.round(layer.width / unitsPerPixel),
  };
}

/**
 * Opens a symbol file for editing. With a usable record, its strokes and base
 * layer are edited exactly. Without any record, the file's pixels become the
 * base layer. A record that cannot be used is reported, not opened, so that
 * saving does not replace it: {@link openPicture} can make a new symbol of the
 * file's pixels. Throws when the file is not a PNG that can be decoded.
 */
export async function openInk(
  bytes: Uint8Array,
): Promise<EditableInk | UnusableInk> {
  const chunks = readChunks(bytes);
  const source = await readInk(chunks);
  if (source.kind === "pixels") {
    if (source.reason === "none") return openPicture(bytes);
    return { kind: source.reason, detail: source.detail };
  }
  const { record: document, width } = source;
  const carried = preservableChunks(chunks);
  if (document.base === undefined) {
    return { kind: "editable", document, carried, width };
  }
  let base: DrawableBase;
  try {
    base = await drawableBase(document.base);
  } catch (error) {
    return { kind: "damaged", detail: String(error) };
  }
  return { kind: "editable", document, base, carried, width };
}

/** The decoded base layer placed where a record's base layer is. */
function placedBase(
  drawable: DrawableBase | undefined,
  layer: BaseLayer | undefined,
): DrawableBase | undefined {
  return drawable === undefined || layer === undefined
    ? undefined
    : {
        ...drawable,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
      };
}

/**
 * A base layer for drawing into a saved image: where it is drawn smaller than
 * its image, that image brought down to the pixels it falls on, so that each
 * takes in every source pixel it covers, as the format requires. A browser's
 * smoothing does not: Chromium 120's "high" misses most of a thin line reduced
 * five times, and bilinear halving leaves out pixels at an odd size. The
 * layer's place grows to whole pixels, where a draw copies them as they are,
 * and it stays right through a move by whole pixels, as saving's crop is.
 */
export function reducedBase(base: DrawableBase): DrawableBase {
  const { image, x, y, width, height } = base;
  const across = { size: image.width, start: x, length: width };
  const down = { size: image.height, start: y, length: height };
  if (!baseIsReduced(across, down)) return base;
  const reduced = reduceBaseAlpha(readPixels(image), across, down);
  const { surface, context } = canvas(reduced.width, reduced.height);
  context.putImageData(
    new ImageData(
      inkPixels(reduced.width, reduced.height, reduced.alpha),
      reduced.width,
    ),
    0,
    0,
  );
  return {
    x: reduced.across.start,
    y: reduced.down.start,
    width: reduced.across.length,
    height: reduced.down.length,
    image: surface,
  };
}

/** Whether a vertical span in pixels reaches into the line box. */
function inLineBox(top: number, bottom: number): boolean {
  return bottom > 0 && top < lineBox.height;
}

/**
 * Where pen strokes and the base layer could leave ink, in pixels, from
 * `outlines`, each stroke's bounds in turn.
 */
function inkAreas(
  document: InkDocument,
  outlines: readonly (Bounds | undefined)[],
  base: DrawableBase | undefined,
): Bounds[] {
  const areas: Bounds[] = [];
  document.strokes.forEach((stroke, index) => {
    const bounds = outlines[index];
    if (
      stroke.tool === "pen" &&
      bounds !== undefined &&
      inLineBox(bounds.top, bounds.bottom)
    ) {
      areas.push(bounds);
    }
  });
  if (base !== undefined) {
    const left = base.x / unitsPerPixel;
    const top = base.y / unitsPerPixel;
    const bottom = top + base.height / unitsPerPixel;
    if (inLineBox(top, bottom)) {
      areas.push({
        left,
        top,
        right: left + base.width / unitsPerPixel,
        bottom,
      });
    }
  }
  return areas;
}

/** What measuring a drawing found, and how it was measured. */
export interface InkMeasure {
  /** The ink the drawing leaves in the line box, if any. */
  readonly ink: Bounds | undefined;
  /** The document x its tiles start from, every {@link tileWidth} pixels. */
  readonly origin: number;
}

/** `found` with the ink of a tile `left` pixels along the document. */
function joinInk(
  found: Bounds | undefined,
  tile: Bounds | undefined,
  left: number,
): Bounds | undefined {
  if (tile === undefined) return found;
  return {
    left: Math.min(found?.left ?? Infinity, tile.left + left),
    top: Math.min(found?.top ?? Infinity, tile.top),
    right: Math.max(found?.right ?? -Infinity, tile.right + left),
    bottom: Math.max(found?.bottom ?? -Infinity, tile.bottom),
  };
}

/**
 * Measures the ink a document leaves in the line box, drawing it in tiles at
 * most {@link tileWidth} wide, each with only the strokes that reach it, so
 * that geometry far away or erased costs time but never a huge canvas.
 * Undefined when nothing in it could leave ink there.
 */
export function measureInk(
  document: InkDocument,
  base: DrawableBase | undefined,
): InkMeasure | undefined {
  const outlines = document.strokes.map(strokeBounds);
  const areas = inkAreas(document, outlines, base);
  if (areas.length === 0) return undefined;
  const origin = Math.floor(Math.min(...areas.map((area) => area.left))) - 2;
  const end = Math.ceil(Math.max(...areas.map((area) => area.right))) + 2;
  let ink: Bounds | undefined;
  for (let left = origin; left < end; left += tileWidth) {
    const width = Math.min(tileWidth, end - left);
    const reaching = document.strokes.filter((_, index) => {
      const bounds = outlines[index];
      return (
        bounds !== undefined &&
        bounds.right >= left - 1 &&
        bounds.left <= left + width + 1
      );
    });
    const { surface, context } = canvas(width, lineBox.height);
    drawInk(context, reaching, base, -left);
    ink = joinInk(
      ink,
      inkBounds(context.getImageData(0, 0, surface.width, surface.height)),
      left,
    );
  }
  return { ink, origin };
}

/** The ink a document leaves in the line box, as {@link measureInk} finds it. */
export function findInk(
  document: InkDocument,
  base: DrawableBase | undefined,
): Bounds | undefined {
  return measureInk(document, base)?.ink;
}

/**
 * What {@link measureInk} would find with a pen stroke added last to the
 * drawing `measure` is of, without drawing the rest: a pen only adds ink, so
 * the ink is what it was and what the stroke leaves. The stroke is drawn just
 * where a full measurement would draw it, at the same place in the same tiles,
 * as a shape's edge pixels depend a little on where it falls on a canvas; one
 * measured on a tile of its own could end a pixel away. Undefined when the
 * stroke reaches left of where the tiles start, which would move them all.
 */
export function measureAdded(
  measure: InkMeasure,
  stroke: Stroke,
): InkMeasure | undefined {
  const bounds = strokeBounds(stroke);
  if (bounds === undefined || !inLineBox(bounds.top, bounds.bottom)) {
    return measure;
  }
  const { origin } = measure;
  const start = Math.floor(bounds.left) - 2;
  if (start < origin) return undefined;
  const end = Math.ceil(bounds.right) + 2;
  const first = origin + Math.floor((start - origin) / tileWidth) * tileWidth;
  let { ink } = measure;
  for (let left = first; left < end; left += tileWidth) {
    const width = Math.min(tileWidth, end - left);
    const { context } = canvas(width, lineBox.height);
    drawInk(context, [stroke], undefined, -left);
    // Only the part of the tile that the stroke can reach.
    const from = Math.max(0, start - left);
    ink = joinInk(
      ink,
      inkBounds(context.getImageData(from, 0, width - from, lineBox.height)),
      left + from,
    );
  }
  return { ink, origin };
}

/** How far past a trial crop to look for ink, in pixels. */
const cropMargin = 64;

/**
 * Saves a document: crops it to its ink with a side bearing on each side,
 * draws the image from the cropped record itself, so that its pixels are what
 * the record draws, and writes both. `carried` chunks, from
 * {@link openInk}, are kept. Returns the file's bytes, its record, `left`,
 * the document x the image starts at, by which the record moved everything,
 * and the image's `width`.
 *
 * The crop is confirmed in the record's own coordinates, so that saving a
 * file again unchanged gives the same record and the same pixels. The
 * document's base layer gives its position and scale; `base` is its decoded
 * pixels, and must be given when the document has one. Throws a `RangeError`
 * when the ink is wider than an image can be, or when the crop would move a
 * far stroke past the format's coordinate limit, which only a record made
 * elsewhere can come near, and a `RecordError` when the record would be
 * refused on reading.
 */
export async function saveInk(
  document: InkDocument,
  base: DrawableBase | undefined,
  carried: readonly CarriedChunk[] = [],
): Promise<{
  bytes: Uint8Array;
  record: InkRecord;
  left: number;
  width: number;
}> {
  if (document.base !== undefined && base === undefined) {
    throw new Error("the document's base layer has not been decoded");
  }
  // The document says where its base layer is; the decoded layer supplies
  // only its pixels.
  const placedAtFirst = placedBase(base, document.base);
  const reduced =
    placedAtFirst === undefined ? undefined : reducedBase(placedAtFirst);
  let { left, width } = crop(findInk(document, reduced));
  for (let attempt = 0; ; attempt++) {
    if (width > limits.width) {
      throw new RangeError(
        `the ink is ${String(width)} pixels wide with its side bearings, wider than ${String(limits.width)}`,
      );
    }
    const record = recordFromDocument(document, left);
    if (!fitsFormat(record)) {
      throw new RangeError(
        "a stroke lies so far from the ink that cropping would move it past the format's coordinate limit",
      );
    }
    const placed =
      reduced === undefined
        ? undefined
        : { ...reduced, x: reduced.x - left * unitsPerPixel };
    const { surface, context } = canvas(width + cropMargin, lineBox.height);
    drawInk(context, record.strokes, placed, 0);
    const next = crop(
      inkBounds(context.getImageData(0, 0, surface.width, surface.height)),
    );
    // The ink is where the trial crop expects it, or the search has not
    // settled, which keeps the last crop: its pixels still match its record.
    if ((next.left === 0 && next.width === width) || attempt === 3) {
      const image = context.getImageData(0, 0, width, lineBox.height);
      greyInk(image.data);
      const bytes = await writeInkFile(
        await encodePixels(image),
        record,
        carried,
      );
      return { bytes, record, left, width };
    }
    left += next.left;
    width = next.width;
  }
}
