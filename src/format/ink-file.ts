// Reading and writing symbol files: a PNG whose pixels show the symbol and
// whose `iTXt` chunk with the keyword `inkline` holds its record.

import {
  decodeInternationalText,
  encodeInternationalText,
  imageHeader,
  readChunks,
  textKeyword,
  writeChunks,
  type Chunk,
} from "./png.ts";
import {
  formatName,
  limits,
  parseRecord,
  serializeRecord,
  type InkRecord,
  type ParseResult,
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

/** Thrown by {@link writeInkFile} for a record it must not write. */
export class RecordError extends Error {
  override name = "RecordError";
}

function isRecordChunk(chunk: Chunk): boolean {
  return textKeyword(chunk) === recordKeyword;
}

/** A chunk to carry into a rewritten file, and which side of the image data it was on. */
export interface CarriedChunk {
  readonly chunk: Chunk;
  readonly afterData: boolean;
}

/** Whether PNG marks a chunk type ancillary and safe to copy. */
function isSafeToCopy(type: string): boolean {
  // A lowercase first letter marks an ancillary chunk, a lowercase fourth
  // letter one that is safe to copy.
  return /^[a-z][A-Za-z][A-Z][a-z]$/.test(type);
}

/** Known safe-to-copy chunks that PNG requires before the image data. */
const beforeDataOnly = new Set(["pHYs", "eXIf"]);

/**
 * The chunks of a file that a rewrite should carry over: ancillary chunks
 * marked safe to copy, such as text, which PNG lets an editor keep however it
 * changes the pixels, other than the record. Each keeps the side of the image
 * data it was on, as PNG requires of editors. Chunks marked unsafe to copy,
 * such as gamma or colour profiles, describe the old pixels and are dropped.
 */
export function preservableChunks(bytes: Uint8Array): CarriedChunk[] {
  const chunks = readChunks(bytes);
  const lastData = chunks.findLastIndex((chunk) => chunk.type === "IDAT");
  return chunks.flatMap((chunk, index) =>
    isSafeToCopy(chunk.type) && !isRecordChunk(chunk)
      ? [
          {
            chunk,
            afterData: index > lastData && !beforeDataOnly.has(chunk.type),
          },
        ]
      : [],
  );
}

/** The first record chunk's parsed text, or undefined when there is none. */
async function parseRecordChunk(
  chunks: readonly Chunk[],
): Promise<ParseResult | undefined> {
  const chunk = chunks.find(isRecordChunk);
  if (chunk === undefined) return undefined;
  try {
    const { text } = await decodeInternationalText(chunk, limits.text);
    return parseRecord(text);
  } catch (error) {
    return { ok: false, reason: "invalid", detail: String(error) };
  }
}

/**
 * Reads what a PNG file holds. Throws `PngError` when the bytes are not a
 * well-formed PNG; anything wrong with the record only makes it unusable.
 */
export async function readInkFile(bytes: Uint8Array): Promise<InkSource> {
  const chunks = readChunks(bytes);
  const parsed = await parseRecordChunk(chunks);
  if (parsed === undefined) return { kind: "pixels", reason: "none" };
  if (!parsed.ok) {
    return { kind: "pixels", reason: parsed.reason, detail: parsed.detail };
  }
  const { width, height } = imageHeader(chunks);
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
 * header, keeping every other chunk and the pixels as they are. An earlier
 * record is replaced, unless a later version of Inkline wrote it: replacing
 * that would lose what it recorded. `carried` chunks, from
 * {@link preservableChunks} of the file being replaced, go back to their side
 * of the image data: after the record, or after the last `IDAT`. Text chunks
 * are always carried; other types only where the PNG has none of its own.
 *
 * Throws `PngError` when the bytes are not a well-formed PNG, and
 * {@link RecordError} when the record's size differs from the image's or
 * readers would refuse the record, such as for being longer than the text
 * limit: a file this returns can always be read back.
 */
export async function writeInkFile(
  png: Uint8Array,
  record: InkRecord,
  carried: readonly CarriedChunk[] = [],
): Promise<Uint8Array> {
  const chunks = readChunks(png);
  const { width, height } = imageHeader(chunks);
  if (record.box.width !== width || record.box.height !== height) {
    throw new RecordError(
      `record is ${String(record.box.width)}×${String(record.box.height)}, image is ${String(width)}×${String(height)}`,
    );
  }
  const existing = await parseRecordChunk(chunks);
  if (existing?.ok === false && existing.reason === "newer-version") {
    throw new RecordError(
      `the file holds a record from a later version: ${existing.detail}`,
    );
  }
  const text = serializeRecord(record);
  if (new TextEncoder().encode(text).length > limits.text) {
    throw new RecordError("record text is too long");
  }
  const check = parseRecord(text);
  if (!check.ok) {
    throw new RecordError(`record breaks the format: ${check.detail}`);
  }
  const recordChunk = await encodeInternationalText({
    keyword: recordKeyword,
    text,
  });
  const [header, ...rest] = chunks.filter((chunk) => !isRecordChunk(chunk));
  if (header === undefined) throw new RecordError("PNG has no chunks");
  const present = new Set(rest.map((chunk) => chunk.type));
  // Text chunks may repeat; other types are kept only if the PNG has none.
  const kept = carried.filter(
    ({ chunk }) =>
      !isRecordChunk(chunk) &&
      isSafeToCopy(chunk.type) &&
      (/^(?:tEXt|zTXt|iTXt)$/.test(chunk.type) || !present.has(chunk.type)),
  );
  const before = kept
    .filter(
      ({ chunk, afterData }) => !afterData || beforeDataOnly.has(chunk.type),
    )
    .map(({ chunk }) => chunk);
  const after = kept
    .filter(
      ({ chunk, afterData }) => afterData && !beforeDataOnly.has(chunk.type),
    )
    .map(({ chunk }) => chunk);
  const lastData = rest.findLastIndex((chunk) => chunk.type === "IDAT");
  return writeChunks([
    header,
    recordChunk,
    ...before,
    ...rest.slice(0, lastData + 1),
    ...after,
    ...rest.slice(lastData + 1),
  ]);
}
