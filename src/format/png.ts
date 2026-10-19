// PNG chunk reading and writing, enough to carry Inkline's record inside a
// PNG, and the encoding of a symbol's pixels. Pixels are never decoded here.
// See https://www.w3.org/TR/png-3/ for the format.

/** The eight bytes every PNG file starts with. */
export const pngSignature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

export interface Chunk {
  /** The four-letter chunk type, such as `IHDR`. */
  readonly type: string;
  readonly data: Uint8Array;
}

export class PngError extends Error {
  override name = "PngError";
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 that PNG uses, over the given byte sequences in order. */
export function crc32(...parts: readonly Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) {
      crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function typeBytes(type: string): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(type)) {
    throw new PngError(`invalid chunk type ${JSON.stringify(type)}`);
  }
  return Uint8Array.from(type, (char) => char.charCodeAt(0));
}

/** Whether the bytes start with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= pngSignature.length &&
    pngSignature.every((byte, index) => bytes[index] === byte)
  );
}

/** An image's header fields, from its `IHDR` chunk. */
export interface ImageHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlaced: boolean;
}

/** The bit depths PNG allows for each colour type. */
const bitDepths: ReadonlyMap<number, readonly number[]> = new Map([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
]);

function parseHeader(data: Uint8Array): ImageHeader {
  if (data.length !== 13) throw new PngError("IHDR is not 13 bytes");
  const view = new DataView(data.buffer, data.byteOffset, 13);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const [bitDepth = 0, colorType = 0, compression, filter, interlace] =
    data.subarray(8);
  if (width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff) {
    throw new PngError("IHDR has an invalid size");
  }
  if (!bitDepths.get(colorType)?.includes(bitDepth)) {
    throw new PngError("IHDR has an invalid bit depth or colour type");
  }
  if (
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1)
  ) {
    throw new PngError("IHDR has an invalid method");
  }
  return { width, height, bitDepth, colorType, interlaced: interlace === 1 };
}

/**
 * Checks the critical chunks: one valid `IHDR` first, a `PLTE` before the
 * image data where the colour type needs one and never where it forbids one,
 * consecutive `IDAT` chunks, and an empty `IEND` last.
 */
function checkStructure(chunks: readonly Chunk[]): void {
  const [first] = chunks;
  if (first?.type !== "IHDR") throw new PngError("first chunk is not IHDR");
  const { bitDepth, colorType } = parseHeader(first.data);
  const count = (type: string): number =>
    chunks.filter((chunk) => chunk.type === type).length;
  if (count("IHDR") !== 1) throw new PngError("more than one IHDR chunk");
  const firstData = chunks.findIndex((chunk) => chunk.type === "IDAT");
  if (firstData === -1) throw new PngError("no IDAT chunk");
  const lastData = chunks.findLastIndex((chunk) => chunk.type === "IDAT");
  if (lastData - firstData + 1 !== count("IDAT")) {
    throw new PngError("IDAT chunks are not consecutive");
  }
  const palette = chunks.findIndex((chunk) => chunk.type === "PLTE");
  if (count("PLTE") > 1) throw new PngError("more than one PLTE chunk");
  if (colorType === 3 && palette === -1) throw new PngError("no PLTE chunk");
  if ((colorType === 0 || colorType === 4) && palette !== -1) {
    throw new PngError("PLTE chunk in a greyscale image");
  }
  if (palette > firstData) throw new PngError("PLTE chunk after IDAT");
  const paletteLength = chunks[palette]?.data.length;
  if (paletteLength !== undefined) {
    const entries = paletteLength / 3;
    const most = colorType === 3 ? 2 ** bitDepth : 256;
    if (!Number.isInteger(entries) || entries < 1 || entries > most) {
      throw new PngError(`PLTE does not hold 1 to ${String(most)} RGB entries`);
    }
  }
  const last = chunks.at(-1);
  if (last?.type !== "IEND" || last.data.length !== 0) {
    throw new PngError("IEND is not empty");
  }
}

/**
 * Splits a PNG file into its chunks, checking the signature, each chunk's
 * length, type, and CRC, and the critical chunks' structure: one valid `IHDR`
 * first, a `PLTE` where needed, consecutive `IDAT`, and an empty `IEND` last.
 * Bytes after `IEND` are ignored, as PNG decoders do. Pixels are not decoded.
 */
