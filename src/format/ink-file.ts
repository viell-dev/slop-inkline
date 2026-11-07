// Reading and writing symbol files: a PNG whose pixels show the symbol and
// whose `inKL` chunk holds its version and its record.

import {
  deflate,
  imageHeader,
  inflate,
  maxChunks,
  readChunks,
  writeChunks,
  type Chunk,
} from "./png.ts";
import {
  baseImageProblem,
  formatVersion,
  imageHeight,
  limits,
  parseRecord,
  serializeRecord,
  type InkRecord,
} from "./record.ts";
import { isTextChunk } from "./text.ts";

/** The file name ending that marks a PNG in the vault as a symbol. */
export const inkExtension = ".ink.png";

/**
 * The type of the chunk that holds the record: ancillary, so that programs
 * that do not know it still show the image; private; and unsafe to copy, as
 * the record describes the image, so that a program that changes a critical
 * chunk drops it rather than leave it describing something else.
 */
export const recordChunkType = "inKL";

/** How many bytes open the record chunk with the format version. */
const versionBytes = 4;

/**
 * Whether a file name or path names a symbol file, in any case of its ASCII
 * letters. No other letter counts, such as the Kelvin sign, which lowercases
 * to `k`: a reader comparing ASCII letters would not take that file for one.
 */
export function isInkPath(path: string): boolean {
  return /\.ink\.png$/i.test(path);
}

/**
 * What a symbol file holds. A record means the symbol can be edited stroke by
 * stroke; without one, the file's pixels are all there is. `newer-version` and
 * `damaged` mean a record that this version cannot use is there, which a save
 * must not replace unnoticed.
 */
export type InkSource =
  | {
      readonly kind: "record";
      readonly record: InkRecord;
      /** The image's width, in pixels. */
      readonly width: number;
    }
  | { readonly kind: "pixels"; readonly reason: "none" }
  | {
      readonly kind: "pixels";
      readonly reason: "newer-version" | "damaged";
      readonly detail: string;
    };

/** Thrown by {@link writeInkFile} for a record it must not write. */
export class RecordError extends Error {
  override name = "RecordError";
}

function isRecordChunk(chunk: Chunk): boolean {
  return chunk.type === recordChunkType;
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
const beforeDataOnly = new Set(["pHYs"]);

/**
 * The chunks of a file that a rewrite should carry over: ancillary chunks
 * marked safe to copy, such as text, which PNG lets an editor keep however it
 * changes the pixels. Each keeps the side of the image data it was on, as PNG
 * requires of editors. Chunks marked unsafe to copy, such as gamma or colour
 * profiles, describe the old pixels and are dropped; so is `eXIf`, which is
 * marked safe but can turn the image, and any chunk with a wrong CRC.
 */
export function preservableChunks(chunks: readonly Chunk[]): CarriedChunk[] {
  const lastData = chunks.findLastIndex((chunk) => chunk.type === "IDAT");
  return chunks.flatMap((chunk, index) =>
    isSafeToCopy(chunk.type) && chunk.type !== "eXIf" && chunk.damaged !== true
      ? [
          {
            chunk: { type: chunk.type, data: chunk.data.slice() },
            afterData: index > lastData && !beforeDataOnly.has(chunk.type),
          },
        ]
      : [],
  );
}

/**
 * The format version a record chunk says it has, or undefined when it holds
 * none: a chunk too short for one, or a version of 0.
 */
function chunkVersion({ data }: Chunk): number | undefined {
  if (data.length < versionBytes) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, versionBytes);
  const version = view.getUint32(0);
  return version === 0 ? undefined : version;
}

/**
 * Reads what a PNG's chunks hold. The version comes first and alone: a later
 * version may hold anything after it, of any size, and is known by that
 * whatever this version would make of the rest.
 */
export async function readInk(chunks: readonly Chunk[]): Promise<InkSource> {
  const found = chunks.filter(isRecordChunk);
  const [chunk] = found;
  if (chunk === undefined) return { kind: "pixels", reason: "none" };
  const damaged = (detail: string): InkSource => ({
    kind: "pixels",
    reason: "damaged",
    detail,
  });
  for (const each of found) {
    const version = each.damaged === true ? undefined : chunkVersion(each);
    if (version !== undefined && version > formatVersion) {
      return {
        kind: "pixels",
        reason: "newer-version",
        detail: `version ${String(version)} is newer than ${String(formatVersion)}`,
      };
    }
  }
  if (found.length > 1) return damaged("more than one record chunk");
  if (chunk.damaged === true) return damaged("bad CRC in the record chunk");
  if (chunkVersion(chunk) === undefined) return damaged("no format version");
  const { width, height } = imageHeader(chunks);
  if (height !== imageHeight || width > limits.width) {
    return damaged(`the image is ${String(width)}×${String(height)}`);
  }
  let text: string;
  try {
    const bytes = await inflate(chunk.data.subarray(versionBytes), {
      limit: limits.text,
    });
    // `ignoreBOM` keeps a byte order mark in the text, for the parser to
    // refuse, rather than dropping it.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (error) {
    return damaged(String(error));
  }
  const parsed = parseRecord(text);
  if (!parsed.ok) return damaged(parsed.detail);
  const { record } = parsed;
  const problem =
    record.base === undefined
      ? undefined
      : await baseImageProblem(record.base.png);
  return problem === undefined
    ? { kind: "record", record, width }
    : damaged(problem);
}

