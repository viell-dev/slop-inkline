// PNG chunk reading and writing, enough to carry Inkline's record inside the
// PNG a canvas encodes. Pixels are never decoded or encoded here.
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

/**
 * Splits a PNG file into its chunks, checking the signature, each chunk's
 * length and CRC, that `IHDR` comes first, and that the file ends with
 * `IEND`. Bytes after `IEND` are ignored, as PNG decoders do.
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
    if (type === "IEND") return chunks;
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

/** The image size in pixels, from the `IHDR` chunk. */
export function imageSize(chunks: readonly Chunk[]): {
  width: number;
  height: number;
} {
  const header = chunks[0];
  if (header?.type !== "IHDR" || header.data.length !== 13) {
    throw new PngError("missing IHDR chunk");
  }
  const view = new DataView(header.data.buffer, header.data.byteOffset, 13);
  return { width: view.getUint32(0), height: view.getUint32(4) };
}

/** The most that {@link inflate} produces by default: 16 MiB. */
export const maxInflatedBytes = 16 * 1024 * 1024;

async function transform(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit: number,
): Promise<Uint8Array> {
  // A copy, since the streams accept only bytes backed by an ArrayBuffer.
  const input = new Uint8Array(bytes);
  const reader = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  })
    .pipeThrough(stream)
    .getReader();
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
  return transform(bytes, new CompressionStream("deflate"), Infinity);
}

/**
 * Decompresses zlib data, failing on corrupt or truncated input and on
 * output larger than `limit` bytes, so that a crafted file cannot exhaust
 * memory.
 */
export function inflate(
  bytes: Uint8Array,
  limit = maxInflatedBytes,
): Promise<Uint8Array> {
  return transform(bytes, new DecompressionStream("deflate"), limit);
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
 * Decodes an `iTXt` chunk, compressed or not. Throws on a malformed chunk,
 * an unknown compression method, or text that is not valid UTF-8.
 */
export async function decodeInternationalText(
  chunk: Chunk,
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
    method !== 0
  ) {
    throw new PngError("malformed iTXt chunk");
  }
  const raw = data.subarray(translatedEnd + 1);
  const bytes = compressed === 1 ? await inflate(raw) : raw;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { keyword, text };
}