export function readChunks(bytes: Uint8Array): Chunk[] {
  if (!isPng(bytes)) throw new PngError("not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = pngSignature.length;
  for (;;) {
    if (offset + 12 > bytes.length) throw new PngError("truncated chunk");
    const length = view.getUint32(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > 0x7fffffff || dataEnd + 4 > bytes.length) {
      throw new PngError("truncated chunk");
    }
    const type = String.fromCharCode(...bytes.subarray(typeStart, dataStart));
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new PngError("invalid chunk type");
    }
    const data = bytes.slice(dataStart, dataEnd);
    const crc = crc32(bytes.subarray(typeStart, dataStart), data);
    if (crc !== view.getUint32(dataEnd)) {
      throw new PngError(`bad CRC in ${type} chunk`);
    }
    if (chunks.length === 0 && type !== "IHDR") {
      throw new PngError("first chunk is not IHDR");
    }
    chunks.push({ type, data });
    offset = dataEnd + 4;
    if (type === "IEND") {
      checkStructure(chunks);
      return chunks;
    }
  }
}
/** Joins chunks into a PNG file, computing each length and CRC. */
export function writeChunks(chunks: readonly Chunk[]): Uint8Array {
  const size = chunks.reduce(
    (total, chunk) => total + 12 + chunk.data.length,
    pngSignature.length,
  );
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(pngSignature);
  let offset = pngSignature.length;
  for (const chunk of chunks) {
    const type = typeBytes(chunk.type);
    view.setUint32(offset, chunk.data.length);
    bytes.set(type, offset + 4);
    bytes.set(chunk.data, offset + 8);
    view.setUint32(offset + 8 + chunk.data.length, crc32(type, chunk.data));
    offset += 12 + chunk.data.length;
  }
  return bytes;
}

/** The image's header fields, from chunks that {@link readChunks} checked. */
export function imageHeader(chunks: readonly Chunk[]): ImageHeader {
  const [header] = chunks;
  if (header?.type !== "IHDR") throw new PngError("first chunk is not IHDR");
  return parseHeader(header.data);
}

/** The most that {@link inflate} produces by default: 16 MiB. */
export const maxInflatedBytes = 16 * 1024 * 1024;

/**
 * How much input the streams get at a time. Chromium inflates each input
 * chunk whole before handing out its output, so a small slice bounds how far
 * one chunk can expand past the limit: zlib expands at most about 1,032 times.
 */
const sliceBytes = 1024;

export interface StreamOptions {
  /** The most output to accept, in bytes. */
  readonly limit?: number;
  /** Called with the input bytes consumed so far, after each slice. */
  readonly onInput?: (consumed: number) => void;
}

async function transform(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  { limit = Infinity, onInput }: StreamOptions,
): Promise<Uint8Array> {
  let consumed = 0;
  // The input is handed over a slice at a time, only as the stream asks for
  // more, which it does only once its output has been read: stopping reading
  // stops the work.
  const input = new ReadableStream<BufferSource>(
    {
      pull(controller) {
        if (consumed >= bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(consumed + sliceBytes, bytes.length);
        // A copy, since the streams take only bytes backed by an ArrayBuffer.
        controller.enqueue(bytes.slice(consumed, end));
        consumed = end;
        onInput?.(consumed);
      },
    },
    { highWaterMark: 0 },
  );
  const reader = input.pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new PngError(`data expands beyond ${String(limit)} bytes`);
    }
    parts.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/** Compresses with zlib, the only compression method PNG defines. */
export function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return transform(bytes, new CompressionStream("deflate"), {});
}

/**
 * Decompresses zlib data, failing on corrupt or truncated input and as soon
 * as the output passes `limit` bytes (16 MiB by default), so that a crafted
 * file cannot exhaust memory.
 */
export function inflate(
  bytes: Uint8Array,
  { limit = maxInflatedBytes, onInput }: StreamOptions = {},
): Promise<Uint8Array> {
  return transform(bytes, new DecompressionStream("deflate"), {
    limit,
    ...(onInput === undefined ? {} : { onInput }),
  });
}
/** The predictor of PNG's Paeth filter, from the bytes left, up, and up-left. */
function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/** A row's bytes after PNG filter `type`, from the row before, if any. */
function filterRow(
  type: number,
  row: Uint8Array,
  above: Uint8Array | undefined,
  output: Uint8Array,
): void {
  for (let index = 0; index < row.length; index++) {
    const value = row[index] ?? 0;
    const left = index >= 4 ? (row[index - 4] ?? 0) : 0;
    const up = above?.[index] ?? 0;
    const upLeft = index >= 4 ? (above?.[index - 4] ?? 0) : 0;
    const predicted =
      type === 1
        ? left
        : type === 2
          ? up
          : type === 3
            ? Math.floor((left + up) / 2)
            : type === 4
              ? paeth(left, up, upLeft)
              : 0;
    output[index] = (value - predicted) & 0xff;
  }
}

/** How small filtered bytes are, read as signed: smaller compresses better. */
function filterCost(bytes: Uint8Array): number {
  let cost = 0;
  for (const byte of bytes) cost += byte < 128 ? byte : 256 - byte;
  return cost;
}

/**
 * Encodes 8-bit RGBA pixels, row by row, as a PNG: colour type 6, not
 * interlaced, with no colour chunks. Each row takes the filter that leaves
 * the smallest bytes, the usual guess at what compresses best, and the rows
 * are compressed with zlib. Unlike a canvas's own encoder, this waits for
 * nothing but the work itself.
 */