/**
 * Reads what a PNG file holds. Throws `PngError` when the bytes fail the
 * format's check of a PNG's structure; anything wrong with the record only
 * makes it unusable, and the file's own image data is not looked at.
 */
export async function readInkFile(bytes: Uint8Array): Promise<InkSource> {
  return await readInk(readChunks(bytes));
}

/** The chunk that holds a record, whose text fits the limit. */
async function recordChunk(text: string): Promise<Chunk> {
  const compressed = await deflate(new TextEncoder().encode(text));
  const data = new Uint8Array(versionBytes + compressed.length);
  new DataView(data.buffer).setUint32(0, formatVersion);
  data.set(compressed, versionBytes);
  return { type: recordChunkType, data };
}

/**
 * Adds a record to a PNG, such as one a canvas encoded, right after its
 * header, keeping every other chunk and the pixels as they are. An earlier
 * record is replaced, unless this version cannot use it: replacing that would
 * lose what it holds. `carried` chunks, from {@link preservableChunks} of the
 * file being replaced, go back to their side of the image data: after the
 * record, or after the last `IDAT`. Text chunks are always carried; other
 * types only where the PNG has none of its own.
 *
 * Throws `PngError` when the bytes are not a well-formed PNG, and
 * {@link RecordError} when the image is not one a symbol can be, readers would
 * refuse the record, such as for being longer than the text limit, or the file
 * would hold more chunks than {@link readChunks} takes: a file this returns can
 * always be read back.
 */
export async function writeInkFile(
  png: Uint8Array,
  record: InkRecord,
  carried: readonly CarriedChunk[] = [],
): Promise<Uint8Array> {
  const chunks = readChunks(png);
  const { width, height } = imageHeader(chunks);
  if (height !== imageHeight || width > limits.width) {
    throw new RecordError(
      `a symbol's image cannot be ${String(width)}×${String(height)}`,
    );
  }
  const existing = await readInk(chunks);
  if (existing.kind === "pixels" && existing.reason !== "none") {
    throw new RecordError(`the file's record is unusable: ${existing.detail}`);
  }
  const text = serializeRecord(record);
  if (new TextEncoder().encode(text).length > limits.text) {
    throw new RecordError("record text is too long");
  }
  const check = parseRecord(text);
  if (!check.ok) {
    throw new RecordError(`record breaks the format: ${check.detail}`);
  }
  const problem =
    record.base === undefined
      ? undefined
      : await baseImageProblem(record.base.png);
  if (problem !== undefined) {
    throw new RecordError(`record breaks the format: ${problem}`);
  }
  const chunk = await recordChunk(text);
  const [header, ...rest] = chunks.filter((each) => !isRecordChunk(each));
  if (header === undefined) throw new RecordError("PNG has no chunks");
  const present = new Set(rest.map((each) => each.type));
  // Text chunks may repeat; other types are kept only if the PNG has none.
  const kept = carried.filter(
    ({ chunk: each }) =>
      !isRecordChunk(each) &&
      isSafeToCopy(each.type) &&
      (isTextChunk(each) || !present.has(each.type)),
  );
  const before = kept
    .filter(
      ({ chunk: each, afterData }) =>
        !afterData || beforeDataOnly.has(each.type),
    )
    .map(({ chunk: each }) => each);
  const after = kept
    .filter(
      ({ chunk: each, afterData }) =>
        afterData && !beforeDataOnly.has(each.type),
    )
    .map(({ chunk: each }) => each);
  const lastData = rest.findLastIndex((each) => each.type === "IDAT");
  const written = [
    header,
    chunk,
    ...before,
    ...rest.slice(0, lastData + 1),
    ...after,
    ...rest.slice(lastData + 1),
  ];
  if (written.length > maxChunks) {
    throw new RecordError(
      `the file would hold more than ${String(maxChunks)} chunks`,
    );
  }
  return writeChunks(written);
}
