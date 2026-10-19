// Opening and saving symbols with the browser's own image decoder, encoder,
// and canvas. Everything here needs a browser; the rules it applies live in
// modules that unit tests can run.

import { readInkFile, writeInkFile } from "../format/ink-file.ts";
import { imageHeader, readChunks } from "../format/png.ts";
import {
  limits,
  unitsPerPixel,
  type BaseLayer,
  type InkRecord,
} from "../format/record.ts";
import {
  documentFromRecord,
  recordFromDocument,
  type InkDocument,
} from "./document.ts";
import { crop, lineBox, type Bounds } from "./geometry.ts";
import { outlineBounds, strokeOutline } from "./outline.ts";
import { inkAlpha, inkBounds, inkPixels, type RgbaPixels } from "./pixels.ts";
import { drawInk, type DrawableBase } from "./render.ts";

/** The largest picture opened without a record, in pixels a side. */
export const maxPictureSize = 4096;

function canvas(width: number, height: number) {
  const surface = new OffscreenCanvas(width, height);
  const context = surface.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("no 2D canvas context");
  return { surface, context };
}

/**
 * Decodes a PNG file, after checking its structure and that it is at most
 * `maxSize` pixels a side, so that a crafted file cannot claim a huge image.
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
   * matches the image, or a base layer that does not decode.
   */
  readonly from: "record" | "none" | "invalid" | "stale" | "undecodable-base";
}

/** A file that a later version of Inkline wrote, which must not be edited. */
export interface NewerInk {
  readonly kind: "newer-version";
  readonly detail: string;
}

async function drawableBase(base: BaseLayer): Promise<DrawableBase> {
  const image = await decodePng(base.png, limits.baseSize);
  return { ...base, image, width: image.width, height: image.height };
}

/**
 * A base layer from a picture's pixels: their ink alpha, kept at the
 * picture's own resolution and scaled to fill the line box's height.
 */
export async function baseFromPicture(
  bytes: Uint8Array,
): Promise<{ layer: BaseLayer; drawable: DrawableBase }> {
  const bitmap = await decodePng(bytes);
  try {
    const pixels = readPixels(bitmap);
    const { width, height } = pixels;
    const data = inkPixels(width, height, inkAlpha(pixels));
    const png = await encodePixels({ width, height, data });
    const layer: BaseLayer = {
      x: 0,
      y: 0,
      scale: lineBox.height / height,
      png,
    };
    const image = await decodePng(png);
    return { layer, drawable: { ...layer, image, width, height } };
  } finally {
    bitmap.close();
  }
}

/**
 * Opens a symbol file for editing. With a usable record, its strokes and
 * base layer are edited exactly. Without one, the file's pixels become the
 * base layer. A record from a later version is reported, not opened.
 * Throws when the file is not a PNG that can be decoded.
 */
export async function openInk(
  bytes: Uint8Array,
): Promise<EditableInk | NewerInk> {
  const source = await readInkFile(bytes);
  if (source.kind === "record") {
    const { record } = source;
    const document = documentFromRecord(record);
    if (document.base === undefined) {
      return { kind: "editable", document, from: "record" };
    }
    try {
      const base = await drawableBase(document.base);
      return { kind: "editable", document, base, from: "record" };
    } catch {
      const { layer, drawable } = await baseFromPicture(bytes);
      return {
        kind: "editable",
        document: { strokes: [], base: layer },
        base: drawable,
        from: "undecodable-base",
      };
    }
  }
  if (source.reason === "newer-version") {
    return { kind: "newer-version", detail: source.detail ?? "" };
  }
  const { layer, drawable } = await baseFromPicture(bytes);
  return {
    kind: "editable",
    document: { strokes: [], base: layer },
    base: drawable,
    from: source.reason,
  };
}

/** How far a document's strokes and base layer reach left and right. */
function horizontalExtent(
  document: InkDocument,
  base: DrawableBase | undefined,
): { left: number; right: number } | undefined {
  const boxes: Bounds[] = [];
  for (const stroke of document.strokes) {
    if (stroke.tool !== "pen") continue;
    const bounds = outlineBounds(strokeOutline(stroke));
    if (bounds !== undefined) boxes.push(bounds);
  }
  if (base !== undefined) {
    const left = base.x / unitsPerPixel;
    boxes.push({
      left,
      top: 0,
      right: left + base.width * base.scale,
      bottom: 0,
    });
  }
  if (boxes.length === 0) return undefined;
  return {
    left: Math.floor(Math.min(...boxes.map((box) => box.left))) - 2,
    right: Math.ceil(Math.max(...boxes.map((box) => box.right))) + 2,
  };
}

/** Draws a document on a new canvas `width` pixels wide from `left`. */
export function renderDocument(
  document: InkDocument,
  base: DrawableBase | undefined,
  left: number,
  width: number,
): OffscreenCanvas {
  const { surface, context } = canvas(width, lineBox.height);
  drawInk(context, document.strokes, base, -left);
  return surface;
}

/**
 * Saves a document: draws it, crops the image to its ink with a side bearing
 * on each side, and adds the record. Returns the file's bytes and the record
 * it holds. Throws a `RangeError` when the drawing is wider than an image can
 * be, and a `RecordError` when the record would be refused on reading.
 */
export async function saveInk(
  document: InkDocument,
  base: DrawableBase | undefined,
): Promise<{ bytes: Uint8Array; record: InkRecord }> {
  const extent = horizontalExtent(document, base);
  let bounds: Bounds | undefined;
  if (extent !== undefined) {
    const width = extent.right - extent.left;
    if (width > limits.size.max) {
      throw new RangeError(
        `the drawing is ${String(width)} pixels wide, wider than ${String(limits.size.max)}`,
      );
    }
    const found = inkBounds(
      readPixels(renderDocument(document, base, extent.left, width)),
    );
    bounds =
      found === undefined
        ? undefined
        : {
            ...found,
            left: found.left + extent.left,
            right: found.right + extent.left,
          };
  }
  const { left, width } = crop(bounds);
  const record = recordFromDocument(document, left, width);
  const image = renderDocument(document, base, left, width);
  const bytes = await writeInkFile(await encodeCanvas(image), record);
  return { bytes, record };
}