export async function encodeRgba(
  width: number,
  height: number,
  data: Uint8Array | Uint8ClampedArray,
): Promise<Uint8Array> {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 0x7fffffff ||
    height > 0x7fffffff
  ) {
    throw new PngError("invalid image size");
  }
  const stride = width * 4;
  if (data.length !== stride * height) {
    throw new PngError("pixel data does not match the size");
  }
  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.length);
  const filtered = new Uint8Array((stride + 1) * height);
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const above =
      y === 0 ? undefined : pixels.subarray((y - 1) * stride, y * stride);
    let best = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let type = 0; type < 5; type++) {
      filterRow(type, row, above, trial);
      const cost = filterCost(trial);
      if (cost < bestCost) {
        best = type;
        bestCost = cost;
      }
    }
    const start = y * (stride + 1);
    filtered[start] = best;
    filterRow(
      best,
      row,
      above,
      filtered.subarray(start + 1, start + 1 + stride),
    );
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  // Bit depth 8, colour type 6 (RGBA), deflate, adaptive filtering, and no
  // interlacing.
  header.set([8, 6, 0, 0, 0], 8);
  return writeChunks([
    { type: "IHDR", data: header },
    { type: "IDAT", data: await deflate(filtered) },
    { type: "IEND", data: new Uint8Array(0) },
  ]);
}

export interface InternationalText {
  /** 1 to 79 Latin-1 characters, without leading, trailing, or double spaces. */
  readonly keyword: string;
  readonly text: string;
}

function validKeyword(keyword: string): boolean {
  return (
    keyword.length >= 1 &&
    keyword.length <= 79 &&
    /^[\x20-\x7e\xa1-\xff]+$/.test(keyword) &&
    !/^ | $| {2}/.test(keyword)
  );
}

/**
 * Encodes a compressed `iTXt` chunk: keyword, compression flag 1 with
 * method 0 (zlib), empty language tag and translated keyword, and the text
 * as compressed UTF-8.
 */
export async function encodeInternationalText(
  value: InternationalText,
): Promise<Chunk> {
  if (!validKeyword(value.keyword)) {
    throw new PngError(`invalid iTXt keyword ${JSON.stringify(value.keyword)}`);
  }
  const keyword = Uint8Array.from(value.keyword, (char) => char.charCodeAt(0));
  const text = await deflate(new TextEncoder().encode(value.text));
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword);
  // Null separator, compression flag, method, then the empty language tag
  // and translated keyword, each ended by a null byte.
  data.set([0, 1, 0, 0, 0], keyword.length);
  data.set(text, keyword.length + 5);
  return { type: "iTXt", data };
}

/** An `iTXt` chunk's keyword, or undefined for any other chunk. */
export function textKeyword(chunk: Chunk): string | undefined {
  if (chunk.type !== "iTXt") return undefined;
  // Keywords are at most 79 bytes, so the separator must come by byte 80.
  const end = chunk.data.subarray(0, 80).indexOf(0);
  return end < 1
    ? undefined
    : String.fromCharCode(...chunk.data.subarray(0, end));
}

/**
 * Decodes an `iTXt` chunk, compressed or not. Throws when the keyword, the
 * separators, the compression flag, or (for compressed text) the method is
 * wrong, when the text is longer than `limit` bytes (16 MiB by default), or
 * when it is not valid UTF-8. The language tag and translated keyword are
 * skipped without being checked.
 */
export async function decodeInternationalText(
  chunk: Chunk,
  limit = maxInflatedBytes,
): Promise<InternationalText> {
  if (chunk.type !== "iTXt") throw new PngError("not an iTXt chunk");
  const { data } = chunk;
  const keywordEnd = data.subarray(0, 80).indexOf(0);
  if (keywordEnd < 1 || keywordEnd + 2 >= data.length) {
    throw new PngError("malformed iTXt chunk");
  }
  const keyword = String.fromCharCode(...data.subarray(0, keywordEnd));
  const compressed = data[keywordEnd + 1];
  const method = data[keywordEnd + 2];
  const languageEnd = data.indexOf(0, keywordEnd + 3);
  const translatedEnd =
    languageEnd === -1 ? -1 : data.indexOf(0, languageEnd + 1);
  if (
    !validKeyword(keyword) ||
    translatedEnd === -1 ||
    (compressed !== 0 && compressed !== 1) ||
    // Decoders ignore the method of uncompressed text.
    (compressed === 1 && method !== 0)
  ) {
    throw new PngError("malformed iTXt chunk");
  }
  const raw = data.subarray(translatedEnd + 1);
  if (compressed === 0 && raw.length > limit) {
    throw new PngError(`text is longer than ${String(limit)} bytes`);
  }
  const bytes = compressed === 1 ? await inflate(raw, { limit }) : raw;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { keyword, text };
}
