// Opening and saving symbols with the browser's own image decoder, encoder,
// and canvas. Everything here needs a browser; the rules it applies live in
// modules that unit tests can run.

import {
  preservableChunks,
  readInkFile,
  writeInkFile,
  type CarriedChunk,
} from "../format/ink-file.ts";
import { imageHeader, readChunks } from "../format/png.ts";
import {
  limits,
  unitsPerPixel,
  type BaseLayer,
  type InkRecord,
} from "../format/record.ts";
import {
  documentFromRecord,
  fitsFormat,
  recordFromDocument,
  type InkDocument,
} from "./document.ts";
import { crop, lineBox, type Bounds } from "./geometry.ts";
import { outlineBounds, strokeOutline } from "./outline.ts";
import {
  inkAlpha,
  inkBounds,
  inkPixels,
  repeatPixels,
  type RgbaPixels,
} from "./pixels.ts";
import { drawInk, inkColor, type DrawableBase } from "./render.ts";

/** The largest picture opened without a record, in pixels a side. */
export const maxPictureSize = 4096;

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
 * Colour profiles and gamma are ignored: the stored values are used as they
 * are, as the format specifies.
 */
export async function decodePng(
  bytes: Uint8Array,
  maxSize = maxPictureSize,
): Promise<ImageBitmap> {
  const { width, height } = imageHeader(readChunks(bytes));
  if (width > maxSize || height > maxSize) {
    throw new RangeError(
      `image is ${String(width)}×${String(height)}, larger than ${String(maxSize)} pixels a side`,
    );
  }
  return createImageBitmap(new Blob([bytes.slice()], { type: "image/png" }), {
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

/** Encodes RGBA pixels as a PNG file. */
export async function encodePixels(pixels: RgbaPixels): Promise<Uint8Array> {
  const { surface, context } = canvas(pixels.width, pixels.height);
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(pixels.data),
      pixels.width,
      pixels.height,
    ),
    0,
    0,
  );
  return encodeCanvas(surface);
}

async function encodeCanvas(surface: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await surface.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

/** A drawing ready to edit: the document, and its base layer decoded. */
export interface EditableInk {
  readonly kind: "editable";
  readonly document: InkDocument;
  readonly base?: DrawableBase;
  /**
   * `record` when the file's strokes were read; otherwise why its pixels
   * became the base layer: no record, an invalid one, one that no longer
   * matches the image, one whose base layer does not decode, or one with
   * another geometry that cannot be scaled to the line box within the
   * format's limits.
   */
  readonly from:
    "record" | "none" | "invalid" | "stale" | "undecodable-base" | "unworkable";
  /** The file's chunks to keep when it is saved again: text and the like. */
  readonly carried: readonly CarriedChunk[];
  /** How wide the symbol shows in the line box, in pixels, from 0. */
  readonly width: number;
}

/** A file that a later version of Inkline wrote, which must not be edited. */
export interface NewerInk {
  readonly kind: "newer-version";
  readonly detail: string;
}

/**
 * A base layer for drawing. Its pixels are tinted to the ink's grey, keeping
 * their alpha, since a base layer's ink is its alpha whatever its colours.
 */
async function drawableBase(base: BaseLayer): Promise<DrawableBase> {
  const bitmap = await decodePng(base.png, limits.baseSize);
  try {
    const { surface, context } = canvas(bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = inkColor;
    context.fillRect(0, 0, surface.width, surface.height);
    return {
      ...base,
      image: surface,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * A base layer from a picture's pixels: their ink, kept at the picture's own
 * resolution and scaled to fill the line box's height. A picture so small
 * that this would scale it more than the format allows has each pixel
 * repeated, which loses nothing, until it fits. Throws a `RangeError` for a
 * picture too large to open, or so wide for its height that repeating it
 * would make it too large.
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
  const repeat = Math.ceil(
    lineBox.height / (pixels.height * limits.baseScale.max),
  );
  const width = pixels.width * repeat;
  const height = pixels.height * repeat;
  if (width > limits.baseSize || height > limits.baseSize) {
    throw new RangeError(
      `a ${String(pixels.width)}×${String(pixels.height)} picture is too large for a base layer at this height`,
    );
  }
  const alpha = repeatPixels(
    inkAlpha(pixels),
    pixels.width,
    pixels.height,
    repeat,
  );
  const png = await encodePixels({
    width,
    height,
    data: inkPixels(width, height, alpha),
  });
  const layer: BaseLayer = { x: 0, y: 0, scale: lineBox.height / height, png };
  return { layer, drawable: await drawableBase(layer) };
}

async function fromPixels(
  bytes: Uint8Array,
  from: Exclude<EditableInk["from"], "record">,
  carried: readonly CarriedChunk[],
): Promise<EditableInk> {
  const { layer, drawable } = await baseFromPicture(bytes);
  return {
    kind: "editable",
    document: { strokes: [], base: layer },
    base: drawable,
    from,
    carried,
    width: Math.round(drawable.width * drawable.scale),
  };
}

/**
 * Opens a symbol file for editing. With a usable record, its strokes and
 * base layer are edited exactly. Without one, the file's pixels become the
 * base layer, and `from` says why. A record from a later version is reported,
 * not opened. Throws when the file is not a PNG that can be decoded.
 */
export async function openInk(
  bytes: Uint8Array,
): Promise<EditableInk | NewerInk> {
  const source = await readInkFile(bytes);
  const carried = preservableChunks(bytes);
  if (source.kind === "pixels") {
    if (source.reason === "newer-version") {
      return { kind: "newer-version", detail: source.detail ?? "" };
    }
    return fromPixels(bytes, source.reason, carried);
  }
  const document = documentFromRecord(source.record);
  if (document === undefined) return fromPixels(bytes, "unworkable", carried);
  const { box } = source.record;
  const width = Math.round((box.width * lineBox.pxPerEm) / box.pxPerEm);
  if (document.base === undefined) {
    return { kind: "editable", document, from: "record", carried, width };
  }
  let base: DrawableBase;
  try {
    base = await drawableBase(document.base);
  } catch {
    return fromPixels(bytes, "undecodable-base", carried);
  }
  return { kind: "editable", document, base, from: "record", carried, width };
}

/** The decoded base layer placed where a record's base layer is. */
function placedBase(
  drawable: DrawableBase | undefined,
  layer: BaseLayer | undefined,
): DrawableBase | undefined {
  return drawable === undefined || layer === undefined
    ? undefined
    : { ...drawable, x: layer.x, y: layer.y, scale: layer.scale };
}

/** Whether a vertical span in pixels reaches into the line box. */
function inLineBox(top: number, bottom: number): boolean {
  return bottom > 0 && top < lineBox.height;
}

/** Where pen strokes and the base layer could leave ink, in pixels. */
function inkAreas(
  document: InkDocument,
  base: DrawableBase | undefined,
): Bounds[] {
  const areas: Bounds[] = [];
  for (const stroke of document.strokes) {
    if (stroke.tool !== "pen") continue;
    const bounds = outlineBounds(strokeOutline(stroke));
    if (bounds !== undefined && inLineBox(bounds.top, bounds.bottom)) {
      areas.push(bounds);
    }
  }
  if (base !== undefined) {
    const left = base.x / unitsPerPixel;
    const top = base.y / unitsPerPixel;
    const bottom = top + base.height * base.scale;
    if (inLineBox(top, bottom)) {
      areas.push({ left, top, right: left + base.width * base.scale, bottom });
    }
  }
  return areas;
}

/**
 * Finds the ink a document leaves in the line box, drawing it in tiles at
 * most {@link tileWidth} wide, each with only the strokes that reach it, so
 * that geometry far away or erased costs time but never a huge canvas.
 */
function findInk(
  document: InkDocument,
  base: DrawableBase | undefined,
): Bounds | undefined {
  const areas = inkAreas(document, base);
  if (areas.length === 0) return undefined;
  const start = Math.floor(Math.min(...areas.map((area) => area.left))) - 2;
  const end = Math.ceil(Math.max(...areas.map((area) => area.right))) + 2;
  const outlines = document.strokes.map((stroke) =>
    outlineBounds(strokeOutline(stroke)),
  );
  let found: Bounds | undefined;
  for (let left = start; left < end; left += tileWidth) {
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
    const tile = inkBounds(
      context.getImageData(0, 0, surface.width, surface.height),
    );
    if (tile === undefined) continue;
    found = {
      left: Math.min(found?.left ?? Infinity, tile.left + left),
      top: Math.min(found?.top ?? Infinity, tile.top),
      right: Math.max(found?.right ?? -Infinity, tile.right + left),
      bottom: Math.max(found?.bottom ?? -Infinity, tile.bottom),
    };
  }
  return found;
}

/** How far past a trial crop to look for ink, in pixels. */
const cropMargin = 64;

/**
 * Saves a document: crops it to its ink with a side bearing on each side,
 * draws the image from the cropped record itself, so that its pixels are
 * exactly what the record draws, and writes both. `carried` chunks, from
 * {@link openInk}, are kept. Returns the file's bytes, its record, and
 * `left`, the document x the image starts at, by which the record moved
 * everything.
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
): Promise<{ bytes: Uint8Array; record: InkRecord; left: number }> {
  if (document.base !== undefined && base === undefined) {
    throw new Error("the document's base layer has not been decoded");
  }
  // The document says where its base layer is; the decoded layer supplies
  // only its pixels.
  let { left, width } = crop(
    findInk(document, placedBase(base, document.base)),
  );
  for (let attempt = 0; ; attempt++) {
    if (width > limits.size.max) {
      throw new RangeError(
        `the ink is ${String(width)} pixels wide with its side bearings, wider than ${String(limits.size.max)}`,
      );
    }
    const record = recordFromDocument(document, left, width);
    if (!fitsFormat(record)) {
      throw new RangeError(
        "a stroke lies so far from the ink that cropping would move it past the format's coordinate limit",
      );
    }
    const placed = placedBase(base, record.base);
    const { surface, context } = canvas(width + cropMargin, lineBox.height);
    drawInk(context, record.strokes, placed, 0);
    const next = crop(
      inkBounds(context.getImageData(0, 0, surface.width, surface.height)),
    );
    // The ink is where the trial crop expects it, or the search has not
    // settled, which keeps the last crop: its pixels still match its record.
    if ((next.left === 0 && next.width === width) || attempt === 3) {
      const image = canvas(width, lineBox.height);
      image.context.putImageData(
        context.getImageData(0, 0, width, lineBox.height),
        0,
        0,
      );
      const bytes = await writeInkFile(
        await encodeCanvas(image.surface),
        record,
        carried,
      );
      return { bytes, record, left };
    }
    left += next.left;
    width = next.width;
  }
}
