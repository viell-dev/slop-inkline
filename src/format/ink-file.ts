// Reading and writing symbol files: a PNG whose pixels show the symbol and
// whose `iTXt` chunk with the keyword `inkline` holds its record.

import {
  decodeInternationalText,
  encodeInternationalText,
  imageSize,
  readChunks,
  textKeyword,
  writeChunks,
  type Chunk,
} from "./png.ts";
import {
  formatName,
  parseRecord,
  serializeRecord,
  type InkRecord,
} from "./record.ts";

/** The file name ending that marks a PNG in the vault as a symbol. */
export const inkExtension = ".ink.png";

/** The `iTXt` keyword of the chunk that holds the record. */
export const recordKeyword = formatName;

/** Whether a file name or path names a symbol file, in any letter case. */
export function isInkPath(path: string): boolean {
  return path.toLowerCase().endsWith(inkExtension);
}

/**
 * What a symbol file holds. A record means the symbol can be edited stroke by
 * stroke; without one, the file's pixels are all there is.
 */
export type InkSource =
  | { readonly kind: "record"; readonly record: InkRecord }
  | {
      readonly kind: "pixels";
      /**
       * Why there is no usable record: none in the file, one a later version
       * wrote, one that breaks the format, or one whose size no longer matches
       * the image, as after resizing in another program.
       */
      readonly reason: "none" | "newer-version" | "invalid" | "stale";
      readonly detail?: string;
    };

function isRecordChunk(chunk: Chunk): boolean {
  return textKeyword(chunk) === recordKeyword;
}

/**
 * Reads what a PNG file holds. Throws `PngError` when the bytes are not a
 * well-formed PNG; anything wrong with the record only makes it unusable.
 */
export async function readInkFile(bytes: Uint8Array): Promise<InkSource> {
  const chunks = readChunks(bytes);
  const chunk = chunks.find(isRecordChunk);
  if (chunk === undefined) return { kind: "pixels", reason: "none" };
  let text: string;
  try {
    ({ text } = await decodeInternationalText(chunk));
  } catch (error) {
    return { kind: "pixels", reason: "invalid", detail: String(error) };
  }
  const parsed = parseRecord(text);
  if (!parsed.ok) {
    return { kind: "pixels", reason: parsed.reason, detail: parsed.detail };
  }
  const { width, height } = imageSize(chunks);
  const { box } = parsed.record;
  if (box.width !== width || box.height !== height) {
    return {
      kind: "pixels",
      reason: "stale",
      detail: `record is ${String(box.width)}×${String(box.height)}, image is ${String(width)}×${String(height)}`,
    };
  }
  return { kind: "record", record: parsed.record };
}

/**
 * Adds a record to a PNG, such as one a canvas encoded, right after its
 * header. Any record the PNG already holds is replaced; every other chunk is
 * kept as it is. Throws when the record's size differs from the image's.
 */
export async function writeInkFile(
  png: Uint8Array,
  record: InkRecord,
): Promise<Uint8Array> {
  const chunks = readChunks(png);
  const { width, height } = imageSize(chunks);
  if (record.box.width !== width || record.box.height !== height) {
    throw new Error(
      `record is ${String(record.box.width)}×${String(record.box.height)}, image is ${String(width)}×${String(height)}`,
    );
  }
  const kept = chunks.filter((chunk) => !isRecordChunk(chunk));
  const recordChunk = await encodeInternationalText({
    keyword: recordKeyword,
    text: serializeRecord(record),
  });
  const [header, ...rest] = kept;
  if (header === undefined) throw new Error("PNG has no chunks");
  return writeChunks([header, recordChunk, ...rest]);
}
